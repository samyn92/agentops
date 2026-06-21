package bridge

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"text/template"
)

// Restricted template function map — no exec, no OS functions.
var templateFuncs = template.FuncMap{
	"lower":   strings.ToLower,
	"upper":   strings.ToUpper,
	"trim":    strings.TrimSpace,
	"default": templateDefault,
	"printf":  fmt.Sprintf,
}

func templateDefault(def, val string) string {
	if val == "" {
		return def
	}
	return val
}

// RenderPrompt renders a Go text/template with event data.
func RenderPrompt(tmplStr string, data interface{}) (string, error) {
	tmpl, err := template.New("prompt").Funcs(templateFuncs).Parse(tmplStr)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("render template: %w", err)
	}

	return buf.String(), nil
}

// VerifyHMACSHA256 verifies an HMAC-SHA256 signature.
// Expected signature format: "sha256=<hex digest>"
func VerifyHMACSHA256(payload []byte, secret string, signature string) bool {
	if secret == "" {
		return true // no secret configured = skip verification
	}

	// Strip prefix if present
	sig := signature
	if strings.HasPrefix(sig, "sha256=") {
		sig = sig[7:]
	}

	expected, err := hex.DecodeString(sig)
	if err != nil {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	computed := mac.Sum(nil)

	return hmac.Equal(expected, computed)
}
