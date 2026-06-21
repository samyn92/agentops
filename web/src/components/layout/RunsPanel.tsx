// RunsPanel — right sidebar showing context-aware AgentRun activity feed.
// Shows runs for the selected agent (or all runs if none selected).
// Supports collapsed strip with activity badge, and expanded detail view.
import { For, Show, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import {
  filteredRuns,
  contextualRuns,
  runFilter,
  setRunFilter,
  selectedRunKey,
  selectRun,
  clearRunSelection,
  activeRunCount,
  concurrencyInfo,
  getRunSource,
  refreshRuns,
  startRunPolling,
  stopRunPolling,
  type RunFilter as RunFilterType,
  type RunSource,
} from '../../stores/runs';
import { selectedAgent } from '../../stores/agents';
import { rightPanelState, toggleRightPanel } from '../../stores/view';
import { getResourceForge } from '../../stores/resources';
import Spinner from '../shared/Spinner';
import RunPhaseIcon from '../shared/RunPhaseIcon';
import RunOutcome from '../shared/RunOutcome';
import { relativeTime, formatTokens, formatCost, formatDateTime } from '../../lib/format';
import type { AgentRunResponse } from '../../types';
import { Tabs } from '@ark-ui/solid/tabs';
import { ForgeWatermark, SourceIcon, HamburgerIcon, RefreshIcon, PlayIcon } from '../shared/Icons';
import DetailRow from '../shared/DetailRow';
import Tip from '../shared/Tip';

interface RunsPanelProps {
  class?: string;
}

export default function RunsPanel(props: RunsPanelProps) {
  const [panelWidth, setPanelWidth] = createSignal(320);
  const [isResizing, setIsResizing] = createSignal(false);

  onMount(() => {
    startRunPolling();
    refreshRuns();
  });

  onCleanup(() => {
    stopRunPolling();
  });

  const isExpanded = () => rightPanelState() === 'expanded';
  const globalActive = () => activeRunCount();
  const agent = () => selectedAgent();

  // Selected run data
  const selectedRun = createMemo<AgentRunResponse | null>(() => {
    const key = selectedRunKey();
    if (!key) return null;
    const runs = filteredRuns();
    return runs.find((r) => `${r.metadata.namespace}/${r.metadata.name}` === key) ?? null;
  });

  // Resize handler (drag left edge)
  function onResizeStart(e: MouseEvent) {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = panelWidth();

    function onMouseMove(e: MouseEvent) {
      const delta = startX - e.clientX;
      const newWidth = Math.max(280, Math.min(480, startWidth + delta));
      setPanelWidth(newWidth);
    }

    function onMouseUp() {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  return (
    <aside
      class={`relative flex flex-col h-full bg-surface border-l border-border overflow-hidden transition-[width,min-width] duration-200 ${props.class || ''}`}
      style={{
        width: isExpanded() ? `${panelWidth()}px` : '44px',
        'min-width': isExpanded() ? `${panelWidth()}px` : '44px',
      }}
    >
      {/* ── Collapsed strip ── */}
      <Show when={!isExpanded()}>
        <Tip content="Show runs panel (Ctrl+3)" placement="right">
          <button
            class="flex flex-col items-center gap-3 py-3 w-full h-full hover:bg-surface-hover transition-colors"
            onClick={() => toggleRightPanel()}
          >
            {/* Hamburger menu icon */}
            <div class="relative">
              <HamburgerIcon class="w-5 h-5 text-text-secondary" />
              <Show when={globalActive() > 0}>
                <span class="absolute -top-1.5 -right-1.5 w-4 h-4 bg-accent text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                  {globalActive()}
                </span>
              </Show>
            </div>
          </button>
        </Tip>
      </Show>

      {/* ── Expanded panel ── */}
      <Show when={isExpanded()}>
        {/* Resize handle (left edge) */}
        <div
          class={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/30 z-10 ${isResizing() ? 'bg-accent/30' : ''}`}
          onMouseDown={onResizeStart}
        />

        {/* Header */}
        <div class="flex items-center gap-2 px-3 h-12 border-b border-border">
          <Tip content="Collapse runs panel">
            <button
              class="p-1 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text transition-colors"
              onClick={() => toggleRightPanel()}
            >
              <HamburgerIcon class="w-5 h-5" />
            </button>
          </Tip>

          <div class="flex-1" />

          <Tip content="Refresh">
            <button
              class="p-1 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
              onClick={() => refreshRuns()}
            >
              <RefreshIcon class="w-3.5 h-3.5" />
            </button>
          </Tip>
        </div>

        {/* Concurrency gauge (when agent selected and has runs) */}
        <Show when={agent() && concurrencyInfo()}>
          {(info) => (
            <div class="px-3 py-2 border-b border-border-subtle bg-surface-2/50">
              <div class="flex items-center gap-2 text-xs">
                <span class="text-text-muted">Slots:</span>
                <div class="flex gap-0.5 flex-1">
                  <For each={Array.from({ length: Math.max(info().running + info().queued, info().running + 1) })}>
                    {(_, i) => (
                      <div
                        class={`h-1.5 flex-1 rounded-full ${
                          i() < info().running
                            ? 'bg-success'
                            : i() < info().running + info().queued
                              ? 'bg-warning'
                              : 'bg-border'
                        }`}
                      />
                    )}
                  </For>
                </div>
                <span class="text-text-secondary font-mono">
                  {info().running}r
                  <Show when={info().queued > 0}>
                    <span class="text-warning"> +{info().queued}q</span>
                  </Show>
                </span>
              </div>
            </div>
          )}
        </Show>

        {/* Filter tabs */}
        <Tabs.Root
          value={runFilter()}
          onValueChange={(details) => setRunFilter(details.value as RunFilterType)}
        >
          <Tabs.List class="flex gap-0.5 px-2 py-1.5 border-b border-border-subtle">
            <Tabs.Trigger value="all" class="px-2.5 py-1 text-[11px] rounded-lg transition-colors data-[selected]:bg-surface-hover data-[selected]:text-text data-[selected]:font-medium text-text-muted hover:text-text-secondary hover:bg-surface-hover/50">
              All <span class="ml-1 opacity-60">{contextualRuns().length || ''}</span>
            </Tabs.Trigger>
            <Tabs.Trigger value="active" class="px-2.5 py-1 text-[11px] rounded-lg transition-colors data-[selected]:bg-surface-hover data-[selected]:text-text data-[selected]:font-medium text-text-muted hover:text-text-secondary hover:bg-surface-hover/50">
              Active <span class="ml-1 opacity-60">{contextualRuns().filter(r => r.status?.phase === 'Running' || r.status?.phase === 'Pending' || r.status?.phase === 'Queued').length || ''}</span>
            </Tabs.Trigger>
            <Tabs.Trigger value="completed" class="px-2.5 py-1 text-[11px] rounded-lg transition-colors data-[selected]:bg-surface-hover data-[selected]:text-text data-[selected]:font-medium text-text-muted hover:text-text-secondary hover:bg-surface-hover/50">
              Done <span class="ml-1 opacity-60">{contextualRuns().filter(r => r.status?.phase === 'Succeeded').length || ''}</span>
            </Tabs.Trigger>
            <Tabs.Trigger value="failed" class="px-2.5 py-1 text-[11px] rounded-lg transition-colors data-[selected]:bg-surface-hover data-[selected]:text-text data-[selected]:font-medium text-text-muted hover:text-text-secondary hover:bg-surface-hover/50">
              Failed <span class="ml-1 opacity-60">{contextualRuns().filter(r => r.status?.phase === 'Failed').length || ''}</span>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>

        {/* Run list */}
        <div class="flex-1 overflow-y-auto">
          <Show
            when={filteredRuns().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-8 px-4 text-center">
                <PlayIcon class="w-8 h-8 text-text-muted mb-2" />
                <p class="text-xs text-text-muted">
                  <Show when={agent()} fallback="No runs yet across any agent.">
                    No {runFilter() !== 'all' ? runFilter() : ''} runs for {agent()!.name}.
                  </Show>
                </p>
              </div>
            }
          >
            <div class="flex flex-col">
              <For each={filteredRuns()}>
                {(run) => {
                  const key = () => `${run.metadata.namespace}/${run.metadata.name}`;
                  const isSelected = () => selectedRunKey() === key();
                  const source = () => getRunSource(run);
                  const forge = () => getResourceForge(run.spec.git?.resourceRef);
                  const hasOutcome = () => !!run.status?.outcome || !!run.spec.outcome?.intent;

                  return (
                    <button
                      class={`w-full text-left px-3 py-2.5 transition-colors border-b border-border-subtle relative overflow-hidden ${
                        isSelected()
                          ? 'bg-accent-muted border-l-2 border-l-accent'
                          : 'hover:bg-surface-hover border-l-2 border-l-transparent'
                      }`}
                      onClick={() => {
                        if (isSelected()) {
                          clearRunSelection();
                        } else {
                          selectRun(run.metadata.namespace, run.metadata.name);
                        }
                      }}
                    >
                      {/* Forge watermark */}
                      <Show when={forge()}>
                        <ForgeWatermark forge={forge()!} />
                      </Show>

                      {/* Row 1: Source icon + run name + phase icon */}
                      <div class="flex items-center gap-1.5">
                        <SourceIcon source={source()} />
                        <span class="run-card__title truncate flex-1">{run.metadata.name}</span>
                        <RunPhaseIcon phase={run.status?.phase} />
                      </div>

                      {/* Row 2: time */}
                      <div class="run-card__meta">
                        <span class="run-card__time ml-auto">{relativeTime(run.metadata.creationTimestamp)}</span>
                      </div>

                      {/* Row 3: Outcome chips */}
                      <Show when={hasOutcome()}>
                        <div class="mt-1.5" onClick={(e) => e.stopPropagation()}>
                          <RunOutcome
                            outcome={run.status?.outcome}
                            intentHint={run.spec.outcome?.intent}
                            variant="compact"
                            showSummary={false}
                          />
                        </div>
                      </Show>

                      {/* Row 4: Prompt preview */}
                      <Show when={run.spec.prompt}>
                        <p class="run-card__prompt">{run.spec.prompt}</p>
                      </Show>

                      {/* Inline detail when selected */}
                      <Show when={isSelected()}>
                        <div class="mt-2 pt-2 border-t border-border-subtle space-y-1.5">
                          <Show when={run.status?.tokensUsed}>
                            <DetailRow label="Tokens" value={formatTokens(run.status!.tokensUsed!)} />
                          </Show>
                          <Show when={run.status?.toolCalls}>
                            <DetailRow label="Tools" value={String(run.status!.toolCalls)} />
                          </Show>
                          <Show when={run.status?.cost}>
                            <DetailRow label="Cost" value={formatCost(run.status!.cost!)} />
                          </Show>
                          <Show when={run.spec.source}>
                            <DetailRow label="Source" value={`${run.spec.source}${run.spec.sourceRef ? ' / ' + run.spec.sourceRef : ''}`} />
                          </Show>
                          <Show when={run.status?.startTime}>
                            <DetailRow label="Started" value={formatDateTime(run.status!.startTime!)} />
                          </Show>
                          <Show when={run.status?.completionTime}>
                            <DetailRow label="Completed" value={formatDateTime(run.status!.completionTime!)} />
                          </Show>
                          <Show when={run.status?.output}>
                            <div class="mt-1">
                              <span class="text-[10px] text-text-muted">Output</span>
                              <pre class="text-[11px] text-text-secondary font-mono whitespace-pre-wrap bg-surface-2 rounded-lg p-1.5 mt-0.5 max-h-32 overflow-y-auto border border-border-subtle">
                                {run.status!.output}
                              </pre>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </aside>
  );
}

