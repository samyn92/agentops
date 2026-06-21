// Package auth implements GitLab OAuth2/OIDC authentication for the console BFF.
//
// The human logs in via the standard Authorization Code flow:
//
//	Browser → /auth/login → GitLab authorize → callback with code
//	BFF exchanges code → access_token + refresh_token + id_token
//	BFF sets an encrypted HTTP-only session cookie
//
// Write actions (merge, approve, comment) proxy to GitLab using the HUMAN's
// access token — so merges are authenticated as the operator, not the agent bot.
// Read actions (board browsing) continue to use the Integration's bot token.
//
// Session is a thin AES-256-GCM encrypted cookie — no external session store.
// The session key comes from the gitlab-oauth Secret (session-key).
package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

// Config holds the OAuth2 + session configuration, read from env vars
// (injected from the gitlab-oauth Secret).
type Config struct {
	ClientID     string // GITLAB_OAUTH_CLIENT_ID
	ClientSecret string // GITLAB_OAUTH_CLIENT_SECRET
	SessionKey   string // GITLAB_OAUTH_SESSION_KEY (32-byte hex)
	BaseURL      string // GitLab base URL (default https://gitlab.com)
	RedirectURL  string // OAuth2 callback URL (default http://localhost:30173/auth/callback)
}

// ConfigFromEnv reads auth config from environment variables.
// Returns nil if GITLAB_OAUTH_CLIENT_ID is not set (auth disabled).
func ConfigFromEnv() *Config {
	clientID := os.Getenv("GITLAB_OAUTH_CLIENT_ID")
	if clientID == "" {
		return nil
	}
	baseURL := os.Getenv("GITLAB_BASE_URL")
	if baseURL == "" {
		baseURL = "https://gitlab.com"
	}
	redirectURL := os.Getenv("GITLAB_OAUTH_REDIRECT_URL")
	if redirectURL == "" {
		redirectURL = "http://localhost:30173/auth/callback"
	}
	return &Config{
		ClientID:     clientID,
		ClientSecret: os.Getenv("GITLAB_OAUTH_CLIENT_SECRET"),
		SessionKey:   os.Getenv("GITLAB_OAUTH_SESSION_KEY"),
		BaseURL:      strings.TrimRight(baseURL, "/"),
		RedirectURL:  redirectURL,
	}
}

// Auth handles OAuth2 login, sessions, and token management.
type Auth struct {
	oauth  *oauth2.Config
	gcm    cipher.AEAD
	base   string // GitLab base URL
	cookie string // session cookie name
}

// New creates an Auth instance. Returns an error if the session key is invalid.
func New(cfg *Config) (*Auth, error) {
	// Parse session key (hex → 32 bytes → AES-256-GCM).
	keyBytes, err := parseHexKey(cfg.SessionKey)
	if err != nil {
		return nil, fmt.Errorf("invalid session key: %w", err)
	}
	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		return nil, fmt.Errorf("aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm: %w", err)
	}

	return &Auth{
		oauth: &oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			RedirectURL:  cfg.RedirectURL,
			Scopes:       []string{"api", "read_user", "openid", "profile"},
			Endpoint: oauth2.Endpoint{
				AuthURL:  cfg.BaseURL + "/oauth/authorize",
				TokenURL: cfg.BaseURL + "/oauth/token",
			},
		},
		gcm:    gcm,
		base:   cfg.BaseURL,
		cookie: "agentops_session",
	}, nil
}

// ── HTTP Handlers ────────────────────────────────────────────────────────────

// HandleLogin redirects the browser to GitLab's authorize URL.
func (a *Auth) HandleLogin(w http.ResponseWriter, r *http.Request) {
	// state = where to redirect after login (default /)
	returnTo := r.URL.Query().Get("return_to")
	if returnTo == "" {
		returnTo = "/"
	}
	state := base64.RawURLEncoding.EncodeToString([]byte(returnTo))
	url := a.oauth.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// HandleCallback exchanges the authorization code for tokens and sets the
// session cookie.
func (a *Auth) HandleCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing code parameter", http.StatusBadRequest)
		return
	}

	// Exchange code → tokens.
	token, err := a.oauth.Exchange(r.Context(), code)
	if err != nil {
		slog.Error("oauth2 token exchange failed", "error", err)
		http.Error(w, "authentication failed", http.StatusInternalServerError)
		return
	}

	// Fetch the user's GitLab profile.
	user, err := a.fetchUser(r.Context(), token.AccessToken)
	if err != nil {
		slog.Error("failed to fetch gitlab user", "error", err)
		http.Error(w, "failed to fetch user profile", http.StatusInternalServerError)
		return
	}

	// Build session.
	sess := Session{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ExpiresAt:    token.Expiry,
		Username:     user.Username,
		Name:         user.Name,
		AvatarURL:    user.AvatarURL,
		Email:        user.Email,
	}

	if err := a.setSession(w, &sess); err != nil {
		slog.Error("failed to set session cookie", "error", err)
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}

	slog.Info("user authenticated", "username", user.Username)

	// Redirect back to the return_to path (from state param).
	returnTo := "/"
	if st := r.URL.Query().Get("state"); st != "" {
		if b, err := base64.RawURLEncoding.DecodeString(st); err == nil && len(b) > 0 {
			returnTo = string(b)
		}
	}
	http.Redirect(w, r, returnTo, http.StatusTemporaryRedirect)
}

// HandleLogout clears the session cookie.
func (a *Auth) HandleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     a.cookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	// Return JSON for API callers, redirect for browsers.
	if strings.Contains(r.Header.Get("Accept"), "application/json") {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	} else {
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	}
}

// HandleMe returns the current user's identity (or 401 if not logged in).
func (a *Auth) HandleMe(w http.ResponseWriter, r *http.Request) {
	sess, err := a.getSession(r)
	if err != nil || sess == nil {
		http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(UserInfo{
		Username:      sess.Username,
		Name:          sess.Name,
		AvatarURL:     sess.AvatarURL,
		Email:         sess.Email,
		Authenticated: true,
	})
}

// ── Session ──────────────────────────────────────────────────────────────────

// Session is the encrypted cookie payload.
type Session struct {
	AccessToken  string    `json:"at"`
	RefreshToken string    `json:"rt,omitempty"`
	ExpiresAt    time.Time `json:"exp"`
	Username     string    `json:"u"`
	Name         string    `json:"n,omitempty"`
	AvatarURL    string    `json:"av,omitempty"`
	Email        string    `json:"em,omitempty"`
}

// UserInfo is the public-facing user identity (returned by /auth/me).
type UserInfo struct {
	Username      string `json:"username"`
	Name          string `json:"name,omitempty"`
	AvatarURL     string `json:"avatarUrl,omitempty"`
	Email         string `json:"email,omitempty"`
	Authenticated bool   `json:"authenticated"`
}

// GetSession extracts and decrypts the session from the request. Returns nil
// (no error) if no session cookie is present. Automatically refreshes the
// access token if it's expired and a refresh token is available.
func (a *Auth) GetSession(r *http.Request) (*Session, error) {
	return a.getSession(r)
}

func (a *Auth) getSession(r *http.Request) (*Session, error) {
	c, err := r.Cookie(a.cookie)
	if err != nil {
		return nil, nil // no cookie → not logged in
	}
	data, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil {
		return nil, fmt.Errorf("decode cookie: %w", err)
	}
	if len(data) < a.gcm.NonceSize() {
		return nil, fmt.Errorf("cookie too short")
	}
	nonce, ciphertext := data[:a.gcm.NonceSize()], data[a.gcm.NonceSize():]
	plain, err := a.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt session: %w", err)
	}
	var sess Session
	if err := json.Unmarshal(plain, &sess); err != nil {
		return nil, fmt.Errorf("unmarshal session: %w", err)
	}
	return &sess, nil
}

func (a *Auth) setSession(w http.ResponseWriter, sess *Session) error {
	plain, err := json.Marshal(sess)
	if err != nil {
		return err
	}
	nonce := make([]byte, a.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return err
	}
	sealed := a.gcm.Seal(nonce, nonce, plain, nil)
	encoded := base64.RawURLEncoding.EncodeToString(sealed)

	http.SetCookie(w, &http.Cookie{
		Name:     a.cookie,
		Value:    encoded,
		Path:     "/",
		MaxAge:   86400 * 7, // 7 days
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		// Secure: true for production (HTTPS); false for localhost dev.
	})
	return nil
}

// RefreshIfNeeded checks whether the access token is expired and refreshes it
// if a refresh token is available. Returns the (possibly refreshed) session
// and true if the session was updated (caller should re-set the cookie).
func (a *Auth) RefreshIfNeeded(ctx context.Context, w http.ResponseWriter, sess *Session) (*Session, bool, error) {
	if sess == nil || sess.AccessToken == "" {
		return sess, false, nil
	}
	// Not expired yet → no refresh needed.
	if time.Until(sess.ExpiresAt) > 60*time.Second {
		return sess, false, nil
	}
	if sess.RefreshToken == "" {
		return sess, false, fmt.Errorf("access token expired and no refresh token")
	}
	// Use oauth2 token source to refresh.
	ts := a.oauth.TokenSource(ctx, &oauth2.Token{
		AccessToken:  sess.AccessToken,
		RefreshToken: sess.RefreshToken,
		Expiry:       sess.ExpiresAt,
	})
	newTok, err := ts.Token()
	if err != nil {
		return sess, false, fmt.Errorf("refresh token: %w", err)
	}
	sess.AccessToken = newTok.AccessToken
	sess.RefreshToken = newTok.RefreshToken
	sess.ExpiresAt = newTok.Expiry
	// Persist the refreshed session.
	if err := a.setSession(w, sess); err != nil {
		return sess, true, fmt.Errorf("save refreshed session: %w", err)
	}
	slog.Debug("access token refreshed", "username", sess.Username)
	return sess, true, nil
}

// UserAccessToken extracts the user's GitLab access token from the request's
// session, refreshing if needed. Returns ("", nil) if not logged in; non-nil
// error only on session-corruption/refresh-failure.
func (a *Auth) UserAccessToken(w http.ResponseWriter, r *http.Request) (string, error) {
	sess, err := a.getSession(r)
	if err != nil || sess == nil {
		return "", err
	}
	sess, _, err = a.RefreshIfNeeded(r.Context(), w, sess)
	if err != nil {
		return "", err
	}
	return sess.AccessToken, nil
}

// ── GitLab user fetch ────────────────────────────────────────────────────────

type gitlabUser struct {
	Username  string `json:"username"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
}

func (a *Auth) fetchUser(ctx context.Context, accessToken string) (*gitlabUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.base+"/api/v4/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("gitlab /user returned %d: %s", resp.StatusCode, body)
	}
	var u gitlabUser
	return &u, json.NewDecoder(resp.Body).Decode(&u)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func parseHexKey(hex string) ([]byte, error) {
	if len(hex) != 64 {
		return nil, fmt.Errorf("session key must be 64 hex chars (32 bytes), got %d", len(hex))
	}
	b := make([]byte, 32)
	for i := range 32 {
		var hi, lo byte
		hi, lo = hexNibble(hex[2*i]), hexNibble(hex[2*i+1])
		if hi == 0xff || lo == 0xff {
			return nil, fmt.Errorf("invalid hex char at position %d", 2*i)
		}
		b[i] = hi<<4 | lo
	}
	return b, nil
}

func hexNibble(c byte) byte {
	switch {
	case '0' <= c && c <= '9':
		return c - '0'
	case 'a' <= c && c <= 'f':
		return c - 'a' + 10
	case 'A' <= c && c <= 'F':
		return c - 'A' + 10
	default:
		return 0xff
	}
}
