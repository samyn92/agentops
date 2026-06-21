// Agent list store — tracks agents from the K8s API with health polling.
// Polls /status for every agent every 5s to determine reachability.
import { createSignal, createResource, createEffect, onCleanup } from 'solid-js';
import { agents as agentsAPI } from '../lib/api';
import { onResourceChanged } from './events';
import { clearCenterOverlay } from './view';
import type { AgentResponse, RuntimeStatus } from '../types';

export type AgentSelection = {
  namespace: string;
  name: string;
};

// ── Persistence ──

const STORAGE_KEY = 'agentops:selectedAgent';

function loadPersistedAgent(): AgentSelection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.namespace === 'string' && typeof parsed.name === 'string') {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

// ── State ──

const [selectedAgent, setSelectedAgent] = createSignal<AgentSelection | null>(loadPersistedAgent());
const [refetchTrigger, setRefetchTrigger] = createSignal(0);

// Persist agent selection to localStorage
createEffect(() => {
  const agent = selectedAgent();
  if (agent) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agent));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
});

// Fetch agents from API (refetches on trigger change)
const [agentList, { refetch: refetchAgents }] = createResource(
  refetchTrigger,
  async () => {
    try {
      return await agentsAPI.list();
    } catch (err) {
      console.error('Failed to fetch agents:', err);
      return [];
    }
  },
);

// Auto-refetch when K8s resources change
onResourceChanged(() => {
  setRefetchTrigger((n) => n + 1);
});

// ── Health polling ──
// Polls /status for every agent in the list every 5s.
// Stores reachability (boolean) and full RuntimeStatus per agent.

interface AgentHealth {
  reachable: boolean;
  status: RuntimeStatus | null;
}

const HEALTH_POLL_INTERVAL = 5000;

const [agentHealth, setAgentHealth] = createSignal<Record<string, AgentHealth>>({});
let healthPollTimer: ReturnType<typeof setInterval> | null = null;

async function pollAgentHealth(agent: AgentResponse): Promise<AgentHealth> {
  try {
    const status = await agentsAPI.status(agent.namespace, agent.name) as unknown as RuntimeStatus;
    return { reachable: true, status };
  } catch {
    return { reachable: false, status: null };
  }
}

async function pollAllAgents() {
  const agents = agentList();
  if (!agents || agents.length === 0) return;

  // Poll only daemon agents — task agents have no long-running pod to query
  const daemonAgents = agents.filter((a) => a.mode === "daemon");
  const results = await Promise.all(
    daemonAgents.map(async (agent) => {
      const health = await pollAgentHealth(agent);
      return { key: `${agent.namespace}/${agent.name}`, health };
    }),
  );

  // Batch-update the health map
  const newHealth: Record<string, AgentHealth> = {};
  for (const { key, health } of results) {
    newHealth[key] = health;
  }
  setAgentHealth(newHealth);
}

// Start polling when agent list is available
createEffect(() => {
  const agents = agentList();

  if (healthPollTimer) {
    clearInterval(healthPollTimer);
    healthPollTimer = null;
  }

  if (!agents || agents.length === 0) return;

  // Poll immediately
  pollAllAgents();

  // Then every 5s
  healthPollTimer = setInterval(pollAllAgents, HEALTH_POLL_INTERVAL);
});

onCleanup(() => {
  if (healthPollTimer) {
    clearInterval(healthPollTimer);
    healthPollTimer = null;
  }
});

/** Trigger an immediate health poll (e.g. after a stream finishes). */
export function refreshAgentHealth() {
  pollAllAgents();
}

// ── Public API ──

export { agentList, selectedAgent, setSelectedAgent, refetchAgents, agentHealth };

/**
 * Get the status for an agent.
 * `isOnline` is driven by direct /status polling — true when the pod responds.
 * `phase` comes from the CR for the badge label (Pending, Running, Failed).
 */
export function getAgentStatus(ns: string, name: string) {
  const key = `${ns}/${name}`;
  const health = agentHealth()[key];
  const agent = agentList()?.find((a) => a.namespace === ns && a.name === name);
  const phase = agent?.phase || 'Unknown';

  return {
    phase,
    isOnline: health?.reachable ?? false,
    image: agent?.image || '',
    model: agent?.model || '',
  };
}

/**
 * Get the RuntimeStatus for a specific agent (from the last health poll).
 * Used by the Composer for the context usage indicator.
 */
export function getAgentRuntimeStatus(ns: string, name: string): RuntimeStatus | null {
  const key = `${ns}/${name}`;
  return agentHealth()[key]?.status ?? null;
}

/** Select an agent by namespace/name. Clears any center-panel overlay (e.g. RunDetailView). */
export function selectAgent(ns: string, name: string) {
  clearCenterOverlay();
  setSelectedAgent({ namespace: ns, name });
}

/**
 * Get agents that a given orchestrator CAN delegate to (from its team roster).
 * The delegation.team list IS the access control — no more scope/visibility filtering.
 * Returns AgentResponse objects so UI can show model, phase, etc.
 */
export function getDelegationTargetsFor(callerName: string, callerNs: string): import('../types').AgentResponse[] {
  const agents = agentList();
  if (!agents) return [];

  // Find the caller's delegation spec to get their team roster
  const caller = agents.find((a) => a.name === callerName && a.namespace === callerNs);
  const team = caller?.delegation?.team ?? [];
  if (team.length === 0) return [];

  const teamSet = new Set(team);

  return agents.filter((a) => {
    // Only include agents in the same namespace
    if (a.namespace !== callerNs) return false;
    // Only include agents on the team roster
    return teamSet.has(a.name);
  });
}
