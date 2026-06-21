// Package webhook implements the generic webhook channel bridge.
//
// It receives HTTP POST requests, verifies optional HMAC signatures,
// renders the prompt template with the event payload, and either
// sends the prompt to a daemon agent or creates an AgentRun.
package webhook

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/samyn92/agentops/channels/internal/bridge"
)

// Channel is the generic webhook channel bridge.
type Channel struct {
	cfg    *bridge.Config
	client *bridge.AgentClient
	logger *slog.Logger
}

// New creates a new webhook channel bridge.
func New(cfg *bridge.Config, logger *slog.Logger) *Channel {
	return &Channel{
		cfg:    cfg,
		client: bridge.NewAgentClient(logger),
		logger: logger,
	}
}

// Handler returns the HTTP handler for receiving webhook events.
func (c *Channel) Handler() http.Handler {
	return http.HandlerFunc(c.handleWebhook)
}

func (c *Channel) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		c.logger.Error("failed to read body", "error", err)
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Verify HMAC signature if configured
	if c.cfg.WebhookSecret != "" {
		signature := r.Header.Get("X-Hub-Signature-256")
		if signature == "" {
			signature = r.Header.Get("X-Signature-256")
		}
		if !bridge.VerifyHMACSHA256(body, c.cfg.WebhookSecret, signature) {
			c.logger.Warn("webhook signature verification failed")
			http.Error(w, "invalid signature", http.StatusForbidden)
			return
		}
	}

	// Parse event payload
	var event map[string]interface{}
	if err := json.Unmarshal(body, &event); err != nil {
		c.logger.Error("failed to parse webhook payload", "error", err)
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	// Render prompt template
	prompt, err := bridge.RenderPrompt(c.cfg.PromptTemplate, map[string]interface{}{
		"event":   event,
		"channel": c.cfg.ChannelName,
		"agent":   c.cfg.AgentRef,
	})
	if err != nil {
		c.logger.Error("failed to render prompt template", "error", err)
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}

	metadata := map[string]string{
		"channel": c.cfg.ChannelName,
		"type":    "webhook",
	}

	// Route to daemon or task agent
	if c.cfg.IsDaemon() {
		if err := c.client.PromptDaemon(r.Context(), c.cfg.AgentURL, prompt, metadata, nil); err != nil {
			c.logger.Error("failed to prompt daemon agent", "error", err)
			http.Error(w, "agent error", http.StatusBadGateway)
			return
		}
	} else {
		if err := c.client.CreateAgentRun(r.Context(), &bridge.AgentRunRequest{
			AgentRef:    c.cfg.AgentRef,
			ChannelName: c.cfg.ChannelName,
			Prompt:      prompt,
			Metadata:    metadata,
		}); err != nil {
			c.logger.Error("failed to create AgentRun", "error", err)
			http.Error(w, "agent run error", http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"accepted"}`)) //nolint:errcheck
}
