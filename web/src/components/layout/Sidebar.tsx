// Sidebar — agents navigation (left panel)
// Two-group layout reflecting the factory/delegation model:
// 1. Orchestrators — daemon agents (+ scheduled daemons). They delegate to workers.
//    Workers are NOT shown here — they live inside the Orchestrator Detail View.
// 2. Channels — task agents triggered by channels (webhook/gitlab/slack).
//    Scheduled task agents fold into Channels (cron is just another trigger).
//
// Schedule badges appear on cards regardless of group.
import { For, Show, createSignal, createMemo, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import { agentList, selectedAgent, selectAgent, getDelegationTargetsFor, agentHealth } from '../../stores/agents';
import { leftPanelState, toggleLeftPanel, leftPanelTab, setLeftPanelTab, showRunDetail, clearCenterOverlay } from '../../stores/view';
import type { LeftPanelTab } from '../../stores/view';
import { contextualRuns, selectedRunKey, selectRun, clearRunSelection, getRunSource, getRunsDelegatedBy, delegationGroups, getRunDelegationGroup, getAgentConcurrency, getAgentRuns, type RunSource } from '../../stores/runs';
import { getChannelsForAgent, channelBoundAgents } from '../../stores/channels';
import { getResourceForge } from '../../stores/resources';
import { streamingAgentKeys } from '../../stores/chat';
import { relativeTime } from '../../lib/format';
import Spinner from '../shared/Spinner';
import Tip from '../shared/Tip';
import AgentCard from './AgentCard';
import RunPhaseIcon from '../shared/RunPhaseIcon';
import type { AgentResponse, AgentRunResponse } from '../../types';
import { Tabs } from '@ark-ui/solid/tabs';
import { ForgeWatermark, SourceIcon, ChannelTypeIcon, HamburgerIcon, SettingsGearIcon, DelegationIcon } from '../shared/Icons';
import RunOutcome, { IntentChip } from '../shared/RunOutcome';

interface SidebarProps {
  class?: string;
}

export default function Sidebar(props: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = createSignal(308);
  const [isResizing, setIsResizing] = createSignal(false);

  // Split view: percentage of height for the agents section (top).
  // 60% agents, 40% runs by default.
  const [splitPct, setSplitPct] = createSignal(60);
  const [isSplitDragging, setIsSplitDragging] = createSignal(false);
  let splitContainerRef: HTMLDivElement | undefined;

  const isExpanded = () => leftPanelState() === 'expanded';

  // ── Build agent groups (factory model) ──
  // Two groups only:
  // 1. Orchestrators = all daemon agents (they delegate to workers).
  //    Scheduled daemons still appear here with a schedule badge.
  // 2. Channels = task agents with channel bindings OR scheduled task agents.
  //    (Cron is just another trigger — same as webhook/slack/gitlab.)
  // Workers (plain task agents) are NOT shown in the sidebar.
  // They're accessible inside the Orchestrator Detail View's delegation tab.
  const agentTree = createMemo(() => {
    const agents = agentList() ?? [];
    const chBound = channelBoundAgents();
    const byName = (a: AgentResponse, b: AgentResponse) => a.name.localeCompare(b.name);

    // Orchestrators: daemon agents WITH a delegation spec (not all daemons)
    const orchestrators = agents.filter((a) => a.mode === 'daemon' && a.delegation).sort(byName);

    // Standalone daemons: daemon agents WITHOUT delegation (shown separately)
    const standaloneDaemons = agents.filter((a) => a.mode === 'daemon' && !a.delegation).sort(byName);

    // Channels: task agents with channel bindings OR a schedule (cron = trigger)
    const channels = agents.filter(
      (a) => a.mode === 'task' && (chBound.has(a.name) || a.schedule),
    ).sort(byName);

    return { orchestrators, standaloneDaemons, channels };
  });

  // ── Sidebar width resize handler ──
  function onResizeStart(e: MouseEvent) {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = sidebarWidth();

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      const newWidth = Math.max(220, Math.min(400, startWidth + delta));
      setSidebarWidth(newWidth);
    }

    function onMouseUp() {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // ── Split divider drag handler (vertical, between agents and runs) ──
  function onSplitDragStart(e: MouseEvent) {
    e.preventDefault();
    setIsSplitDragging(true);
    const container = splitContainerRef;
    if (!container) return;

    function onMouseMove(e: MouseEvent) {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const pct = Math.max(25, Math.min(75, (y / rect.height) * 100));
      setSplitPct(pct);
    }

    function onMouseUp() {
      setIsSplitDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // Agent-scoped runs for the bottom split section, grouped by delegation.
  // For orchestrators: show delegated runs (runs they created for workers).
  // For task agents: show contextual runs (runs targeting or sourced from them).
  const isSelectedOrchestrator = createMemo(() => {
    const agent = selectedAgent();
    if (!agent) return false;
    const agentInfo = (agentList() ?? []).find(
      (a) => a.namespace === agent.namespace && a.name === agent.name,
    );
    return agentInfo?.mode === 'daemon' && !!agentInfo?.delegation;
  });

  const agentRuns = createMemo(() => {
    const agent = selectedAgent();
    if (!agent) return [];

    const runs = isSelectedOrchestrator()
      ? getRunsDelegatedBy(agent.name)
      : contextualRuns();

    return [...runs].sort((a, b) => {
      const ta = new Date(a.metadata.creationTimestamp).getTime();
      const tb = new Date(b.metadata.creationTimestamp).getTime();
      return tb - ta;
    });
  });

  // Group runs: delegation groups first (collapsed), then ungrouped runs
  const DELEGATION_GROUP_LABEL = 'agents.agentops.io/delegation-group';
  const groupedRuns = createMemo(() => {
    const runs = agentRuns();
    const groups = new Map<string, AgentRunResponse[]>();
    const ungrouped: AgentRunResponse[] = [];

    for (const run of runs) {
      const groupId = run.metadata.labels?.[DELEGATION_GROUP_LABEL];
      if (groupId) {
        if (!groups.has(groupId)) groups.set(groupId, []);
        groups.get(groupId)!.push(run);
      } else {
        ungrouped.push(run);
      }
    }

    // Convert to array of { type, groupId?, runs }
    type RunGroup = { type: 'delegation'; groupId: string; runs: AgentRunResponse[] }
      | { type: 'single'; run: AgentRunResponse };
    const result: RunGroup[] = [];

    // Interleave groups and singles by timestamp (newest first)
    const groupEntries = Array.from(groups.entries()).map(([id, grp]) => ({
      type: 'delegation' as const,
      groupId: id,
      runs: grp,
      ts: Math.max(...grp.map(r => new Date(r.metadata.creationTimestamp).getTime())),
    }));
    const singleEntries = ungrouped.map(r => ({
      type: 'single' as const,
      run: r,
      ts: new Date(r.metadata.creationTimestamp).getTime(),
    }));

    const all = [...groupEntries, ...singleEntries].sort((a, b) => b.ts - a.ts);
    for (const entry of all) {
      if (entry.type === 'delegation') {
        result.push({ type: 'delegation', groupId: entry.groupId, runs: entry.runs });
      } else {
        result.push({ type: 'single', run: entry.run });
      }
    }
    return result;
  });

  const agentRunsActive = createMemo(() =>
    agentRuns().filter(r => r.status?.phase === 'Running' || r.status?.phase === 'Pending' || r.status?.phase === 'Queued')
  );

  // Track which delegation groups are expanded in the run list
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <aside
      class={`relative flex flex-col h-full bg-surface border-r border-border overflow-hidden transition-[width,min-width] duration-200 ${props.class || ''}`}
      style={{
        width: isExpanded() ? `${sidebarWidth()}px` : '44px',
        'min-width': isExpanded() ? `${sidebarWidth()}px` : '44px',
      }}
    >
      {/* ── Collapsed strip ── */}
      <Show when={!isExpanded()}>
        <Tip content="Show sidebar (Ctrl+1)">
          <button
            class="flex flex-col items-center gap-3 py-3 w-full h-full hover:bg-surface-hover transition-colors"
            onClick={() => toggleLeftPanel()}
          >
            <HamburgerIcon class="w-5 h-5 text-text-secondary" />
          </button>
        </Tip>
      </Show>

      {/* ── Expanded panel ── */}
      <Show when={isExpanded()}>
        {/* Header: Agents label + collapse toggle */}
        <div class="flex items-center gap-2 px-3 h-10 border-b border-border flex-shrink-0">
          <span class="text-[11px] font-semibold tracking-wide uppercase text-text-muted ml-1">Agents</span>
          <Tip content="Collapse sidebar">
            <button
              class="ml-auto p-1 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors flex-shrink-0"
              onClick={() => toggleLeftPanel()}
            >
              <HamburgerIcon class="w-4 h-4" />
            </button>
          </Tip>
        </div>

        {/* ── Content area: agents list + runs ── */}
        <div class="flex-1 flex flex-col overflow-hidden min-h-0">
          <div ref={splitContainerRef} class="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* ── Top section: Agents list ── */}
            <div class="flex flex-col overflow-hidden min-h-0" style={{ height: `${splitPct()}%` }}>
              <Show
                when={!agentList.loading}
                fallback={
                  <div class="flex items-center justify-center py-4">
                    <Spinner size="sm" />
                  </div>
                }
              >
                <div class="flex-1 overflow-y-auto min-h-0 pb-1">

                  {/* ── 1. Orchestrators (daemon agents) + nested workers ── */}
                  <Show when={agentTree().orchestrators.length > 0}>
                    <div class="section-header section-header--first">
                      <span class="section-label">Orchestrators</span>
                    </div>
                    <div class="flex flex-col gap-0.5 px-2">
                      <For each={agentTree().orchestrators}>
                        {(agent) => {
                          const isSelected = () => {
                            const sel = selectedAgent();
                            return sel?.namespace === agent.namespace && sel?.name === agent.name;
                          };

                          // Delegation targets for this orchestrator (only shown when selected)
                          const targets = createMemo(() =>
                            isSelected() ? getDelegationTargetsFor(agent.name, agent.namespace) : []
                          );

                          return (
                            <>
                              <AgentCard
                                agent={agent}
                                selected={isSelected()}
                                onSelect={() => { clearRunSelection(); selectAgent(agent.namespace, agent.name); }}
                              />
                              {/* Nested worker fleet (only when this orchestrator is selected) */}
                              <Show when={isSelected() && targets().length > 0}>
                                <div class="ml-4 pl-2 border-l border-border-subtle space-y-px mb-1">
                                  <For each={targets()}>
                                    {(target) => <WorkerRow agent={target} />}
                                  </For>
                                </div>
                              </Show>
                            </>
                          );
                        }}
                      </For>
                    </div>
                  </Show>

                  {/* ── 2. Standalone daemons (daemon agents without delegation) ── */}
                  <Show when={agentTree().standaloneDaemons.length > 0}>
                    <div class="section-header">
                      <span class="section-label">Daemons</span>
                    </div>
                    <div class="flex flex-col gap-0.5 px-2">
                      <For each={agentTree().standaloneDaemons}>
                        {(agent) => {
                          const isSelected = () => {
                            const sel = selectedAgent();
                            return sel?.namespace === agent.namespace && sel?.name === agent.name;
                          };
                          return (
                            <AgentCard
                              agent={agent}
                              selected={isSelected()}
                              onSelect={() => { clearRunSelection(); selectAgent(agent.namespace, agent.name); }}
                            />
                          );
                        }}
                      </For>
                    </div>
                  </Show>

                  {/* ── 3. Channels (task agents with channel bindings or schedule triggers) ── */}
                  <Show when={agentTree().channels.length > 0}>
                    <div class="section-header">
                      <span class="section-label">Channels</span>
                    </div>
                    <div class="flex flex-col gap-1 px-2">
                      <For each={agentTree().channels}>
                        {(agent) => {
                          const isSelected = () => {
                            const sel = selectedAgent();
                            return sel?.namespace === agent.namespace && sel?.name === agent.name;
                          };
                          const channels = () => getChannelsForAgent(agent.name);

                          return (
                            <div>
                              <AgentCard
                                agent={agent}
                                selected={isSelected()}
                                onSelect={() => { clearRunSelection(); selectAgent(agent.namespace, agent.name); }}
                              />
                              {/* Channel binding pills below the card */}
                              <Show when={channels().length > 0}>
                                <div class="flex flex-wrap gap-1 px-3 pb-1 -mt-0.5">
                                  <For each={channels()}>
                                    {(ch) => (
                                      <span class="sidebar-channel-pill">
                                        <ChannelTypeIcon type={ch.spec.type} />
                                        <span class="truncate">{ch.metadata.name}</span>
                                      </span>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>

                  {/* Fallback when no agents exist at all */}
                  <Show when={(agentList()?.length ?? 0) === 0}>
                    <div class="flex flex-col items-center justify-center py-8 px-4 text-center">
                      <p class="text-xs text-text-muted">No agents found.</p>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>

            {/* ── Draggable split divider ── */}
            <div
              class={`flex-shrink-0 h-[3px] cursor-row-resize group relative ${
                isSplitDragging() ? 'bg-accent/40' : 'hover:bg-accent/30'
              }`}
              onMouseDown={onSplitDragStart}
            >
              <div class="absolute inset-x-0 -top-1 -bottom-1" />
              <div class="absolute inset-x-0 top-0 h-px bg-border" />
            </div>

            {/* ── Bottom section: Agent runs ── */}
            <div class="flex flex-col overflow-hidden min-h-0" style={{ height: `${100 - splitPct()}%` }}>
              {/* Section header */}
              <div class="flex items-center gap-1.5 px-3 py-1.5 border-b border-border flex-shrink-0 bg-surface-2/30">
                <span class="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                  {isSelectedOrchestrator() ? 'Delegations' : 'Runs'}
                </span>
                <Show when={selectedAgent()}>
                  <span class="text-[10px] text-text-muted/60 font-mono truncate">
                    {selectedAgent()!.name}
                  </span>
                </Show>
                <Show when={agentRunsActive().length > 0}>
                  <span class="ml-auto px-1 py-px text-[9px] font-bold bg-accent text-primary-foreground rounded-full animate-pulse">
                    {agentRunsActive().length}
                  </span>
                </Show>
              </div>

              {/* Runs list */}
              <div class="flex-1 overflow-y-auto min-h-0">
                <Show
                  when={selectedAgent()}
                  fallback={
                    <div class="flex flex-col items-center justify-center py-6 px-4 text-center">
                      <p class="text-[11px] text-text-muted">Select an agent to see runs.</p>
                    </div>
                  }
                >
                  <Show
                    when={agentRuns().length > 0}
                    fallback={
                      <div class="flex flex-col items-center justify-center py-6 px-4 text-center">
                        <p class="text-[11px] text-text-muted">
                          {isSelectedOrchestrator() ? 'No delegations yet.' : 'No runs for this agent.'}
                        </p>
                      </div>
                    }
                  >
                    <div class="run-card-list p-2">
                      <For each={groupedRuns()}>
                        {(entry) => (
                          <>
                            {/* ── Delegation group (collapsible) ── */}
                            <Show when={entry.type === 'delegation' && 'runs' in entry}>
                              {(_) => {
                                const grp = entry as { type: 'delegation'; groupId: string; runs: AgentRunResponse[] };
                                const isExpanded = () => expandedGroups().has(grp.groupId);
                                const activeInGroup = () => grp.runs.filter(r =>
                                  r.status?.phase === 'Running' || r.status?.phase === 'Pending' || r.status?.phase === 'Queued'
                                ).length;
                                const succeededInGroup = () => grp.runs.filter(r => r.status?.phase === 'Succeeded').length;
                                const failedInGroup = () => grp.runs.filter(r => r.status?.phase === 'Failed').length;

                                return (
                                  <div class="mb-1">
                                    {/* Group header */}
                                    <button
                                      class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors text-left"
                                      onClick={() => toggleGroup(grp.groupId)}
                                    >
                                      <DelegationIcon class="w-3 h-3 text-info flex-shrink-0" />
                                      <span class="text-[10px] font-medium text-text-secondary truncate flex-1">
                                        Fan-out
                                      </span>
                                      <span class="text-[9px] font-mono text-text-muted">{grp.runs.length}</span>
                                      {/* Mini status summary */}
                                      <Show when={succeededInGroup() > 0}>
                                        <span class="text-[9px] font-mono text-success">{succeededInGroup()}</span>
                                      </Show>
                                      <Show when={failedInGroup() > 0}>
                                        <span class="text-[9px] font-mono text-error">{failedInGroup()}</span>
                                      </Show>
                                      <Show when={activeInGroup() > 0}>
                                        <span class="text-[9px] font-mono text-accent animate-pulse">{activeInGroup()}</span>
                                      </Show>
                                      <svg
                                        class={`w-3 h-3 text-text-muted transition-transform ${isExpanded() ? 'rotate-90' : ''}`}
                                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                      >
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>

                                    {/* Expanded group runs */}
                                    <Show when={isExpanded()}>
                                      <div class="ml-3 pl-2 border-l border-info/20 space-y-0.5 mt-0.5">
                                        <For each={grp.runs}>
                                          {(run) => <RunCardButton run={run} />}
                                        </For>
                                      </div>
                                    </Show>
                                  </div>
                                );
                              }}
                            </Show>

                            {/* ── Single run ── */}
                            <Show when={entry.type === 'single' && 'run' in entry}>
                              {(_) => {
                                const single = entry as { type: 'single'; run: AgentRunResponse };
                                return <RunCardButton run={single.run} />;
                              }}
                            </Show>
                          </>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </div>
        {/* Resize handle */}
        <div
          class={`sidebar-resize-handle absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/30 ${isResizing() ? 'active bg-accent/30' : ''}`}
          onMouseDown={onResizeStart}
        />
      </Show>
    </aside>
  );
}

// ── Worker row (nested under selected orchestrator) ──
// Compact inline row showing delegation target status + run-history signal.
// Includes a tiny phase sparkline (last 8 runs) and success rate so users
// get at-a-glance health without opening the worker's detail view.
function WorkerRow(props: { agent: AgentResponse }) {
  const a = () => props.agent;
  const concurrency = () => getAgentConcurrency(a().name);
  const isActive = () => concurrency().running > 0 || concurrency().queued > 0;

  const health = () => {
    const key = `${a().namespace}/${a().name}`;
    return agentHealth()[key];
  };
  const isOnline = () => health()?.reachable ?? false;

  const recentRuns = createMemo(() => getAgentRuns(a().name, 10));
  const sparkline = createMemo(() =>
    recentRuns().slice(0, 8).reverse().map(r => r.status?.phase ?? 'Unknown'),
  );

  const successRate = createMemo(() => {
    const runs = recentRuns();
    const ok = runs.filter(r => r.status?.phase === 'Succeeded').length;
    const fail = runs.filter(r => r.status?.phase === 'Failed').length;
    const total = ok + fail;
    if (total === 0) return null;
    return Math.round((ok / total) * 100);
  });

  const latestRun = () => recentRuns()[0] ?? null;

  const statusDotClass = () => {
    if (isActive()) return 'bg-accent animate-pulse';
    if (isOnline()) return 'bg-success';
    return 'bg-text-muted/40';
  };

  const statusLabel = () => {
    if (isActive()) return `${concurrency().running}r${concurrency().queued > 0 ? `+${concurrency().queued}q` : ''}`;
    if (isOnline()) return 'idle';
    return 'off';
  };

  const statusLabelClass = () => {
    if (isActive()) return 'text-accent font-bold';
    if (isOnline()) return 'text-success';
    return 'text-text-muted';
  };

  const successColor = () => {
    const r = successRate();
    if (r === null) return 'text-text-muted';
    if (r >= 80) return 'text-success';
    if (r >= 50) return 'text-warning';
    return 'text-error';
  };

  return (
    <div
      class="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-surface-hover/50 transition-colors cursor-pointer"
      onClick={() => { clearRunSelection(); selectAgent(a().namespace, a().name); }}
    >
      <span class="text-text-muted flex-shrink-0">↳</span>
      <div class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass()}`} />
      <span class="text-[11px] text-text-secondary font-medium truncate">{a().name}</span>
      <span class={`text-[9px] font-mono flex-shrink-0 ${statusLabelClass()}`}>{statusLabel()}</span>

      {/* Sparkline + success rate + last-run, right-aligned */}
      <span class="flex-1" />
      <Show when={sparkline().length > 0}>
        <div class="flex items-center gap-[1px] flex-shrink-0" title={`${recentRuns().length} recent runs`}>
          <For each={sparkline()}>
            {(phase) => (
              <div class={`w-[3px] h-3 rounded-sm ${
                phase === 'Succeeded' ? 'bg-success/70'
                : phase === 'Failed' ? 'bg-error/70'
                : phase === 'Running' ? 'bg-accent/70'
                : 'bg-text-muted/20'
              }`} />
            )}
          </For>
        </div>
      </Show>
      <Show when={successRate() !== null}>
        <span class={`text-[9px] font-mono font-medium flex-shrink-0 tabular-nums ${successColor()}`}>
          {successRate()}%
        </span>
      </Show>
      <Show when={latestRun()}>
        <span class="text-[9px] text-text-muted flex-shrink-0 tabular-nums">
          {relativeTime(latestRun()!.metadata.creationTimestamp)}
        </span>
      </Show>
    </div>
  );
}

// ── Run card button (extracted for reuse in both single and grouped runs) ──
function RunCardButton(props: { run: AgentRunResponse }) {
  const run = () => props.run;
  const key = () => `${run().metadata.namespace}/${run().metadata.name}`;
  const isSelected = () => selectedRunKey() === key();
  const source = () => getRunSource(run());
  const isRunning = () => run().status?.phase === 'Running';
  const isFailed = () => run().status?.phase === 'Failed';
  const forge = () => getResourceForge(run().spec.git?.resourceRef);
  const intent = () => run().status?.outcome?.intent ?? run().spec.outcome?.intent;
  const intentIsHint = () => !run().status?.outcome?.intent && !!run().spec.outcome?.intent;
  const hasArtifacts = () => !!run().status?.outcome?.artifacts?.length;

  const cardClass = () => {
    const classes = ['run-card'];
    if (isSelected()) classes.push('run-card--selected');
    if (isRunning()) classes.push('run-card--running');
    if (isFailed()) classes.push('run-card--failed');
    return classes.join(' ');
  };

  return (
    <button
      class={`w-full text-left ${cardClass()}`}
      onClick={() => {
        if (isSelected()) {
          clearRunSelection();
          clearCenterOverlay();
        } else {
          selectRun(run().metadata.namespace, run().metadata.name);
          showRunDetail();
        }
      }}
    >
      {/* Forge watermark */}
      <Show when={forge()}>
        <ForgeWatermark forge={forge()!} />
      </Show>

      {/* Row 1: Source icon + run name + tiny intent chip + phase icon */}
      <div class="flex items-center gap-1.5">
        <SourceIcon source={source()} />
        <span class="run-card__title truncate flex-1">{run().metadata.name}</span>
        <Show when={intent()}>
          <IntentChip intent={intent()!} muted={intentIsHint()} size="sm" />
        </Show>
        <RunPhaseIcon phase={run().status?.phase} />
      </div>

      {/* Row 2: Outcome artifact chips (intent rendered inline above) */}
      <Show when={hasArtifacts()}>
        <div class="mt-2" onClick={(e) => e.stopPropagation()}>
          <RunOutcome
            outcome={run().status?.outcome}
            intentHint={run().spec.outcome?.intent}
            variant="compact"
            showSummary={false}
            showIntent={false}
          />
        </div>
      </Show>

      {/* Row 3: Prompt preview */}
      <Show when={run().spec.prompt}>
        <p class="run-card__prompt">{run().spec.prompt}</p>
      </Show>

      {/* Row 4: timestamp */}
      <div class="run-card__meta">
        <span class="run-card__time ml-auto">{relativeTime(run().metadata.creationTimestamp)}</span>
      </div>
    </button>
  );
}
