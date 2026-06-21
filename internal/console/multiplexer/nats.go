// NATS subscriber: receives FEP events published by agent runtimes via NATS
// and injects them into the multiplexer's event channel for browser SSE delivery.
//
// Subject format: agents.{namespace}.{agentName}.fep.{eventType}
// The subscriber uses a wildcard: agents.>
package multiplexer

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/samyn92/agentops/internal/console/fep"
)

// natsSubscriber manages a NATS connection that receives FEP events from runtimes.
type natsSubscriber struct {
	nc     *nats.Conn
	sub    *nats.Subscription
	eventC chan<- EnvelopedEvent
}

// startNATSSubscriber connects to NATS and subscribes to all agent FEP events.
// Returns nil if NATS_URL is not set (graceful degradation — existing SSE relay still works).
func startNATSSubscriber(eventC chan<- EnvelopedEvent) *natsSubscriber {
	url := os.Getenv("NATS_URL")
	if url == "" {
		slog.Info("NATS_URL not set, NATS FEP subscriber disabled")
		return nil
	}

	nc, err := nats.Connect(url,
		nats.Name("agentops-console/multiplexer"),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				slog.Warn("NATS subscriber disconnected", "error", err)
			}
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			slog.Info("NATS subscriber reconnected")
		}),
	)
	if err != nil {
		slog.Error("failed to connect to NATS for FEP subscription", "url", url, "error", err)
		return nil
	}

	ns := &natsSubscriber{
		nc:     nc,
		eventC: eventC,
	}

	// Subscribe to all agent FEP events: agents.{namespace}.{agentName}.fep.{eventType}
	sub, err := nc.Subscribe("agents.>", ns.handleMessage)
	if err != nil {
		slog.Error("failed to subscribe to NATS agent events", "error", err)
		nc.Close()
		return nil
	}
	ns.sub = sub

	slog.Info("NATS FEP subscriber started", "url", url, "subject", "agents.>")
	return ns
}

// handleMessage parses a NATS message subject and payload, then injects
// into the multiplexer event channel.
//
// Subject format: agents.{namespace}.{agentName}.fep.{eventType}
// The eventType may contain dots (e.g., delegation.run_completed) so we
// rejoin everything after the 4th segment.
func (ns *natsSubscriber) handleMessage(msg *nats.Msg) {
	// Parse subject: agents.{namespace}.{agentName}.fep.{eventType...}
	parts := strings.SplitN(msg.Subject, ".", 5)
	if len(parts) < 5 || parts[0] != "agents" || parts[3] != "fep" {
		slog.Debug("NATS: ignoring message with unexpected subject", "subject", msg.Subject)
		return
	}

	namespace := parts[1]
	agentName := parts[2]
	eventType := parts[4] // may contain dots, e.g. "delegation.run_completed"

	// Parse the event payload to extract the type field for fep.Event
	var rawFields map[string]json.RawMessage
	if err := json.Unmarshal(msg.Data, &rawFields); err != nil {
		slog.Warn("NATS: failed to unmarshal FEP event", "subject", msg.Subject, "error", err)
		return
	}

	// Build the enveloped event.
	// We pass the raw JSON so all fields (including delegation-specific ones like
	// groupId, runName, childAgent) survive without needing explicit struct fields.
	agentKey := AgentKey{Namespace: namespace, Name: agentName}

	evt := EnvelopedEvent{
		Agent:     agentKey,
		EventType: "agent.event",
		Event:     fep.Event{Type: eventType},
		RawEvent:  json.RawMessage(msg.Data),
	}

	select {
	case ns.eventC <- evt:
	default:
		slog.Warn("NATS: event channel full, dropping FEP event",
			"agent", fmt.Sprintf("%s/%s", namespace, agentName),
			"type", eventType,
		)
	}
}

// close drains and closes the NATS connection.
func (ns *natsSubscriber) close() {
	if ns.sub != nil {
		ns.sub.Unsubscribe()
	}
	if ns.nc != nil {
		ns.nc.Drain()
	}
}
