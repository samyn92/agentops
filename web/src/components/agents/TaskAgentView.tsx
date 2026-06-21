// TaskAgentView — central view for task agents.
// Shows a rich run timeline with structured outcome (intent + artifacts),
// replacing the empty ChatView. PR/MR/branch/commit chips are rendered by
// the shared <RunOutcome> component.
import { For, Show, createSignal, createMemo, createResource } from 'solid-js';
import { Collapsible } from '@ark-ui/solid/collapsible';
import { selectedAgent, agentList } from '../../stores/agents';
import { contextualRuns, getRunSource, type RunSource } from '../../stores/runs';
import { agents as agentsAPI } from '../../lib/api';
import Badge from '../shared/Badge';
import NeuralTrace from '../shared/NeuralTrace';
import RunOutcome from '../shared/RunOutcome';
import { relativeTime, phaseVariant, formatTokens, formatCost, formatDateTime } from '../../lib/format';
import type { AgentRunResponse, AgentCRD } from '../../types';

interface TaskAgentViewProps {
  class?: string;
}

export default function TaskAgentView(props: TaskAgentViewProps) {
  const agent = () => selectedAgent();
  const runs = () => contextualRuns();

  // Fetch full CRD for agent details
  const [crd] = createResource(
    () => {
      const a = agent();
      return a ? { ns: a.namespace, name: a.name } : null;
    },
    async (key) => {
      if (!key) return null;
      return agentsAPI.get(key.ns, key.name) as Promise<AgentCRD>;
    },
  );

  const activeRuns = createMemo(() =>
    runs().filter((r) => r.status?.phase === 'Running' || r.status?.phase === 'Pending' || r.status?.phase === 'Queued'),
  );

  const hasActiveRuns = () => activeRuns().length > 0;

  const agentInfo = createMemo(() => {
    const a = agent();
    if (!a) return null;
    const list = agentList();
    return list?.find((ag) => ag.namespace === a.namespace && ag.name === a.name) ?? null;
  });

  return (
    <div class={`flex flex-col h-full ${props.class || ''}`}>
      {/* Header */}
      <div class="flex-shrink-0 border-b border-border bg-surface">
        <div class="px-6 py-4">
          <div class="flex items-center gap-3 mb-2">
            <div class="w-9 h-9 rounded-xl bg-accent/12 flex items-center justify-center flex-shrink-0">
              <svg class="w-4.5 h-4.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <h1 class="text-lg font-semibold text-text truncate tracking-tight">
                {agent()?.name}
              </h1>
              <div class="flex items-center gap-2 mt-0.5">
                <Show when={agentInfo()?.model}>
                  <span class="text-xs text-text-muted font-mono">{agentInfo()!.model}</span>
                </Show>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-accent/12 text-accent">
                  task
                </span>
                <Show when={agentInfo()?.phase}>
                  <Badge variant={phaseVariant(agentInfo()!.phase)} dot>
                    {agentInfo()!.phase}
                  </Badge>
                </Show>
              </div>
            </div>
            <div class="flex items-center gap-3 text-xs text-text-muted flex-shrink-0">
              <div class="text-right">
                <div class="font-mono text-text-secondary">{runs().length}</div>
                <div>total runs</div>
              </div>
              <Show when={hasActiveRuns()}>
                <div class="text-right">
                  <div class="font-mono text-success">{activeRuns().length}</div>
                  <div>active</div>
                </div>
              </Show>
            </div>
          </div>
        </div>
        <NeuralTrace active={hasActiveRuns()} size="sm" />
      </div>

      {/* Run timeline */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={runs().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full text-center px-6">
              <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
                <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
                </svg>
              </div>
              <h3 class="text-sm font-medium text-text mb-1">No runs yet</h3>
              <p class="text-xs text-text-muted max-w-xs">
                This task agent runs on-demand. Runs are triggered by daemon agents via <code class="text-accent">run_agent</code>, channels, or schedules.
              </p>
            </div>
          }
        >
          <div class="px-4 py-3 space-y-2">
            <For each={runs()}>
              {(run) => <RunCard run={run} />}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ── RunCard — rich run display with git workspace info ──

function RunCard(props: { run: AgentRunResponse }) {
  const [expanded, setExpanded] = createSignal(false);
  const run = () => props.run;
  const source = () => getRunSource(run());
  const isActive = () => {
    const phase = run().status?.phase;
    return phase === 'Running' || phase === 'Pending' || phase === 'Queued';
  };
  const hasGit = () => !!run().spec.git;
  const hasOutcome = () => !!run().status?.outcome || !!run().spec.outcome?.intent;

  return (
    <Collapsible.Root
      open={expanded()}
      onOpenChange={(details) => setExpanded(details.open)}
      class={`run-card rounded-xl border transition-all ${
        expanded()
          ? 'border-border-hover bg-surface shadow-md'
          : 'border-border-subtle bg-surface hover:border-border hover:shadow-sm'
      } ${isActive() ? 'run-card--active' : ''}`}
    >
      {/* Header row — clickable */}
      <Collapsible.Trigger
        class="w-full text-left px-4 py-3"
      >
        <div class="flex items-center gap-2.5 mb-1.5">
          <SourceIcon source={source()} />
          <span class="text-sm font-medium text-text truncate flex-1">
            {run().metadata.name}
          </span>
          <Badge variant={phaseVariant(run().status?.phase)} dot>
            {run().status?.phase || '?'}
          </Badge>
        </div>

        {/* Outcome badge row (intent + artifacts) */}
        <Show when={hasOutcome()}>
          <div class="mb-1.5" onClick={(e) => e.stopPropagation()}>
            <RunOutcome
              outcome={run().status?.outcome}
              intentHint={run().spec.outcome?.intent}
              variant="compact"
              showSummary={false}
            />
          </div>
        </Show>

        {/* Meta row */}
        <div class="flex items-center gap-2 text-[11px] text-text-muted">
          <Show when={run().spec.source}>
            <span>via {run().spec.source}</span>
            <Show when={run().spec.sourceRef}>
              <span class="text-text-muted/50">/</span>
              <span class="text-text-secondary">{run().spec.sourceRef}</span>
            </Show>
          </Show>
          <Show when={run().status?.model}>
            <span class="text-text-muted/50">|</span>
            <span class="font-mono">{run().status!.model}</span>
          </Show>
          <span class="ml-auto">{relativeTime(run().metadata.creationTimestamp)}</span>
        </div>

        {/* Prompt preview */}
        <Show when={run().spec.prompt && !expanded()}>
          <p class="text-xs text-text-secondary/70 mt-1.5 line-clamp-2">
            {run().spec.prompt}
          </p>
        </Show>
      </Collapsible.Trigger>

      {/* Active run neural trace */}
      <Show when={isActive()}>
        <NeuralTrace active size="sm" />
      </Show>

      {/* Expanded details */}
      <Collapsible.Content class="overflow-hidden">
        <div class="px-4 pb-4 pt-0 border-t border-border-subtle space-y-3">
          {/* Prompt */}
          <div>
            <span class="text-[10px] text-text-muted uppercase tracking-wider font-medium">Prompt</span>
            <pre class="text-xs text-text-secondary font-mono whitespace-pre-wrap bg-surface-2 rounded-lg p-3 mt-1 max-h-48 overflow-y-auto border border-border-subtle">
              {run().spec.prompt}
            </pre>
          </div>

          {/* Stats grid */}
          <div class="grid grid-cols-2 gap-2">
            <Show when={run().status?.tokensUsed}>
              <StatBlock label="Tokens" value={formatTokens(run().status!.tokensUsed!)} />
            </Show>
            <Show when={run().status?.toolCalls}>
              <StatBlock label="Tool Calls" value={String(run().status!.toolCalls)} />
            </Show>
            <Show when={run().status?.cost}>
              <StatBlock label="Cost" value={formatCost(run().status!.cost!)} />
            </Show>
            <Show when={run().status?.startTime}>
              <StatBlock label="Started" value={formatDateTime(run().status!.startTime!)} />
            </Show>
            <Show when={run().status?.completionTime}>
              <StatBlock label="Completed" value={formatDateTime(run().status!.completionTime!)} />
            </Show>
          </div>

          {/* Git workspace details */}
          <Show when={hasGit()}>
            <div class="git-workspace-detail">
              <div class="flex items-center gap-2 mb-2">
                <svg class="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3H9m-3 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
                </svg>
                <span class="text-xs font-medium text-text">Git Workspace</span>
              </div>
              <div class="space-y-1.5">
                <Show when={run().spec.git?.resourceRef}>
                  <DetailRow label="Resource" value={run().spec.git!.resourceRef} />
                </Show>
                <Show when={run().spec.git?.baseBranch}>
                  <DetailRow label="Base" value={run().spec.git!.baseBranch!} mono />
                </Show>
              </div>
            </div>
          </Show>

          {/* Outcome (full) */}
          <Show when={hasOutcome()}>
            <div>
              <span class="text-[10px] text-text-muted uppercase tracking-wider font-medium">Outcome</span>
              <div class="mt-1.5">
                <RunOutcome
                  outcome={run().status?.outcome}
                  intentHint={run().spec.outcome?.intent}
                  variant="full"
                />
              </div>
            </div>
          </Show>

          {/* Output */}
          <Show when={run().status?.output}>
            <div>
              <span class="text-[10px] text-text-muted uppercase tracking-wider font-medium">Output</span>
              <pre class="text-xs text-text-secondary font-mono whitespace-pre-wrap bg-surface-2 rounded-lg p-3 mt-1 max-h-64 overflow-y-auto border border-border-subtle">
                {run().status!.output}
              </pre>
            </div>
          </Show>

          {/* Error */}
          <Show when={run().status?.error}>
            <div>
              <span class="text-[10px] text-error uppercase tracking-wider font-medium">Error</span>
              <pre class="text-xs text-error/80 font-mono whitespace-pre-wrap bg-error/5 rounded-lg p-3 mt-1 max-h-48 overflow-y-auto border border-error/15">
                {run().status!.error}
              </pre>
            </div>
          </Show>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

// ── Sub-components ──

function SourceIcon(props: { source: RunSource }) {
  return (
    <span class="flex-shrink-0 w-5 h-5 rounded-lg bg-surface-2 flex items-center justify-center">
      <Show when={props.source === 'channel'}>
        <svg class="w-3 h-3 text-warning" fill="currentColor" viewBox="0 0 24 24">
          <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
        </svg>
      </Show>
      <Show when={props.source === 'agent'}>
        <svg class="w-3 h-3 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5" />
        </svg>
      </Show>
      <Show when={props.source === 'schedule'}>
        <svg class="w-3 h-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </Show>
      <Show when={props.source === 'unknown'}>
        <svg class="w-3 h-3 text-text-muted/50" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
        </svg>
      </Show>
    </span>
  );
}

function StatBlock(props: { label: string; value: string }) {
  return (
    <div class="rounded-lg bg-surface-2 border border-border-subtle px-3 py-2">
      <div class="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">{props.label}</div>
      <div class="text-sm font-mono text-text">{props.value}</div>
    </div>
  );
}

function DetailRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div class="flex items-center gap-2 text-xs">
      <span class="text-text-muted w-20 flex-shrink-0">{props.label}</span>
      <span class={`text-text-secondary truncate ${props.mono ? 'font-mono' : ''}`}>{props.value}</span>
    </div>
  );
}
