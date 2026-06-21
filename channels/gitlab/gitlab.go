// Package gitlab implements the GitLab webhook channel bridge.
//
// It receives GitLab webhook events, verifies the X-Gitlab-Token header,
// filters by configured event types / actions / labels, renders the prompt
// template with the event data, and either sends to a daemon agent or
// creates an AgentRun.
//
// GitLab webhook verification uses the X-Gitlab-Token header (shared secret)
// rather than HMAC signatures.
package gitlab

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/samyn92/agentops/channels/internal/bridge"
)

// Channel is the GitLab webhook channel bridge.
type Channel struct {
	cfg    *bridge.Config
	client *bridge.AgentClient
	logger *slog.Logger

	// GitLab-specific config from env vars
	events  []string // filter: ["Issue Hook", "Merge Request Hook", ...]
	actions []string // filter: ["open", "merge", ...]
	labels  []string // filter: ["agent-task", ...]
}

// New creates a new GitLab channel bridge.
func New(cfg *bridge.Config, logger *slog.Logger) *Channel {
	return &Channel{
		cfg:     cfg,
		client:  bridge.NewAgentClient(logger),
		logger:  logger,
		events:  parseCSV(os.Getenv("GITLAB_EVENTS")),
		actions: parseCSV(os.Getenv("GITLAB_ACTIONS")),
		labels:  parseCSV(os.Getenv("GITLAB_LABELS")),
	}
}

// Handler returns the HTTP handler for receiving GitLab webhook events.
func (c *Channel) Handler() http.Handler {
	return http.HandlerFunc(c.handleWebhook)
}

func (c *Channel) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// GitLab uses X-Gitlab-Token for webhook verification
	if c.cfg.WebhookSecret != "" {
		token := r.Header.Get("X-Gitlab-Token")
		if token != c.cfg.WebhookSecret {
			c.logger.Warn("GitLab webhook token verification failed")
			http.Error(w, "invalid token", http.StatusForbidden)
			return
		}
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		c.logger.Error("failed to read body", "error", err)
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Parse event payload
	var event map[string]interface{}
	if err := json.Unmarshal(body, &event); err != nil {
		c.logger.Error("failed to parse webhook payload", "error", err)
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	// Check event type filter
	eventType := r.Header.Get("X-Gitlab-Event")
	if !c.matchesEvent(eventType) {
		c.logger.Debug("ignoring event (type filter)", "event", eventType)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ignored","reason":"event_type_filtered"}`)) //nolint:errcheck
		return
	}

	// Check action filter (from object_attributes.action)
	if !c.matchesAction(event) {
		c.logger.Debug("ignoring event (action filter)", "event", eventType)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ignored","reason":"action_filtered"}`)) //nolint:errcheck
		return
	}

	// Check label filter
	if !c.matchesLabels(event) {
		c.logger.Debug("ignoring event (label filter)", "event", eventType)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ignored","reason":"label_filtered"}`)) //nolint:errcheck
		return
	}

	c.logger.Info("processing GitLab event",
		"event", eventType,
		"action", getNestedString(event, "object_attributes", "action"),
	)

	// Render prompt template
	prompt, err := bridge.RenderPrompt(c.cfg.PromptTemplate, map[string]interface{}{
		"event":   event,
		"channel": c.cfg.ChannelName,
		"agent":   c.cfg.AgentRef,
		"gitlab": map[string]interface{}{
			"event_type": eventType,
			"project":    event["project"],
		},
	})
	if err != nil {
		c.logger.Error("failed to render prompt template", "error", err)
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}

	metadata := map[string]string{
		"channel":    c.cfg.ChannelName,
		"type":       "gitlab",
		"event_type": eventType,
	}

	// Add object_attributes.iid to metadata if present (issue/MR number)
	if iid := getNestedString(event, "object_attributes", "iid"); iid != "" {
		metadata["iid"] = iid
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

// matchesEvent checks if the event type matches the configured filter.
func (c *Channel) matchesEvent(eventType string) bool {
	if len(c.events) == 0 {
		return true // no filter = accept all
	}
	for _, e := range c.events {
		if strings.EqualFold(e, eventType) {
			return true
		}
	}
	return false
}

// matchesAction checks if the event's action matches the configured filter.
func (c *Channel) matchesAction(event map[string]interface{}) bool {
	if len(c.actions) == 0 {
		return true // no filter = accept all
	}
	action := getNestedString(event, "object_attributes", "action")
	if action == "" {
		return true // no action in event = accept (some events don't have actions)
	}
	for _, a := range c.actions {
		if strings.EqualFold(a, action) {
			return true
		}
	}
	return false
}

// matchesLabels checks if the event has any of the configured labels.
func (c *Channel) matchesLabels(event map[string]interface{}) bool {
	if len(c.labels) == 0 {
		return true // no filter = accept all
	}

	eventLabels := getEventLabels(event)
	for _, required := range c.labels {
		for _, actual := range eventLabels {
			if strings.EqualFold(required, actual) {
				return true
			}
		}
	}
	return false
}

// getEventLabels extracts label titles from a GitLab event.
// Labels can be in object_attributes.labels or labels at the top level.
func getEventLabels(event map[string]interface{}) []string {
	var labels []string

	// Try object_attributes.labels first
	if oa, ok := event["object_attributes"].(map[string]interface{}); ok {
		if ls, ok := oa["labels"].([]interface{}); ok {
			for _, l := range ls {
				if lm, ok := l.(map[string]interface{}); ok {
					if title, ok := lm["title"].(string); ok {
						labels = append(labels, title)
					}
				}
			}
		}
	}

	// Also check top-level labels
	if ls, ok := event["labels"].([]interface{}); ok {
		for _, l := range ls {
			if lm, ok := l.(map[string]interface{}); ok {
				if title, ok := lm["title"].(string); ok {
					labels = append(labels, title)
				}
			}
		}
	}

	return labels
}

// getNestedString extracts a string from nested maps.
func getNestedString(m map[string]interface{}, keys ...string) string {
	current := interface{}(m)
	for _, key := range keys {
		cm, ok := current.(map[string]interface{})
		if !ok {
			return ""
		}
		current = cm[key]
	}

	switch v := current.(type) {
	case string:
		return v
	case float64:
		return strings.TrimRight(strings.TrimRight(
			strings.Replace(
				strings.Replace(
					strings.Replace(
						fmt.Sprintf("%v", v), ".000000", "", 1),
					"e+", "e", 1),
				"-0", "", 1),
			"0"), ".")
	default:
		if current == nil {
			return ""
		}
		return fmt.Sprintf("%v", current)
	}
}

func parseCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}
