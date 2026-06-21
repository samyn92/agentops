// AgentInspector — center panel for task agents.
// Focused on metadata, configuration, and run activity.
// Tools and Resources live in the right sidebar — not duplicated here.
import { Show, For, createResource, createMemo, createSignal } from 'solid-js';
import { selectedAgent, agentList } from '../../stores/agents';
import { contextualRuns, contextActiveRunCount, getDelegationMap } from '../../stores/runs';
import { agents as agentsAPI, agentResources as resourcesAPI } from '../../lib/api';
import Badge from '../shared/Badge';
import NeuralTrace from '../shared/NeuralTrace';
import Spinner from '../shared/Spinner';
import Markdown from '../shared/Markdown';
import RunOutcome from '../shared/RunOutcome';
import { phaseVariant, formatDateTime, relativeTime, formatTokens, formatCost } from '../../lib/format';
import type { AgentCRD, AgentResourceBinding, AgentRunResponse, AgentMemoryConfig, AgentResourceRef, AgentResourceRequirements, AgentStorageConfig } from '../../types';

interface AgentInspectorProps {
  class?: string;
}

export default function AgentInspector(props: AgentInspectorProps) {
  const agent = () => selectedAgent();
  const runs = () => contextualRuns();
  const activeCount = () => contextActiveRunCount();

  const agentInfo = createMemo(() => {
    const a = agent();
    if (!a) return null;
    const list = agentList();
    return list?.find((ag) => ag.namespace === a.namespace && ag.name === a.name) ?? null;
  });

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

  const [resources] = createResource(
    () => {
      const a = agent();
      return a ? { ns: a.namespace, name: a.name } : null;
    },
    async (key) => {
      if (!key) return [];
      try {
        return await resourcesAPI.forAgent(key.ns, key.name);
      } catch {
        return [];
      }
    },
  );

  const parentDaemons = createMemo(() => {
    const a = agent();
    if (!a) return [];
    const map = getDelegationMap();
    const parents: string[] = [];
    for (const [daemon, tasks] of Object.entries(map)) {
      if (tasks.includes(a.name)) parents.push(daemon);
    }
    return parents;
  });

  const lastRun = createMemo(() => {
    const a = agent();
    if (!a) return null;
    // Only show runs targeting this agent (agentRef), not runs it delegated (sourceRef)
    const ownRuns = runs().filter((r) => r.spec.agentRef === a.name);
    return ownRuns.length > 0 ? ownRuns[0] : null;
  });

  // Run stats
  const runStats = createMemo(() => {
    const r = runs();
    const succeeded = r.filter((run) => run.status?.phase === 'Succeeded').length;
    const failed = r.filter((run) => run.status?.phase === 'Failed').length;
    const active = r.filter((run) => {
      const phase = run.status?.phase;
      return phase === 'Running' || phase === 'Pending' || phase === 'Queued';
    }).length;
    return { total: r.length, succeeded, failed, active };
  });

  const successRate = createMemo(() => {
    const stats = runStats();
    const completed = stats.succeeded + stats.failed;
    if (completed === 0) return null;
    return Math.round((stats.succeeded / completed) * 100);
  });

  // Aggregate stats from completed runs
  const aggregateStats = createMemo(() => {
    const r = runs();
    let totalTokens = 0;
    let totalCost = 0;
    let totalToolCalls = 0;
    let completedCount = 0;
    for (const run of r) {
      if (run.status?.tokensUsed) totalTokens += run.status.tokensUsed;
      if (run.status?.cost) totalCost += parseFloat(run.status.cost) || 0;
      if (run.status?.toolCalls) totalToolCalls += run.status.toolCalls;
      if (run.status?.phase === 'Succeeded' || run.status?.phase === 'Failed') completedCount++;
    }
    return { totalTokens, totalCost, totalToolCalls, completedCount };
  });

  // Resource counts for summary
  const resourceCounts = createMemo(() => {
    const res = resources() ?? [];
    const git = res.filter((r) => r.kind === 'github-repo' || r.kind === 'gitlab-project' || r.kind === 'git-repo').length;
    const other = res.length - git;
    return { git, other, total: res.length };
  });

  return (
    <div class={`flex flex-col h-full ${props.class || ''}`}>
      <NeuralTrace active={activeCount() > 0} size="sm" />

      <div class="flex-1 overflow-y-auto">
        <Show when={crd.loading}>
          <div class="flex items-center justify-center py-12">
            <Spinner size="md" />
          </div>
        </Show>

        <Show when={crd()}>
          {(data) => {
            const spec = () => data().spec;

            return (
              <div class="px-6 py-5 space-y-6">

                {/* ── Run Activity ── */}
                <div class="space-y-3">
                  <div class="flex items-center gap-2">
                    <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Activity</h3>
                    <Show when={successRate() !== null}>
                      <span class={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                        successRate()! >= 80 ? 'bg-success/10 text-success' :
                        successRate()! >= 50 ? 'bg-warning/10 text-warning' :
                        'bg-error/10 text-error'
                      }`}>
                        {successRate()}% success
                      </span>
                    </Show>
                  </div>

                  <div class="grid grid-cols-4 gap-2">
                    <RunStatCard value={runStats().total} label="Total" />
                    <RunStatCard value={runStats().active} label="Active" variant={runStats().active > 0 ? 'accent' : undefined} pulse={runStats().active > 0} />
                    <RunStatCard value={runStats().succeeded} label="Passed" variant="success" />
                    <RunStatCard value={runStats().failed} label="Failed" variant={runStats().failed > 0 ? 'error' : undefined} />
                  </div>

                  <Show when={aggregateStats().completedCount > 0}>
                    <div class="flex items-center gap-4 px-3 py-2 rounded-lg bg-surface-2/60 border border-border-subtle text-[11px] text-text-muted">
                      <Show when={aggregateStats().totalTokens > 0}>
                        <span class="flex items-center gap-1.5">
                          <svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                          </svg>
                          <span class="font-mono text-text-secondary">{formatTokens(aggregateStats().totalTokens)}</span> tokens
                        </span>
                      </Show>
                      <Show when={aggregateStats().totalToolCalls > 0}>
                        <span class="flex items-center gap-1.5">
                          <svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.42 15.17l-5.29-5.29a4 4 0 115.66-5.66l.1.1a1.65 1.65 0 002.34 0l.1-.1a4 4 0 015.66 5.66l-5.29 5.29a2 2 0 01-2.83 0z" />
                          </svg>
                          <span class="font-mono text-text-secondary">{aggregateStats().totalToolCalls}</span> tool calls
                        </span>
                      </Show>
                      <Show when={aggregateStats().totalCost > 0}>
                        <span class="flex items-center gap-1.5">
                          <svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span class="font-mono text-text-secondary">{formatCost(aggregateStats().totalCost)}</span> spent
                        </span>
                      </Show>
                    </div>
                  </Show>
                </div>

                {/* ── Delegation ── */}
                <Show when={parentDaemons().length > 0}>
                  <div class="space-y-2">
                    <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Invoked by</h3>
                    <div class="flex flex-wrap gap-2">
                      <For each={parentDaemons()}>
                        {(daemon) => (
                          <div class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle group hover:border-border transition-colors">
                            <div class="w-6 h-6 rounded-md bg-info/10 flex items-center justify-center flex-shrink-0">
                              <svg class="w-3.5 h-3.5 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <div class="min-w-0">
                              <span class="text-xs font-medium text-text">{daemon}</span>
                              <span class="text-[10px] text-text-muted ml-1.5">daemon</span>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* ── Last Run ── */}
                <Show when={lastRun()}>
                  {(run) => <LastRunCard run={run()} />}
                </Show>

                {/* ── Configuration ── */}
                <div class="space-y-2">
                  <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Configuration</h3>
                  <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
                    <Show when={spec().image}>
                      <ConfigRow label="Image" value={spec().image!} mono truncate />
                    </Show>
                    <Show when={spec().maxSteps !== undefined}>
                      <ConfigRow label="Max Steps" value={String(spec().maxSteps)} />
                    </Show>
                    <Show when={spec().timeout}>
                      <ConfigRow label="Timeout" value={spec().timeout!} />
                    </Show>
                    <Show when={spec().temperature !== undefined}>
                      <ConfigRow label="Temperature" value={String(spec().temperature)} />
                    </Show>
                    <Show when={spec().maxOutputTokens !== undefined}>
                      <ConfigRow label="Max Output Tokens" value={String(spec().maxOutputTokens)} />
                    </Show>
                  </div>
                </div>

                {/* ── Concurrency ── */}
                <Show when={spec().concurrency}>
                  <div class="space-y-2">
                    <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Concurrency</h3>
                    <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
                      <Show when={spec().concurrency!.maxRuns}>
                        <ConfigRow label="Max Runs" value={String(spec().concurrency!.maxRuns)} />
                      </Show>
                      <Show when={spec().concurrency!.policy}>
                        <ConfigRow label="Policy">
                          <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-accent/8 border border-accent/12 text-accent">
                            {spec().concurrency!.policy}
                          </span>
                        </ConfigRow>
                      </Show>
                    </div>
                  </div>
                </Show>

                {/* ── Memory ── */}
                <Show when={spec().memory}>
                  <MemorySection memory={spec().memory!} />
                </Show>

                {/* ── Environment ── */}
                <Show when={spec().env && Object.keys(spec().env!).length > 0}>
                  <EnvironmentSection env={spec().env!} />
                </Show>

                {/* ── Storage & Resources ── */}
                <Show when={spec().storage || spec().resources}>
                  <InfraSection storage={spec().storage} resources={spec().resources} />
                </Show>

                {/* ── Resource Bindings (quick summary, details in sidebar) ── */}
                <Show when={spec().resourceBindings?.length}>
                  <ResourceBindingsSection bindings={spec().resourceBindings!} />
                </Show>

                {/* ── Schedule ── */}
                <Show when={spec().schedule}>
                  <div class="space-y-2">
                    <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Schedule</h3>
                    <div class="rounded-xl bg-surface-2 border border-border-subtle p-3.5">
                      <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-warning/8 flex items-center justify-center flex-shrink-0">
                          <svg class="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div class="min-w-0">
                          <span class="text-xs font-mono text-text font-medium">{spec().schedule}</span>
                          <Show when={spec().schedulePrompt}>
                            <p class="text-[11px] text-text-muted mt-0.5 line-clamp-2">{spec().schedulePrompt}</p>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </div>
                </Show>

                {/* ── Providers ── */}
                <Show when={spec().providers?.length}>
                  <div class="space-y-2">
                    <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Providers</h3>
                    <div class="flex flex-wrap gap-1.5">
                      <For each={spec().providers}>
                        {(p) => (
                          <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-medium bg-surface-2 border border-border-subtle text-text-secondary">
                            {p.name}
                          </span>
                        )}
                      </For>
                    </div>
                    <Show when={spec().fallbackModels?.length}>
                      <div class="flex items-center gap-2 flex-wrap mt-1">
                        <span class="text-[10px] text-text-muted">Fallback:</span>
                        <For each={spec().fallbackModels}>
                          {(model) => (
                            <span class="text-[10px] font-mono text-text-muted bg-surface-2 px-1.5 py-0.5 rounded border border-border-subtle">
                              {model}
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>

                {/* ── Summary counts for tools & resources (they live in right panel) ── */}
                <Show when={(spec().tools?.length || 0) + (spec().builtinTools?.length || 0) + resourceCounts().total > 0}>
                  <div class="space-y-2">
                    <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Capabilities</h3>
                    <div class="flex flex-wrap gap-2">
                      <Show when={(spec().builtinTools?.length || 0) + (spec().tools?.length || 0) > 0}>
                        <div class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle">
                          <svg class="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.42 15.17l-5.29-5.29a4 4 0 115.66-5.66l.1.1a1.65 1.65 0 002.34 0l.1-.1a4 4 0 015.66 5.66l-5.29 5.29a2 2 0 01-2.83 0z" />
                          </svg>
                          <span class="text-xs text-text-secondary">
                            <span class="font-mono font-medium text-text">{(spec().builtinTools?.length || 0) + (spec().tools?.length || 0)}</span> tools
                          </span>
                        </div>
                      </Show>
                      <Show when={resourceCounts().total > 0}>
                        <div class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle">
                          <svg class="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          <span class="text-xs text-text-secondary">
                            <span class="font-mono font-medium text-text">{resourceCounts().total}</span> resources
                          </span>
                          <Show when={resourceCounts().git > 0}>
                            <span class="text-[10px] text-text-muted">({resourceCounts().git} git)</span>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </div>
                </Show>

                {/* ── System Prompt ── */}
                <Show when={spec().systemPrompt}>
                  <SystemPromptSection prompt={spec().systemPrompt!} />
                </Show>

                {/* ── Footer ── */}
                <div class="pt-4 border-t border-border-subtle flex items-center gap-3 text-[11px] text-text-muted">
                  <span>Created {formatDateTime(data().metadata.creationTimestamp)}</span>
                  <Show when={data().metadata.namespace}>
                    <span class="text-text-muted/40">|</span>
                    <span class="font-mono">{data().metadata.namespace}/{data().metadata.name}</span>
                  </Show>
                </div>
              </div>
            );
          }}
        </Show>
      </div>
    </div>
  );
}

// ── Sub-components ──

function RunStatCard(props: { value: number; label: string; variant?: 'accent' | 'success' | 'error'; pulse?: boolean }) {
  const color = () => {
    switch (props.variant) {
      case 'accent': return 'text-accent';
      case 'success': return 'text-success';
      case 'error': return 'text-error';
      default: return 'text-text';
    }
  };
  const bgTint = () => {
    switch (props.variant) {
      case 'accent': return 'bg-accent/4';
      case 'success': return 'bg-success/4';
      case 'error': return 'bg-error/4';
      default: return '';
    }
  };

  return (
    <div class={`rounded-xl bg-surface-2 border border-border-subtle px-3 py-2.5 text-center relative overflow-hidden ${bgTint()}`}>
      <Show when={props.pulse}>
        <div class="absolute inset-0 bg-accent/3 animate-pulse" />
      </Show>
      <div class={`text-xl font-mono font-semibold tabular-nums relative ${color()}`}>{props.value}</div>
      <div class="text-[10px] text-text-muted uppercase tracking-wider relative">{props.label}</div>
    </div>
  );
}

function LastRunCard(props: { run: AgentRunResponse }) {
  const run = () => props.run;
  const phase = () => run().status?.phase;
  const isActive = () => phase() === 'Running' || phase() === 'Pending' || phase() === 'Queued';

  const borderColor = () => {
    switch (phase()) {
      case 'Succeeded': return 'border-l-success';
      case 'Failed': return 'border-l-error';
      case 'Running': return 'border-l-accent';
      case 'Pending': case 'Queued': return 'border-l-warning';
      default: return 'border-l-border';
    }
  };

  return (
    <div class="space-y-2">
      <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Last Run</h3>
      <div class={`rounded-xl bg-surface-2 border border-border-subtle border-l-2 ${borderColor()} p-3.5 space-y-2.5`}>
        {/* Header row */}
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono text-text truncate flex-1">{run().metadata.name}</span>
          <Badge variant={phaseVariant(phase())} dot>
            {phase() || '?'}
          </Badge>
        </div>

        {/* Prompt preview */}
        <Show when={run().spec.prompt}>
          <p class="text-xs text-text-secondary/70 line-clamp-2 leading-relaxed">{run().spec.prompt}</p>
        </Show>

        {/* Meta row */}
        <div class="flex items-center gap-3 flex-wrap text-[11px] text-text-muted">
          <span>{relativeTime(run().metadata.creationTimestamp)}</span>
          <Show when={run().spec.source}>
            <span class="flex items-center gap-1">
              <span class="text-text-muted/40">via</span>
              <span class="text-text-secondary">{run().spec.source}</span>
              <Show when={run().spec.sourceRef}>
                <span class="text-text-muted/40">/</span>
                <span class="text-text-secondary">{run().spec.sourceRef}</span>
              </Show>
            </span>
          </Show>
          <Show when={run().status?.tokensUsed}>
            <span class="flex items-center gap-1">
              <span class="font-mono text-text-secondary">{formatTokens(run().status!.tokensUsed!)}</span>
              <span>tokens</span>
            </span>
          </Show>
          <Show when={run().status?.cost}>
            <span class="font-mono text-text-secondary">{formatCost(run().status!.cost)}</span>
          </Show>
        </div>

        {/* Run outcome (intent + artifacts: PR/MR/Issue/branch/commit/memory).
            Falls back to spec.outcome.intent when status not yet finalized. */}
        <Show when={run().status?.outcome || run().spec.outcome?.intent}>
          <RunOutcome
            outcome={run().status?.outcome}
            intentHint={run().spec.outcome?.intent}
            variant="full"
            showSummary={false}
          />
        </Show>

        {/* Error preview */}
        <Show when={run().status?.error}>
          <div class="rounded-lg bg-error/5 border border-error/10 px-3 py-2">
            <p class="text-[11px] text-error/80 font-mono line-clamp-2">{run().status!.error}</p>
          </div>
        </Show>
      </div>
    </div>
  );
}

function ConfigRow(props: { label: string; value?: string; mono?: boolean; truncate?: boolean; children?: any }) {
  return (
    <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[36px]">
      <span class="text-xs text-text-muted flex-shrink-0">{props.label}</span>
      <Show when={props.children} fallback={
        <span class={`text-xs text-text text-right ${props.mono ? 'font-mono' : ''} ${props.truncate ? 'truncate max-w-[260px]' : ''}`}>
          {props.value}
        </span>
      }>
        {props.children}
      </Show>
    </div>
  );
}

function SystemPromptSection(props: { prompt: string }) {
  const [expanded, setExpanded] = createSignal(false);
  const isLong = () => props.prompt.length > 400;

  return (
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">System Prompt</h3>
        <Show when={isLong()}>
          <button
            class="text-[10px] text-accent hover:text-accent/80 transition-colors"
            onClick={() => setExpanded(!expanded())}
          >
            {expanded() ? 'Collapse' : 'Expand'}
          </button>
        </Show>
      </div>
      <div
        class={`rounded-xl bg-surface-2 border border-border-subtle p-4 transition-all ${
          !expanded() && isLong() ? 'max-h-[200px] overflow-hidden relative' : ''
        }`}
      >
        <Markdown content={props.prompt} />
        <Show when={!expanded() && isLong()}>
          <div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-2 to-transparent rounded-b-xl" />
        </Show>
      </div>
    </div>
  );
}

function MemorySection(props: { memory: AgentMemoryConfig }) {
  const m = () => props.memory;
  const features = () => {
    const f: Array<{ label: string; enabled: boolean }> = [];
    f.push({ label: 'Auto-summarize', enabled: m().autoSummarize !== false });
    f.push({ label: 'Auto-save', enabled: m().autoSave !== false });
    f.push({ label: 'Auto-search', enabled: m().autoSearch !== false });
    return f;
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Memory</h3>
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-info/8 border border-info/12 text-info">
          <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          enabled
        </span>
      </div>

      <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
        <ConfigRow label="Server" value={m().serverRef} mono />
        <Show when={m().project}>
          <ConfigRow label="Project" value={m().project} mono />
        </Show>
        <Show when={m().contextLimit !== undefined}>
          <ConfigRow label="Context Limit" value={`${m().contextLimit} entries`} />
        </Show>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <For each={features()}>
          {(feat) => (
            <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
              feat.enabled
                ? 'bg-success/6 border-success/10 text-success'
                : 'bg-surface-3 border-border-subtle text-text-muted'
            }`}>
              <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {feat.enabled
                  ? <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                  : <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                }
              </svg>
              {feat.label}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}

function EnvironmentSection(props: { env: Record<string, string> }) {
  const entries = () => Object.entries(props.env);

  return (
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Environment</h3>
        <span class="text-[10px] text-text-muted font-mono">{entries().length} var{entries().length !== 1 ? 's' : ''}</span>
      </div>
      <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
        <For each={entries()}>
          {([key, value]) => (
            <div class="flex items-center justify-between gap-4 px-3.5 py-2 min-h-[32px]">
              <span class="text-[11px] font-mono text-text-muted flex-shrink-0">{key}</span>
              <span class="text-[11px] font-mono text-text text-right truncate max-w-[200px]">{value}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function InfraSection(props: { storage?: AgentStorageConfig; resources?: AgentResourceRequirements }) {
  return (
    <div class="space-y-2">
      <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Infrastructure</h3>
      <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
        <Show when={props.storage}>
          <ConfigRow label="Storage" value={props.storage!.size} mono />
          <Show when={props.storage!.storageClass}>
            <ConfigRow label="Storage Class" value={props.storage!.storageClass} mono />
          </Show>
        </Show>
        <Show when={props.resources?.requests}>
          <ConfigRow label="CPU Request" value={props.resources!.requests!.cpu || '—'} mono />
          <ConfigRow label="Memory Request" value={props.resources!.requests!.memory || '—'} mono />
        </Show>
        <Show when={props.resources?.limits}>
          <ConfigRow label="CPU Limit" value={props.resources!.limits!.cpu || '—'} mono />
          <ConfigRow label="Memory Limit" value={props.resources!.limits!.memory || '—'} mono />
        </Show>
      </div>
    </div>
  );
}

function ResourceBindingsSection(props: { bindings: AgentResourceRef[] }) {
  return (
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Resource Bindings</h3>
        <span class="text-[10px] text-text-muted font-mono">{props.bindings.length}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <For each={props.bindings}>
          {(binding) => (
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-surface-2 border border-border-subtle text-text-secondary">
              <svg class="w-3 h-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              {binding.name}
              <Show when={binding.readOnly}>
                <span class="text-[9px] text-warning/70 ml-0.5">RO</span>
              </Show>
              <Show when={binding.autoContext}>
                <span class="text-[9px] text-info/70 ml-0.5">auto</span>
              </Show>
            </span>
          )}
        </For>
      </div>
    </div>
  );
}
