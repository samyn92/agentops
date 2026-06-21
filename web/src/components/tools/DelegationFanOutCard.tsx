// DelegationFanOutCard — parallel delegation (run_agents) result card.
// Shows the delegation group with individual run status, live progress
// from FEP events, and clickable navigation to run details.
import { Show, For, createMemo } from 'solid-js';
import Badge from '../shared/Badge';
import RunPhaseIcon from '../shared/RunPhaseIcon';
import RunOutcome from '../shared/RunOutcome';
import { allRuns, selectRun } from '../../stores/runs';
import { selectAgent } from '../../stores/agents';
import { showRunDetail } from '../../stores/view';
import { relativeTime } from '../../lib/format';
import type { ToolMetadata, AgentRunResponse } from '../../types';

interface DelegationFanOutCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  headerless?: boolean;
}

interface DelegationRunMeta {
  agentName: string;
  runName: string;
}

interface CompletedRunInfo {
  childAgent: string;
  phase: string;
  duration: string;
}

function openRun(run: AgentRunResponse) {
  selectAgent(run.metadata.namespace, run.spec.agentRef);
  selectRun(run.metadata.namespace, run.metadata.name);
  showRunDetail();
}

function phaseVariant(phase: string | undefined): 'success' | 'warning' | 'error' | 'info' | 'muted' {
  switch (phase) {
    case 'Completed': case 'Succeeded': return 'success';
    case 'Running': case 'Pending': case 'Queued': return 'warning';
    case 'Failed': case 'Error': return 'error';
    default: return 'muted';
  }
}

/** Format Go duration string (e.g. "1m23s") to a more readable display */
function formatGoDuration(d: string | undefined): string {
  if (!d) return '';
  return d;
}

export default function DelegationFanOutCard(props: DelegationFanOutCardProps) {
  const meta = () => props.metadata || {};
  const groupId = () => (meta().groupId || '') as string;
  const timeout = () => (meta().timeout || '') as string;

  // Runs from the tool result metadata
  const runs = createMemo<DelegationRunMeta[]>(() => {
    const r = meta().runs as DelegationRunMeta[] | undefined;
    return r || [];
  });

  // Live delegation state from FEP event updates (set by chat store)
  const completedRuns = () => (meta()._completedRuns || {}) as Record<string, CompletedRunInfo>;
  const allCompleted = () => !!meta()._allCompleted;
  const timedOut = () => !!meta()._timedOut;
  const succeeded = () => (meta()._succeeded || 0) as number;
  const failed = () => (meta()._failed || 0) as number;
  const totalDuration = () => (meta()._totalDuration || '') as string;
  const timedOutCount = () => (meta()._timedOutCount || 0) as number;
  const completedCount = () => (meta()._completedCount || 0) as number;

  // Progress
  const totalCount = () => runs().length;
  const doneCount = () => Object.keys(completedRuns()).length;
  const progressPct = () => totalCount() > 0 ? Math.round((doneCount() / totalCount()) * 100) : 0;

  // Resolve each run from the runs store
  const resolvedRun = (runName: string): AgentRunResponse | undefined => {
    return (allRuns() ?? []).find(
      (r) => r.metadata.name === runName,
    );
  };

  // Get run phase — prefer live FEP data, fall back to K8s store
  const getRunPhase = (runName: string): string => {
    const completed = completedRuns()[runName];
    if (completed) return completed.phase;
    const resolved = resolvedRun(runName);
    if (resolved?.status?.phase) return resolved.status.phase;
    return 'Pending';
  };

  // Group status badge
  const groupStatus = createMemo(() => {
    if (timedOut()) return { label: 'Timed Out', variant: 'error' as const };
    if (allCompleted()) {
      if (failed() > 0) return { label: `${succeeded()} ok / ${failed()} failed`, variant: 'warning' as const };
      return { label: 'All Completed', variant: 'success' as const };
    }
    if (doneCount() > 0) return { label: `${doneCount()}/${totalCount()}`, variant: 'info' as const };
    return { label: 'Running', variant: 'warning' as const };
  });

  const handleRunClick = (e: MouseEvent, runName: string) => {
    e.stopPropagation();
    const r = resolvedRun(runName);
    if (r) openRun(r);
  };

  // ── Individual run row ──
  const RunRow = (rowProps: { run: DelegationRunMeta }) => {
    const phase = () => getRunPhase(rowProps.run.runName);
    const resolved = () => resolvedRun(rowProps.run.runName);
    const completed = () => completedRuns()[rowProps.run.runName];
    const outcome = () => resolved()?.status?.outcome;
    const intentHint = () => resolved()?.spec.outcome?.intent;
    const hasOutcome = () => !!(outcome() || intentHint());
    const isClickable = () => !!resolved();

    return (
      <button
        class={`w-full text-left px-3 py-2 rounded-md transition-colors ${
          isClickable() ? 'hover:bg-surface-hover/50 cursor-pointer' : 'cursor-default'
        } ${completed()?.phase === 'Failed' ? 'bg-error/5' : ''}`}
        onClick={(e) => handleRunClick(e, rowProps.run.runName)}
        disabled={!isClickable()}
      >
        <div class="flex items-center gap-2 min-w-0">
          {/* Agent name */}
          <span class="text-xs font-medium px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 font-mono shrink-0">
            {rowProps.run.agentName}
          </span>

          <span class="flex-1" />

          {/* Duration (from FEP completion event) */}
          <Show when={completed()?.duration}>
            <span class="text-[10px] text-text-muted font-mono">{formatGoDuration(completed()!.duration)}</span>
          </Show>

          {/* Phase icon */}
          <RunPhaseIcon phase={phase()} />
        </div>

        {/* Outcome chips */}
        <Show when={hasOutcome()}>
          <div class="mt-1" onClick={(e) => e.stopPropagation()}>
            <RunOutcome
              outcome={outcome()}
              intentHint={intentHint()}
              variant="compact"
              showSummary={false}
            />
          </div>
        </Show>

        {/* Run name + time */}
        <div class="flex items-center gap-2 mt-0.5 text-[10px] text-text-muted">
          <span class="truncate font-mono">{rowProps.run.runName}</span>
          <Show when={resolved()}>
            <span class="ml-auto shrink-0">{relativeTime(resolved()!.metadata.creationTimestamp)}</span>
          </Show>
        </div>
      </button>
    );
  };

  // ── Card body ──
  const Body = () => (
    <div class="divide-y divide-border-subtle/30">
      {/* Progress bar */}
      <Show when={!allCompleted() && !timedOut() && totalCount() > 0}>
        <div class="px-3 py-2">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] text-text-muted">Progress</span>
            <span class="text-[10px] text-text-secondary font-mono">{doneCount()}/{totalCount()}</span>
          </div>
          <div class="w-full h-1 bg-surface-3 rounded-full overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct()}%` }}
            />
          </div>
        </div>
      </Show>

      {/* Completion summary */}
      <Show when={allCompleted()}>
        <div class="px-3 py-2 flex items-center gap-2">
          <svg class="w-4 h-4 text-success" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          <span class="text-xs text-text-secondary">
            All {totalCount()} agents completed
            <Show when={totalDuration()}>
              {' '}in <span class="font-mono text-text">{formatGoDuration(totalDuration())}</span>
            </Show>
          </span>
          <Show when={failed() > 0}>
            <Badge variant="error">{failed()} failed</Badge>
          </Show>
        </div>
      </Show>

      {/* Timeout summary */}
      <Show when={timedOut()}>
        <div class="px-3 py-2 flex items-center gap-2">
          <svg class="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-xs text-warning">
            Timed out: {completedCount()} completed, {timedOutCount()} still running
          </span>
        </div>
      </Show>

      {/* Individual run rows */}
      <div class="py-1">
        <For each={runs()}>
          {(run) => <RunRow run={run} />}
        </For>
      </div>
    </div>
  );

  if (props.headerless) {
    return <div class={props.class || ''}><Body /></div>;
  }

  return (
    <div class={`border rounded-lg overflow-hidden my-1 ${
      timedOut() ? 'border-warning/30 bg-gradient-to-br from-warning/5 via-orange-500/3 to-transparent' :
      allCompleted() && failed() === 0 ? 'border-success/20 bg-gradient-to-br from-success/5 via-emerald-500/3 to-transparent' :
      'border-indigo-400/20 bg-gradient-to-br from-indigo-500/5 via-purple-500/3 to-transparent'
    } ${props.class || ''}`}>
      {/* Header */}
      <div class={`flex items-center gap-2 px-3 py-1.5 border-b border-inherit ${
        timedOut() ? 'bg-gradient-to-r from-warning/10 via-orange-500/6 to-transparent' :
        allCompleted() && failed() === 0 ? 'bg-gradient-to-r from-success/10 via-emerald-500/6 to-transparent' :
        'bg-gradient-to-r from-indigo-500/10 via-purple-500/6 to-transparent'
      }`}>
        {/* Fan-out icon */}
        <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
        </svg>

        <span class="text-xs font-semibold bg-gradient-to-r from-indigo-300 to-purple-300 bg-clip-text text-transparent">
          Parallel Delegation
        </span>

        <span class="text-[10px] font-mono text-text-muted/70 truncate">
          {groupId()}
        </span>

        <div class="flex items-center gap-1.5 ml-auto">
          <Badge variant={groupStatus().variant}>{groupStatus().label}</Badge>
        </div>
      </div>

      <Body />
    </div>
  );
}
