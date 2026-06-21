// Package auth implements multi-provider GitLab OAuth2/OIDC authentication.
//
// Multiple GitLab instances (gitlab.com, self-hosted, etc.) can be configured
// via environment variables using a suffix convention:
//
//	GITLAB_OAUTH_CLIENT_ID          → default provider
//	GITLAB_OAUTH_1_CLIENT_ID        → provider "1"
//	GITLAB_OAUTH_2_CLIENT_ID        → provider "2"
//
// Each provider gets its own OAuth2 application credentials and base URL. All
// share a single AES-256-GCM session key (GITLAB_OAUTH_SESSION_KEY). The
// session cookie stores which provider the user authenticated with so token
// refresh hits the correct GitLab instance.
//
// Routes:
//
//	/auth/providers          → list available providers (for the login picker)
//	/auth/login/{provider}   → redirect to that provider's GitLab authorize URL
//	/auth/callback/{provider}→ exchange code, set session cookie
//	/auth/logout             → clear session
//	/auth/me                 → current user identity + provider info
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
	"sort"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

// ── Provider ─────────────────────────────────────────────────────────────────

// ProviderConfig holds the OAuth2 config for one GitLab instance.
type ProviderConfig struct {
	ID           string // "default", "1", "2", ...
	Label        string // Display name ("GitLab.com", "Company GitLab")
	ClientID     string
	ClientSecret string
	BaseURL      string // e.g. https://gitlab.com
	RedirectURL  string // full callback URL for this provider
}

// Provider is a configured OAuth2 provider (one GitLab instance).
type Provider struct {
	ID      string
	Label   string
	BaseURL string
	oauth   *oauth2.Config
}

// ProviderInfo is the public-facing provider metadata (returned by /auth/providers).
type ProviderInfo struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	BaseURL string `json:"baseUrl"`
}

// ── AuthManager ──────────────────────────────────────────────────────────────

// AuthManager manages multiple OAuth2 providers with a shared session cookie.
type AuthManager struct {
	providers map[string]*Provider // keyed by provider ID
	order     []string             // ordered provider IDs (for listing)
	gcm       cipher.AEAD
	cookie    string
}

// Config holds the multi-provider auth configuration.
type Config struct {
	Providers  []ProviderConfig
	SessionKey string // 32-byte hex → AES-256-GCM (shared across providers)
}

// ConfigFromEnv reads auth config from environment variables.
// Returns nil if no providers are configured (auth disabled).
//
// Convention:
//
//	GITLAB_OAUTH_CLIENT_ID          → default provider
//	GITLAB_OAUTH_1_CLIENT_ID        → provider "1"
//	GITLAB_OAUTH_2_CLIENT_ID        → provider "2"
//
// Each provider reads: CLIENT_ID, CLIENT_SECRET, BASE_URL, LABEL, REDIRECT_URL.
// GITLAB_OAUTH_SESSION_KEY is shared.
func ConfigFromEnv() *Config {
	sessionKey := os.Getenv("GITLAB_OAUTH_SESSION_KEY")
	if sessionKey == "" {
		return nil
	}

	var providers []ProviderConfig

	// Default provider (no suffix)
	if id := os.Getenv("GITLAB_OAUTH_CLIENT_ID"); id != "" {
		providers = append(providers, readProviderEnv("default", ""))
	}

	// Numbered providers (_1, _2, _3, ...)
	for i := 1; i <= 10; i++ {
		suffix := fmt.Sprintf("_%d", i)
		if id := os.Getenv("GITLAB_OAUTH" + suffix + "_CLIENT_ID"); id != "" {
			providers = append(providers, readProviderEnv(fmt.Sprintf("%d", i), suffix))
		}
	}

	if len(providers) == 0 {
		return nil
	}

	return &Config{
		Providers:  providers,
		SessionKey: sessionKey,
	}
}

func readProviderEnv(id, suffix string) ProviderConfig {
	prefix := "GITLAB_OAUTH" + suffix

	baseURL := os.Getenv(prefix + "_BASE_URL")
	if baseURL == "" {
		baseURL = "https://gitlab.com"
	}

	label := os.Getenv(prefix + "_LABEL")
	if label == "" {
		// Derive label from base URL.
		label = strings.TrimPrefix(baseURL, "https://")
		label = strings.TrimPrefix(label, "http://")
	}

	redirectURL := os.Getenv(prefix + "_REDIRECT_URL")
	if redirectURL == "" {
		base := os.Getenv("GITLAB_OAUTH_REDIRECT_URL")
		if base == "" {
			base = "http://localhost:30173/auth/callback"
		}
		// Default provider uses the base callback URL (backward compatible);
		// additional providers append their ID as a path suffix.
		if id == "default" {
			redirectURL = base
		} else {
			redirectURL = strings.TrimRight(base, "/") + "/" + id
		}
	}

	return ProviderConfig{
		ID:           id,
		Label:        label,
		ClientID:     os.Getenv(prefix + "_CLIENT_ID"),
		ClientSecret: os.Getenv(prefix + "_CLIENT_SECRET"),
		BaseURL:      strings.TrimRight(baseURL, "/"),
		RedirectURL:  redirectURL,
	}
}

// New creates an AuthManager with all configured providers.
func New(cfg *Config) (*AuthManager, error) {
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

	mgr := &AuthManager{
		providers: make(map[string]*Provider, len(cfg.Providers)),
		gcm:       gcm,
		cookie:    "agentops_session",
	}

	for _, pc := range cfg.Providers {
		p := &Provider{
			ID:      pc.ID,
			Label:   pc.Label,
			BaseURL: pc.BaseURL,
			oauth: &oauth2.Config{
				ClientID:     pc.ClientID,
				ClientSecret: pc.ClientSecret,
				RedirectURL:  pc.RedirectURL,
				Scopes:       []string{"api", "read_user", "openid", "profile"},
				Endpoint: oauth2.Endpoint{
					AuthURL:  pc.BaseURL + "/oauth/authorize",
					TokenURL: pc.BaseURL + "/oauth/token",
				},
			},
		}
		mgr.providers[pc.ID] = p
		mgr.order = append(mgr.order, pc.ID)
	}

	return mgr, nil
}

// Providers returns the list of configured providers (for the login picker).
func (m *AuthManager) Providers() []ProviderInfo {
	out := make([]ProviderInfo, 0, len(m.order))
	for _, id := range m.order {
		p := m.providers[id]
		out = append(out, ProviderInfo{
			ID:      p.ID,
			Label:   p.Label,
			BaseURL: p.BaseURL,
		})
	}
	return out
}

// provider returns a provider by ID or nil.
func (m *AuthManager) provider(id string) *Provider {
	return m.providers[id]
}

// DefaultProviderID returns the first provider ID (for backward compat).
func (m *AuthManager) DefaultProviderID() string {
	if len(m.order) > 0 {
		return m.order[0]
	}
	return ""
}

// HasMultipleProviders returns true if more than one provider is configured.
func (m *AuthManager) HasMultipleProviders() bool {
	return len(m.providers) > 1
}

// ── HTTP Handlers ────────────────────────────────────────────────────────────

// HandleProviders returns the list of available OAuth providers as JSON.
// GET /auth/providers
func (m *AuthManager) HandleProviders(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(m.Providers())
}

// HandleLogin redirects the browser to the specified provider's authorize URL.
// GET /auth/login/{provider}
func (m *AuthManager) HandleLogin(w http.ResponseWriter, r *http.Request) {
	providerID := extractProvider(r)
	p := m.provider(providerID)
	if p == nil {
		http.Error(w, fmt.Sprintf("unknown auth provider %q", providerID), http.StatusBadRequest)
		return
	}

	returnTo := r.URL.Query().Get("return_to")
	if returnTo == "" {
		returnTo = "/"
	}
	// Encode return_to in state.
	state := base64.RawURLEncoding.EncodeToString([]byte(returnTo))
	url := p.oauth.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// HandleCallback exchanges the authorization code for tokens and sets the
// session cookie. GET /auth/callback/{provider}
func (m *AuthManager) HandleCallback(w http.ResponseWriter, r *http.Request) {
	providerID := extractProvider(r)
	p := m.provider(providerID)
	if p == nil {
		http.Error(w, fmt.Sprintf("unknown auth provider %q", providerID), http.StatusBadRequest)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing code parameter", http.StatusBadRequest)
		return
	}

	token, err := p.oauth.Exchange(r.Context(), code)
	if err != nil {
		slog.Error("oauth2 token exchange failed", "provider", providerID, "error", err)
		http.Error(w, "authentication failed", http.StatusInternalServerError)
		return
	}

	user, err := fetchUser(r.Context(), p.BaseURL, token.AccessToken)
	if err != nil {
		slog.Error("failed to fetch gitlab user", "provider", providerID, "error", err)
		http.Error(w, "failed to fetch user profile", http.StatusInternalServerError)
		return
	}

	sess := Session{
		Provider:     providerID,
		GitLabURL:    p.BaseURL,
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ExpiresAt:    token.Expiry,
		Username:     user.Username,
		Name:         user.Name,
		AvatarURL:    user.AvatarURL,
		Email:        user.Email,
	}

	if err := m.setSession(w, &sess); err != nil {
		slog.Error("failed to set session cookie", "error", err)
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}

	slog.Info("user authenticated", "username", user.Username, "provider", providerID, "gitlab", p.BaseURL)

	returnTo := "/"
	if st := r.URL.Query().Get("state"); st != "" {
		if b, err := base64.RawURLEncoding.DecodeString(st); err == nil && len(b) > 0 {
			returnTo = string(b)
		}
	}
	http.Redirect(w, r, returnTo, http.StatusTemporaryRedirect)
}

// HandleLogout clears the session cookie.
func (m *AuthManager) HandleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     m.cookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	if strings.Contains(r.Header.Get("Accept"), "application/json") {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	} else {
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	}
}

// HandleMe returns the current user's identity + provider info.
func (m *AuthManager) HandleMe(w http.ResponseWriter, r *http.Request) {
	sess, err := m.getSession(r)
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
		Provider:      sess.Provider,
		GitLabURL:     sess.GitLabURL,
		Authenticated: true,
	})
}

// ── Session ──────────────────────────────────────────────────────────────────

// Session is the encrypted cookie payload.
type Session struct {
	Provider     string    `json:"p"`            // provider ID
	GitLabURL    string    `json:"gl"`           // provider's GitLab base URL
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
	Provider      string `json:"provider,omitempty"`
	GitLabURL     string `json:"gitlabUrl,omitempty"`
	Authenticated bool   `json:"authenticated"`
}

// GetSession extracts and decrypts the session from the request.
func (m *AuthManager) GetSession(r *http.Request) (*Session, error) {
	return m.getSession(r)
}

func (m *AuthManager) getSession(r *http.Request) (*Session, error) {
	c, err := r.Cookie(m.cookie)
	if err != nil {
		return nil, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil {
		return nil, fmt.Errorf("decode cookie: %w", err)
	}
	if len(data) < m.gcm.NonceSize() {
		return nil, fmt.Errorf("cookie too short")
	}
	nonce, ciphertext := data[:m.gcm.NonceSize()], data[m.gcm.NonceSize():]
	plain, err := m.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt session: %w", err)
	}
	var sess Session
	if err := json.Unmarshal(plain, &sess); err != nil {
		return nil, fmt.Errorf("unmarshal session: %w", err)
	}
	return &sess, nil
}

func (m *AuthManager) setSession(w http.ResponseWriter, sess *Session) error {
	plain, err := json.Marshal(sess)
	if err != nil {
		return err
	}
	nonce := make([]byte, m.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return err
	}
	sealed := m.gcm.Seal(nonce, nonce, plain, nil)
	encoded := base64.RawURLEncoding.EncodeToString(sealed)

	http.SetCookie(w, &http.Cookie{
		Name:     m.cookie,
		Value:    encoded,
		Path:     "/",
		MaxAge:   86400 * 7,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

// RefreshIfNeeded refreshes the access token if near-expiry using the correct
// provider's token endpoint.
func (m *AuthManager) RefreshIfNeeded(ctx context.Context, w http.ResponseWriter, sess *Session) (*Session, bool, error) {
	if sess == nil || sess.AccessToken == "" {
		return sess, false, nil
	}
	if time.Until(sess.ExpiresAt) > 60*time.Second {
		return sess, false, nil
	}
	if sess.RefreshToken == "" {
		return sess, false, fmt.Errorf("access token expired and no refresh token")
	}

	// Find the provider to use for refresh.
	p := m.provider(sess.Provider)
	if p == nil {
		return sess, false, fmt.Errorf("unknown provider %q in session", sess.Provider)
	}

	ts := p.oauth.TokenSource(ctx, &oauth2.Token{
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
	if err := m.setSession(w, sess); err != nil {
		return sess, true, fmt.Errorf("save refreshed session: %w", err)
	}
	slog.Debug("access token refreshed", "username", sess.Username, "provider", sess.Provider)
	return sess, true, nil
}

// UserAccessToken extracts the user's GitLab access token from the request's
// session, refreshing if needed.
func (m *AuthManager) UserAccessToken(w http.ResponseWriter, r *http.Request) (string, error) {
	sess, err := m.getSession(r)
	if err != nil || sess == nil {
		return "", err
	}
	sess, _, err = m.RefreshIfNeeded(r.Context(), w, sess)
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

func fetchUser(ctx context.Context, baseURL, accessToken string) (*gitlabUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/v4/user", nil)
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

// extractProvider gets the provider ID from the URL path. Supports both
// /auth/login/{provider} and /auth/login (defaults to first provider).
func extractProvider(r *http.Request) string {
	// Try chi URL param first
	parts := strings.Split(strings.TrimRight(r.URL.Path, "/"), "/")
	if len(parts) > 0 {
		last := parts[len(parts)-1]
		if last != "login" && last != "callback" {
			return last
		}
	}
	return "default"
}

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

// Suppress unused import warning
var _ = sort.Strings
