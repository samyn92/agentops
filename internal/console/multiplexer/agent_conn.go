// Per-agent SSE connection manager.
// Connects to a single Fantasy runtime and relays FEP events.
package multiplexer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/samyn92/agentops/internal/console/fep"
)

// AgentKey uniquely identifies an agent.
type AgentKey struct {
	Namespace string
	Name      string
}

func (k AgentKey) String() string {
	return k.Namespace + "/" + k.Name
}

// AgentConn manages a persistent SSE connection to a single agent runtime.
type AgentConn struct {
	Key    AgentKey
	URL    string // base URL, e.g. http://agent.ns.svc:4096
	eventC chan<- EnvelopedEvent
	httpC  *http.Client // shared client with timeout for health checks

	mu     sync.Mutex
	cancel context.CancelFunc
	online bool
}

// EnvelopedEvent is an FEP event wrapped with agent identity.
// RawEvent carries the original JSON so delegation-specific fields
// (groupId, runName, childAgent, etc.) survive the relay without
// needing explicit struct fields in fep.Event.
type EnvelopedEvent struct {
	Agent     AgentKey        `json:"agent"`
	EventType string          `json:"eventType"` // SSE event type for the global stream
	Event     fep.Event       `json:"event"`
	RawEvent  json.RawMessage `json:"-"` // original JSON; preferred over Event when set
}

// NewAgentConn creates a new agent connection manager.
func NewAgentConn(key AgentKey, url string, eventC chan<- EnvelopedEvent) *AgentConn {
	return &AgentConn{
		Key:    key,
		URL:    url,
		eventC: eventC,
		httpC:  &http.Client{Timeout: 10 * time.Second},
	}
}

// Start begins the SSE connection loop with reconnection backoff.
func (ac *AgentConn) Start(ctx context.Context) {
	connCtx, cancel := context.WithCancel(ctx)
	ac.mu.Lock()
	ac.cancel = cancel
	ac.mu.Unlock()

	go ac.connectLoop(connCtx)
}

// Stop cancels the SSE connection.
func (ac *AgentConn) Stop() {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	if ac.cancel != nil {
		ac.cancel()
		ac.cancel = nil
	}
}

// IsOnline returns whether the agent connection is currently active.
func (ac *AgentConn) IsOnline() bool {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	return ac.online
}

func (ac *AgentConn) setOnline(v bool) {
	ac.mu.Lock()
	prev := ac.online
	ac.online = v
	ac.mu.Unlock()

	if v && !prev {
		ac.emitStatus("agent.online")
	} else if !v && prev {
		ac.emitStatus("agent.offline")
	}
}

func (ac *AgentConn) emitStatus(eventType string) {
	select {
	case ac.eventC <- EnvelopedEvent{
		Agent:     ac.Key,
		EventType: eventType,
		Event:     fep.Event{Type: eventType},
	}:
	default:
		slog.Warn("event channel full, dropping status event", "agent", ac.Key, "type", eventType)
	}
}

func (ac *AgentConn) connectLoop(ctx context.Context) {
	attempt := 0
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-ctx.Done():
			ac.setOnline(false)
			return
		default:
		}

		err := ac.connect(ctx)
		ac.setOnline(false)

		if ctx.Err() != nil {
			return
		}

		// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s
		attempt++
		backoff := time.Duration(math.Min(float64(time.Second)*math.Pow(2, float64(attempt-1)), float64(maxBackoff)))

		slog.Warn("agent SSE disconnected, reconnecting",
			"agent", ac.Key,
			"error", err,
			"backoff", backoff,
			"attempt", attempt,
		)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
	}
}

func (ac *AgentConn) connect(ctx context.Context) error {
	// We connect to the agent's healthz first to verify connectivity,
	// then note it as online. We don't maintain a persistent SSE connection
	// to the runtime's stream endpoint because FEP streams are per-prompt
	// (not persistent). Instead, the multiplexer receives events when
	// the console backend proxies prompt/stream requests.
	//
	// The agent connection's primary role is health checking and
	// providing the event relay channel when streams are active.

	healthURL := fmt.Sprintf("%s/healthz", ac.URL)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := ac.httpC.Do(req)
	if err != nil {
		return fmt.Errorf("health check: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check returned %d", resp.StatusCode)
	}

	ac.setOnline(true)
	slog.Info("agent connected", "agent", ac.Key)

	// Reset attempt counter on successful connection
	// Now poll healthz periodically to detect disconnection
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := ac.healthCheck(ctx); err != nil {
				return fmt.Errorf("health check failed: %w", err)
			}
		}
	}
}

func (ac *AgentConn) healthCheck(ctx context.Context) error {
	healthURL := fmt.Sprintf("%s/healthz", ac.URL)

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		return err
	}

	resp, err := ac.httpC.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}
