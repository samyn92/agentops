// Runs store — reactive AgentRun state with global sorting, delegation map, and per-agent context.
import { createSignal, createResource, createMemo } from 'solid-js';
import { agentRuns } from '../lib/api';
import { selectedAgent, agentList as agentListRef } from './agents';
import { onResourceChanged } from './events';
import type { AgentRunResponse } from '../types';

// ── Types ──

export type RunFilter = 'all' | 'active' | 'completed' | 'failed';
export type RunSource = 'channel' | 'agent' | 'schedule' | 'console' | 'unknown';

// ── State ──

const [runFilter, setRunFilter] = createSignal<RunFilter>('all');
const [selectedRunKey, setSelectedRunKey] = createSignal<string | null>(null);
const [refetchTrigger, setRefetchTrigger] = createSignal(0);

// Fetch all runs
const [allRuns, { refetch: refetchRuns }] = createResource(
  refetchTrigger,
  async () => {
    try {
      return await agentRuns.list();
    } catch (err) {
      console.error('Failed to fetch runs:', err);
      return [];
    }
  },
);

// Auto-refetch when K8s resources change (AgentRun CRD events)
onResourceChanged(() => {
  setRefetchTrigger((n) => n + 1);
});

// Also poll every 10s for active runs (phases like Running/Pending/Queued change frequently)
let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startRunPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    const runs = allRuns();
    if (runs?.some((r) => isActivePhase(r.status?.phase))) {
      setRefetchTrigger((n) => n + 1);
    }
  }, 10_000);
}

export function stopRunPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ── Derived state ──

/** Runs for the currently selected agent.
 *  For daemon (orchestrator) agents: only runs targeting this agent (agentRef match).
 *    Delegated worker runs live in the Delegation tab, not the sidebar.
 *  For task agents: runs targeting OR sourced from this agent (agentRef OR sourceRef).
 *  Always sorted newest-first for consistent ordering.
 */
const contextualRuns = createMemo<AgentRunResponse[]>(() => {
  const runs = allRuns() ?? [];
  const agent = selectedAgent();

  if (!agent) return sortNewestFirst(runs);

  // Look up agent mode from the agent list
  const agentInfo = agentListRef()?.find(
    (a) => a.namespace === agent.namespace && a.name === agent.name,
  );
  const isDaemon = agentInfo?.mode === 'daemon';

  if (isDaemon) {
    // Orchestrators: only their own runs (not delegated worker runs)
    return sortNewestFirst(runs.filter((r) => r.spec.agentRef === agent.name));
  }
  // Task/channel agents: runs targeting or sourced from this agent
  return sortNewestFirst(runs.filter(
    (r) => r.spec.agentRef === agent.name || r.spec.sourceRef === agent.name,
  ));
});

/** Runs filtered by phase filter, sorted newest-first globally. */
const filteredRuns = createMemo<AgentRunResponse[]>(() => {
  const runs = sortNewestFirst(allRuns() ?? []);
  const filter = runFilter();

  switch (filter) {
    case 'active':
      return runs.filter((r) => isActivePhase(r.status?.phase));
    case 'completed':
      return runs.filter((r) => r.status?.phase === 'Succeeded');
    case 'failed':
      return runs.filter((r) => r.status?.phase === 'Failed');
    default:
      return runs;
  }
});

/** Count of active (non-terminal) runs across all agents. */
const activeRunCount = createMemo(() => {
  const runs = allRuns() ?? [];
  return runs.filter((r) => isActivePhase(r.status?.phase)).length;
});

/** Count of active runs for the currently selected agent. */
const contextActiveRunCount = createMemo(() => {
  return contextualRuns().filter((r) => isActivePhase(r.status?.phase)).length;
});

/** Concurrency info for the selected agent (derived from run counts). */
const concurrencyInfo = createMemo(() => {
  const agent = selectedAgent();
  if (!agent) return null;

  const agentRuns = contextualRuns();
  const running = agentRuns.filter((r) => r.status?.phase === 'Running').length;
  const queued = agentRuns.filter((r) => r.status?.phase === 'Queued').length;

  return { running, queued };
});

// ── Delegation Map ──
// Maps daemon agent names to the task agent names they have delegated to.
// Built from run history: if a run has source="agent" and sourceRef="daemon-x"
// and agentRef="task-y", then daemon-x delegates to task-y.

const delegationMap = createMemo<Record<string, string[]>>(() => {
  const runs = allRuns() ?? [];
  const map: Record<string, Set<string>> = {};

  for (const run of runs) {
    if (run.spec.source === 'agent' && run.spec.sourceRef) {
      const daemon = run.spec.sourceRef;
      const task = run.spec.agentRef;
      if (!map[daemon]) map[daemon] = new Set();
      map[daemon].add(task);
    }
  }

  // Convert Sets to Arrays
  const result: Record<string, string[]> = {};
  for (const [daemon, tasks] of Object.entries(map)) {
    result[daemon] = Array.from(tasks);
  }
  return result;
});

export function getDelegationMap(): Record<string, string[]> {
  return delegationMap();
}

// ── Delegation Groups (by CRD label) ──
// Groups runs that share the same `agents.agentops.io/delegation-group` label.
// Each group is a parallel fan-out from a single run_agents call.

const DELEGATION_GROUP_LABEL = 'agents.agentops.io/delegation-group';

export interface DelegationGroupInfo {
  groupId: string;
  sourceAgent: string; // the daemon that created the delegation
  runs: AgentRunResponse[];
  activeCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: string; // earliest creation timestamp in the group
}

/** All delegation groups, sorted newest-first by group creation time. */
const delegationGroups = createMemo<DelegationGroupInfo[]>(() => {
  const runs = allRuns() ?? [];
  const groups = new Map<string, AgentRunResponse[]>();

  for (const run of runs) {
    const groupId = run.metadata.labels?.[DELEGATION_GROUP_LABEL];
    if (!groupId) continue;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId)!.push(run);
  }

  const result: DelegationGroupInfo[] = [];
  for (const [groupId, groupRuns] of groups) {
    const sorted = sortNewestFirst(groupRuns);
    const sourceAgent = sorted[0]?.spec.sourceRef || '';
    const activeCount = groupRuns.filter((r) => isActivePhase(r.status?.phase)).length;
    const completedCount = groupRuns.filter((r) => r.status?.phase === 'Succeeded').length;
    const failedCount = groupRuns.filter((r) => r.status?.phase === 'Failed').length;
    const createdAt = sorted[sorted.length - 1]?.metadata.creationTimestamp || '';

    result.push({ groupId, sourceAgent, runs: sorted, activeCount, completedCount, failedCount, createdAt });
  }

  // Newest groups first
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
});

export { delegationGroups, DELEGATION_GROUP_LABEL };

/** Get a specific delegation group by ID. */
export function getDelegationGroup(groupId: string): DelegationGroupInfo | undefined {
  return delegationGroups().find((g) => g.groupId === groupId);
}

/** Check if a run belongs to a delegation group. */
export function getRunDelegationGroup(run: AgentRunResponse): string | undefined {
  return run.metadata.labels?.[DELEGATION_GROUP_LABEL];
}

// ── Helpers ──

function sortNewestFirst(runs: AgentRunResponse[]): AgentRunResponse[] {
  return [...runs].sort((a, b) => {
    const ta = new Date(a.metadata.creationTimestamp).getTime();
    const tb = new Date(b.metadata.creationTimestamp).getTime();
    return tb - ta;
  });
}

function isActivePhase(phase?: string): boolean {
  return phase === 'Pending' || phase === 'Queued' || phase === 'Running';
}

export function getRunSource(run: AgentRunResponse): RunSource {
  const source = run.spec.source?.toLowerCase();
  if (source === 'channel') return 'channel';
  if (source === 'agent') return 'agent';
  if (source === 'schedule') return 'schedule';
  if (source === 'console') return 'console';
  return 'unknown';
}

export function getRunSourceIcon(source: RunSource): string {
  switch (source) {
    case 'channel': return 'bolt';
    case 'agent': return 'brain';
    case 'schedule': return 'clock';
    case 'console': return 'terminal';
    default: return 'circle';
  }
}

/** Concurrency info for any agent by name (not just the selected one). */
export function getAgentConcurrency(agentName: string): { running: number; queued: number } {
  const runs = allRuns() ?? [];
  const agentSpecificRuns = runs.filter((r) => r.spec.agentRef === agentName);
  const running = agentSpecificRuns.filter((r) => r.status?.phase === 'Running').length;
  const queued = agentSpecificRuns.filter((r) => r.status?.phase === 'Queued').length;
  return { running, queued };
}

/** Recent runs for any agent by name, sorted newest-first, capped at `limit`. */
export function getAgentRuns(agentName: string, limit = 20): AgentRunResponse[] {
  const runs = allRuns() ?? [];
  return runs
    .filter((r) => r.spec.agentRef === agentName)
    .sort((a, b) => new Date(b.metadata.creationTimestamp).getTime() - new Date(a.metadata.creationTimestamp).getTime())
    .slice(0, limit);
}

// ── Public API ──

export {
  allRuns,
  contextualRuns,
  filteredRuns,
  runFilter,
  setRunFilter,
  selectedRunKey,
  setSelectedRunKey,
  activeRunCount,
  contextActiveRunCount,
  concurrencyInfo,
  refetchRuns,
};

/** Select a run by namespace/name composite key. */
export function selectRun(ns: string, name: string) {
  setSelectedRunKey(`${ns}/${name}`);
}

/** Clear run selection. */
export function clearRunSelection() {
  setSelectedRunKey(null);
}

/** Force refresh the run list. */
export function refreshRuns() {
  setRefetchTrigger((n) => n + 1);
}

/** Get all runs delegated BY a specific orchestrator (source=agent, sourceRef=orchestratorName). */
export function getRunsDelegatedBy(orchestratorName: string): AgentRunResponse[] {
  const runs = allRuns() ?? [];
  return sortNewestFirst(
    runs.filter((r) => r.spec.source === 'agent' && r.spec.sourceRef === orchestratorName)
  );
}

/** Get delegation groups created by a specific orchestrator. */
export function getDelegationGroupsBy(orchestratorName: string): DelegationGroupInfo[] {
  return delegationGroups().filter((g) => g.sourceAgent === orchestratorName);
}

/** Get worker agent names used by a specific orchestrator (from delegation map). */
export function getWorkerAgentsFor(orchestratorName: string): string[] {
  return delegationMap()[orchestratorName] ?? [];
}
