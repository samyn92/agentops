// Global SSE event store — connects to the multiplexed SSE stream
// and dispatches events to subscribers.
import { createSignal } from 'solid-js';
import { connectGlobalSSE } from '../lib/api';
import type { FEPEvent, AgentEventEnvelope } from '../types';

export type AgentKey = { namespace: string; name: string };

// Subscriber callback type
type FEPSubscriber = (agentKey: AgentKey, event: FEPEvent) => void;
type ResourceSubscriber = () => void;

/** A work-board label transition pushed by the gitlab-label bridge over NATS.
 *  Carried inside an `agent.event` whose inner event `type` is `board_changed`,
 *  so the board updates in real time without polling GitLab. */
export interface BoardChangedEvent {
  type: 'board_changed';
  project_id: number;
  iid: number;
  target?: string;
  from?: string;
  to?: string;
  state?: string;
  web_url?: string;
  title?: string;
  timestamp?: string;
}
type BoardSubscriber = (event: BoardChangedEvent) => void;

// ── Singleton state ──

let eventSource: EventSource | null = null;
const fepSubscribers = new Set<FEPSubscriber>();
const resourceSubscribers = new Set<ResourceSubscriber>();
const boardSubscribers = new Set<BoardSubscriber>();

const [connected, setConnected] = createSignal(false);

// ── Public API ──

export { connected };

/** Start the global SSE connection. Call once at app mount. */
export function startEventStream() {
  if (eventSource) return;

  eventSource = connectGlobalSSE(
    (eventType, data) => {
      switch (eventType) {
        case 'connected':
          setConnected(true);
          break;

        case 'agent.event': {
          const envelope = data as AgentEventEnvelope;
          // Work-board transitions ride the FEP/NATS channel as a synthetic
          // agent.event (subject …fep.board_changed). Route them to board
          // subscribers so the kanban updates in real time, no polling.
          const ev = envelope.event as { type?: string } | undefined;
          if (ev?.type === 'board_changed') {
            boardSubscribers.forEach((fn) => fn(envelope.event as unknown as BoardChangedEvent));
            break;
          }
          const key: AgentKey = {
            namespace: envelope.agent.namespace,
            name: envelope.agent.name,
          };
          fepSubscribers.forEach((fn) => fn(key, envelope.event));
          break;
        }

        case 'resource.changed':
          resourceSubscribers.forEach((fn) => fn());
          break;

        case 'heartbeat':
          // keepalive, no action needed
          break;
      }
    },
    () => {
      setConnected(false);
      // Auto-reconnect is handled by EventSource natively
    },
  );
}

/** Stop the global SSE connection. */
export function stopEventStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
    setConnected(false);
  }
}

// ── Subscribe helpers ──

/** Subscribe to FEP events for a specific agent (or all agents if key is null). */
export function onFEPEvent(
  agentKey: AgentKey | null,
  callback: (event: FEPEvent) => void,
): () => void {
  const fn: FEPSubscriber = (key, event) => {
    if (!agentKey || (key.namespace === agentKey.namespace && key.name === agentKey.name)) {
      callback(event);
    }
  };
  fepSubscribers.add(fn);
  return () => fepSubscribers.delete(fn);
}

/** Subscribe to FEP events with agent identity. Used by the global event
 *  listener to route NATS-originated events to the correct agent state. */
export function onFEPEventWithKey(
  callback: (agentKey: AgentKey, event: FEPEvent) => void,
): () => void {
  const fn: FEPSubscriber = (key, event) => {
    callback(key, event);
  };
  fepSubscribers.add(fn);
  return () => fepSubscribers.delete(fn);
}

/** Subscribe to K8s resource change notifications (triggers refetch). */
export function onResourceChanged(callback: ResourceSubscriber): () => void {
  resourceSubscribers.add(callback);
  return () => resourceSubscribers.delete(callback);
}

/** Subscribe to work-board label transitions (gitlab-label bridge over NATS).
 *  Fires the moment a card changes column, so the board updates in real time
 *  instead of polling GitLab. */
export function onBoardChanged(callback: BoardSubscriber): () => void {
  boardSubscribers.add(callback);
  return () => boardSubscribers.delete(callback);
}
