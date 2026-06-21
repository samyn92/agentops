package bridge

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestRenderPrompt(t *testing.T) {
	tests := []struct {
		name     string
		template string
		data     interface{}
		want     string
		wantErr  bool
	}{
		{
			name:     "simple field access",
			template: "Issue: {{ .event.title }}",
			data: map[string]interface{}{
				"event": map[string]interface{}{"title": "Fix bug"},
			},
			want: "Issue: Fix bug",
		},
		{
			name:     "with functions",
			template: "{{ upper .event.title }}",
			data: map[string]interface{}{
				"event": map[string]interface{}{"title": "fix bug"},
			},
			want: "FIX BUG",
		},
		{
			name:     "default function",
			template: `{{ default "no title" .event.title }}`,
			data: map[string]interface{}{
				"event": map[string]interface{}{"title": ""},
			},
			want: "no title",
		},
		{
			name:     "multiline",
			template: "Implement the issue.\nTitle: {{ .event.title }}\nDesc: {{ .event.desc }}",
			data: map[string]interface{}{
				"event": map[string]interface{}{"title": "Add feature", "desc": "Details here"},
			},
			want: "Implement the issue.\nTitle: Add feature\nDesc: Details here",
		},
		{
			name:     "invalid template",
			template: "{{ .event.title",
			data:     nil,
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := RenderPrompt(tt.template, tt.data)
			if (err != nil) != tt.wantErr {
				t.Errorf("RenderPrompt() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("RenderPrompt() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestVerifyHMACSHA256(t *testing.T) {
	secret := "test-secret"
	payload := []byte(`{"action":"opened"}`)

	// Compute valid signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	validSig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	tests := []struct {
		name      string
		payload   []byte
		secret    string
		signature string
		want      bool
	}{
		{"valid signature", payload, secret, validSig, true},
		{"empty secret skips", payload, "", "", true},
		{"invalid signature", payload, secret, "sha256=deadbeef", false},
		{"wrong payload", []byte("other"), secret, validSig, false},
		{"no prefix", payload, secret, validSig[7:], true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := VerifyHMACSHA256(tt.payload, tt.secret, tt.signature)
			if got != tt.want {
				t.Errorf("VerifyHMACSHA256() = %v, want %v", got, tt.want)
			}
		})
	}
}
