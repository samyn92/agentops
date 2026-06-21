// Login wall middleware and request-scoped token propagation.
//
// RequireAuth gates routes: no valid session → 401. When active it also
// auto-refreshes the access token and injects it into request context so
// downstream handlers can call TokenFromContext(r) instead of re-decrypting
// the session on every request.
package auth

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
)

type ctxKey int

const (
	ctxTokenKey   ctxKey = iota // string: GitLab access token
	ctxSessionKey               // *Session: full session payload
)

// RequireAuth returns chi-compatible middleware that enforces authentication.
// Works with multi-provider sessions — validates regardless of which provider
// the user authenticated with.
func (m *AuthManager) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, err := m.getSession(r)
		if err != nil {
			slog.Debug("auth middleware: invalid session", "error", err)
			writeUnauthorized(w, "invalid session")
			return
		}
		if sess == nil || sess.AccessToken == "" {
			writeUnauthorized(w, "authentication required")
			return
		}

		// Auto-refresh expired token (uses the correct provider's token endpoint).
		sess, _, err = m.RefreshIfNeeded(r.Context(), w, sess)
		if err != nil {
			slog.Warn("auth middleware: token refresh failed", "user", sess.Username, "provider", sess.Provider, "error", err)
			writeUnauthorized(w, "session expired — please log in again")
			return
		}

		// Inject token + session into context for downstream handlers.
		ctx := context.WithValue(r.Context(), ctxTokenKey, sess.AccessToken)
		ctx = context.WithValue(ctx, ctxSessionKey, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// TokenFromContext returns the user's GitLab access token from the request context.
func TokenFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxTokenKey).(string); ok {
		return v
	}
	return ""
}

// SessionFromContext returns the full session from the request context.
func SessionFromContext(ctx context.Context) *Session {
	if v, ok := ctx.Value(ctxSessionKey).(*Session); ok {
		return v
	}
	return nil
}

func writeUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
