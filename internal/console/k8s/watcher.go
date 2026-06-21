// CRD resource event watcher with pub/sub for SSE consumers.
package k8s

import (
	"sync"
)

// EventType represents the type of K8s resource event.
type EventType string

const (
	EventAdded    EventType = "ADDED"
	EventModified EventType = "MODIFIED"
	EventDeleted  EventType = "DELETED"
)

// ResourceEvent is emitted when a watched CRD changes.
type ResourceEvent struct {
	Type         EventType   `json:"type"`
	ResourceKind string      `json:"resourceKind"` // Agent, AgentRun, Channel, Integration
	Namespace    string      `json:"namespace"`
	Name         string      `json:"name"`
	Resource     interface{} `json:"-"` // full K8s object (not serialized directly)
}

// Subscriber is a callback function that receives resource events.
type Subscriber func(event ResourceEvent)

// Watcher provides pub/sub for K8s resource events.
type Watcher struct {
	mu          sync.RWMutex
	subscribers map[int]Subscriber
	nextID      int
}

// NewWatcher creates a new event watcher.
func NewWatcher() *Watcher {
	return &Watcher{
		subscribers: make(map[int]Subscriber),
	}
}

// Subscribe registers a callback for resource events.
// Returns an unsubscribe function.
func (w *Watcher) Subscribe(fn Subscriber) func() {
	w.mu.Lock()
	id := w.nextID
	w.nextID++
	w.subscribers[id] = fn
	w.mu.Unlock()

	return func() {
		w.mu.Lock()
		delete(w.subscribers, id)
		w.mu.Unlock()
	}
}

// Notify sends an event to all subscribers (non-blocking, each in its own goroutine).
func (w *Watcher) Notify(event ResourceEvent) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	for _, fn := range w.subscribers {
		fn := fn // capture
		go fn(event)
	}
}
