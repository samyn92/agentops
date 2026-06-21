// NATS publishing for work-board events.
//
// The gitlab-label bridge is the single server-side authority for work-board
// label transitions. When it moves a card (fire -> in-progress, promote ->
// needs-review, recover -> trigger) OR detects that a card's column changed
// out-of-band (a human/CLI/agent relabel seen on the next poll), it publishes a
// `board_changed` event to NATS so the console updates the board in real time —
// no UI polling, no skipped intermediate states.
//
// Subject reuses the runtime's FEP scheme so the console's existing NATS->SSE
// multiplexer relays it with ZERO BFF changes (it only accepts
// `agents.{ns}.{name}.fep.{type}` subjects):
//
//	agents.{POD_NAMESPACE}.{CHANNEL_NAME}.fep.board_changed
//
// It arrives at the browser as an `agent.event` whose inner `type` is
// `board_changed`; the frontend discriminates on that.
package gitlablabel

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/nats-io/nats.go"
)

// boardPublisher publishes board_changed events to NATS. A nil publisher (no
// NATS_URL) is a no-op, so the bridge degrades gracefully without NATS.
type boardPublisher struct {
	nc        *nats.Conn
	namespace string
	channel   string
	logger    *slog.Logger
}

// newBoardPublisher connects to NATS using NATS_URL. Returns nil (disabled) if
// NATS_URL is unset or the connection fails — the bridge keeps working, it just
// won't push real-time board events (the console's slow safety-net poll covers
// that case).
func newBoardPublisher(logger *slog.Logger) *boardPublisher {
	url := os.Getenv("NATS_URL")
	if url == "" {
		logger.Info("NATS_URL not set; real-time board events disabled")
		return nil
	}
	namespace := envOrDefault("POD_NAMESPACE", "agents")
	channel := envOrDefault("CHANNEL_NAME", "gitlab-label")

	nc, err := nats.Connect(url,
		nats.Name(fmt.Sprintf("agent-channel/%s/%s", namespace, channel)),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				logger.Warn("NATS disconnected", "error", err)
			}
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) { logger.Info("NATS reconnected") }),
	)
	if err != nil {
		logger.Error("failed to connect to NATS; real-time board events disabled", "url", url, "error", err)
		return nil
	}
	logger.Info("NATS board publisher connected", "url", url, "namespace", namespace, "channel", channel)
	return &boardPublisher{nc: nc, namespace: namespace, channel: channel, logger: logger}
}

// publishBoardChanged emits one board_changed event for a card whose column
// label changed. `projectID` is the numeric GitLab project id, `iid` the
// issue/MR iid, `from`/`to` the agent:: labels (from may be empty for an
// externally-detected change), `state` the GitLab issue state.
func (b *boardPublisher) publishBoardChanged(projectID, iid int, target, from, to, state, webURL, title string) {
	if b == nil || b.nc == nil {
		return
	}
	subject := fmt.Sprintf("agents.%s.%s.fep.board_changed", b.namespace, b.channel)
	payload := map[string]any{
		"type":       "board_changed",
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"project_id": projectID,
		"iid":        iid,
		"target":     target,
		"from":       from,
		"to":         to,
		"state":      state,
		"web_url":    webURL,
		"title":      title,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		b.logger.Warn("NATS: marshal board_changed failed", "iid", iid, "error", err)
		return
	}
	if err := b.nc.Publish(subject, data); err != nil {
		b.logger.Warn("NATS: publish board_changed failed", "subject", subject, "iid", iid, "error", err)
	}
}

func (b *boardPublisher) close() {
	if b != nil && b.nc != nil {
		_ = b.nc.Drain()
	}
}
