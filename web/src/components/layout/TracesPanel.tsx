// TracesPanel — global trace browsing via Tempo with delegation tree.
// Shows recent traces across all agents, grouped into a delegation tree:
// parent traces are top-level, child (delegated) traces are nested underneath.
// Clicking a trace opens the full TraceDetailView in the center stage.
import { createSignal, createResource, createMemo, createEffect, Show, For, onMount, onCleanup } from 'solid-js';
import { traces as tracesAPI } from '../../lib/api';
import { showTraceDetail, selectedTraceForDetail } from '../../stores/view';
import { onResourceChanged } from '../../stores/events';
import type { TraceSearchResult } from '../../types';
import Spinner from '../shared/Spinner';
import { MonitorIcon, RefreshIcon, TreeConnectorIcon, ArrowUpIcon } from '../shared/Icons';
import Tip from '../shared/Tip';
import { relativeTime } from '../../lib/format';

// ── Tree node type ──

interface TraceTreeNode {
  trace: TraceSearchResult;
  children: TraceTreeNode[];
}

export default function TracesPanel() {
  const [refetchTrigger, setRefetchTrigger] = createSignal(0);
  let scrollRef!: HTMLDivElement;

  // Stable trace accumulator — merges new results into existing map.
  // Traces are never removed, only added or updated. This prevents the list
  // from shuffling when Tempo's search returns a different subset on each call
  // (due to parallel block scanning and ingester flush timing).
  const traceMap = new Map<string, TraceSearchResult>();
  const [stableTraces, setStableTraces] = createSignal<TraceSearchResult[]>([]);

  // Fetch recent traces globally (no agent filter)
  let savedScrollTop = 0;
  const [traceResults] = createResource(
    () => refetchTrigger(),
    async () => {
      if (scrollRef) savedScrollTop = scrollRef.scrollTop;
      try {
        return await tracesAPI.search({ limit: 200 });
      } catch {
        return { traces: [] };
      }
    },
  );

  // Merge fetched traces into stable map whenever results change
  createEffect(() => {
    const result = traceResults();
    if (!result?.traces) return;

    let changed = false;
    for (const t of result.traces) {
      const existing = traceMap.get(t.traceID);
      if (!existing) {
        traceMap.set(t.traceID, t);
        changed = true;
      } else {
        // Update enrichment fields (delegation info may arrive later)
        if (t.parentTraceID && !existing.parentTraceID) {
          traceMap.set(t.traceID, { ...existing, ...t });
          changed = true;
        }
      }
    }

    if (changed) {
      setStableTraces(Array.from(traceMap.values()));
    }
  });

  // Restore scroll position after render
  createEffect(() => {
    stableTraces();
    if (scrollRef && savedScrollTop > 0) {
      queueMicrotask(() => {
        scrollRef.scrollTop = savedScrollTop;
      });
    }
  });

  // Auto-refetch when K8s resources change (new AgentRuns = new traces)
  const unsubscribe = onResourceChanged(() => {
    setRefetchTrigger((n) => n + 1);
  });

  // Poll every 30s as a fallback (traces from Tempo may lag behind K8s events)
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    pollInterval = setInterval(() => {
      setRefetchTrigger((n) => n + 1);
    }, 30_000);
  });

  onCleanup(() => {
    unsubscribe();
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });

  // Build delegation tree from stable trace list.
  // Traces with parentTraceID are nested under their parent.
  // Orphaned children (parent not in results) stay at root level.
  const traceTree = createMemo((): TraceTreeNode[] => {
    const traces = stableTraces();
    if (traces.length === 0) return [];

    // Index all traces by their traceID
    const byID = new Map<string, TraceTreeNode>();
    for (const t of traces) {
      byID.set(t.traceID, { trace: t, children: [] });
    }

    const roots: TraceTreeNode[] = [];

    for (const t of traces) {
      const node = byID.get(t.traceID)!;
      if (t.parentTraceID && byID.has(t.parentTraceID)) {
        byID.get(t.parentTraceID)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Sort roots newest-first with traceID tiebreaker for fully deterministic order.
    // Uses string comparison on nanosecond timestamps — parseInt loses precision
    // on 19-digit values (JS Number has ~15-16 significant digits), which caused
    // unstable/random ordering on refresh.
    roots.sort((a, b) => {
      const aT = a.trace.startTimeUnixNano || '0';
      const bT = b.trace.startTimeUnixNano || '0';
      // Compare by length first (longer = larger number), then lexicographic.
      if (aT.length !== bT.length) return bT.length - aT.length;
      if (bT !== aT) return bT < aT ? -1 : 1;
      // Tiebreaker: traceID for deterministic order when timestamps are equal
      return a.trace.traceID < b.trace.traceID ? -1 : a.trace.traceID > b.trace.traceID ? 1 : 0;
    });

    // Sort children within each parent by start time (oldest first = execution order)
    for (const node of byID.values()) {
      if (node.children.length > 1) {
        node.children.sort((a, b) => {
          const aT = a.trace.startTimeUnixNano || '0';
          const bT = b.trace.startTimeUnixNano || '0';
          if (aT.length !== bT.length) return aT.length - bT.length;
          if (aT !== bT) return aT < bT ? -1 : 1;
          return a.trace.traceID < b.trace.traceID ? -1 : a.trace.traceID > b.trace.traceID ? 1 : 0;
        });
      }
    }

    return roots;
  });

  return (
    <div class="flex flex-col h-full">
      {/* Header */}
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
        <MonitorIcon class="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <span class="text-[11px] font-semibold tracking-wide uppercase text-text-muted flex-1">Traces</span>
        <Tip content="Refresh traces">
          <button
            class="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
            onClick={() => {
              setRefetchTrigger((n) => n + 1);
            }}
          >
            <RefreshIcon class="w-3.5 h-3.5" />
          </button>
        </Tip>
      </div>

      {/* Content */}
      <div class="flex-1 overflow-y-auto min-h-0" ref={scrollRef}>
        <Show when={traceResults.loading && stableTraces().length === 0}>
          <div class="flex items-center justify-center py-12">
            <Spinner size="sm" />
          </div>
        </Show>

        <Show when={!traceResults.loading || stableTraces().length > 0}>
          <Show
            when={traceTree().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-16 px-6 text-center">
                <MonitorIcon class="w-7 h-7 text-text-muted/20 mb-3" />
                <p class="text-[11px] text-text-muted leading-relaxed">
                  No traces yet. Traces appear after agents process their first prompts.
                </p>
              </div>
            }
          >
            <div class="flex flex-col px-2 py-1.5 gap-0.5">
              <For each={traceTree()}>
                {(node) => <TraceTreeItem node={node} depth={0} />}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ── Tree item (recursive) ──

function TraceTreeItem(props: { node: TraceTreeNode; depth: number }) {
  return (
    <>
      <TraceListItem
        trace={props.node.trace}
        depth={props.depth}
        hasChildren={props.node.children.length > 0}
        onClick={() => showTraceDetail(props.node.trace.traceID)}
      />
      <For each={props.node.children}>
        {(child) => <TraceTreeItem node={child} depth={props.depth + 1} />}
      </For>
    </>
  );
}

// ── Trace list item ──

function TraceListItem(props: {
  trace: TraceSearchResult;
  depth: number;
  hasChildren: boolean;
  onClick: () => void;
}) {
  const startTime = () => {
    if (!props.trace.startTimeUnixNano) return '';
    const ms = parseInt(props.trace.startTimeUnixNano) / 1_000_000;
    return new Date(ms).toISOString();
  };

  const duration = () => {
    if (props.trace.durationMs) return formatDuration(props.trace.durationMs);
    return '';
  };

  // Extract attributes from spanSets or spanSet
  const getAttr = (key: string): string | undefined => {
    for (const ss of props.trace.spanSets ?? []) {
      for (const span of ss.spans ?? []) {
        for (const attr of span.attributes ?? []) {
          if (attr.key === key && attr.value?.stringValue) {
            return attr.value.stringValue;
          }
        }
      }
    }
    const ss = props.trace.spanSet;
    if (ss?.spans) {
      for (const span of ss.spans) {
        for (const attr of span.attributes ?? []) {
          if (attr.key === key && attr.value?.stringValue) {
            return attr.value.stringValue;
          }
        }
      }
    }
    return undefined;
  };

  const agentName = () =>
    props.trace.childAgent || getAttr('agent.name') || props.trace.rootServiceName || 'unknown';
  const agentMode = () => getAttr('agent.mode');
  const isTask = () => agentMode() === 'task';
  const isDelegated = () => !!props.trace.parentTraceID;
  const isChild = () => props.depth > 0;
  const isActive = () => selectedTraceForDetail() === props.trace.traceID;

  const indent = () => props.depth * 16;

  return (
    <button
      class={`trace-item group w-full text-left rounded-md ${
        isActive()
          ? 'trace-item--active'
          : 'hover:bg-surface-hover/50'
      }`}
      style={{ "padding-left": `${12 + indent()}px` }}
      classList={{
        'py-2 pr-3': true,
      }}
      onClick={props.onClick}
    >
      {/* Line 1: agent name row */}
      <div class="flex items-center gap-2 min-w-0">
        {/* Tree connector for child nodes */}
        <Show when={isChild()}>
          <TreeConnectorIcon class="w-3 h-3 text-text-muted/25 flex-shrink-0 -ml-0.5" />
        </Show>

        {/* Status dot */}
        <div class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isTask() ? 'bg-warning' : 'bg-accent'}`} />

        {/* Agent name */}
        <span class={`text-[13px] leading-tight font-medium truncate ${
          isActive() ? 'text-text' : isChild() ? 'text-text-secondary' : 'text-text'
        }`}>
          {agentName()}
        </span>

        {/* Badge */}
        <Show when={isTask()}>
          <span class="trace-badge trace-badge--task">task</span>
        </Show>

        {/* Spacer */}
        <span class="flex-1 min-w-2" />

        {/* Duration */}
        <Show when={duration()}>
          <span class={`text-[11px] font-mono tabular-nums flex-shrink-0 ${
            isActive() ? 'text-text-secondary' : 'text-text-muted'
          }`}>
            {duration()}
          </span>
        </Show>
      </div>

      {/* Line 2: metadata */}
      <div
        class="flex items-center gap-1.5 mt-1"
        style={{ "margin-left": isChild() ? '20px' : '14px' }}
      >
        <span class="text-[11px] font-mono text-text-muted/50">{props.trace.traceID.slice(0, 8)}</span>

        <Show when={isDelegated() && !isChild()}>
          <span class="trace-badge trace-badge--delegated">delegated</span>
        </Show>

        <Show when={props.trace.runSource === 'console' || props.trace.runSource === 'channel' || props.trace.runSource === 'schedule'}>
          <span class="text-[11px] text-text-muted/30">&middot;</span>
          <span class="text-[11px] text-text-muted/50">{props.trace.runSource}</span>
        </Show>

        <span class="flex-1" />

        <Show when={startTime()}>
          <span class="text-[11px] text-text-muted/50 tabular-nums">{relativeTime(startTime())}</span>
        </Show>
      </div>

      {/* Parent agent attribution for orphaned delegated traces */}
      <Show when={isDelegated() && props.trace.parentAgent && !isChild()}>
        <div class="flex items-center gap-1.5 mt-0.5" style={{ "margin-left": '14px' }}>
          <ArrowUpIcon class="w-2.5 h-2.5 text-text-muted/30" />
          <span class="text-[11px] text-text-muted/40 font-mono">{props.trace.parentAgent}</span>
        </div>
      </Show>
    </button>
  );
}

// ── Helpers ──

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
