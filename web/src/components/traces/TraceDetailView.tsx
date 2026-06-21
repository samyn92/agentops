// TraceDetailView — full center-stage trace waterfall.
// Opens when a trace is clicked from the TracesPanel in the left sidebar.
// Span detail is rendered in the RightPanel sidebar via shared view state.
import { createSignal, createResource, Show, For, createMemo, createEffect, on } from 'solid-js';
import { selectedTraceForDetail, clearCenterOverlay, showTraceDetail, selectedSpanID, selectSpan, clearSelectedSpan } from '../../stores/view';
import { traces as tracesAPI } from '../../lib/api';
import type { TraceSpan, TempoTraceResponse, TraceProcess } from '../../types';
import Spinner from '../shared/Spinner';
import Markdown from '../shared/Markdown';
import SpanDetailDrawer from './SpanDetailDrawer';

interface TraceDetailViewProps {
  class?: string;
}

// ── Span tree node ──
interface SpanNode {
  span: TraceSpan;
  children: SpanNode[];
  depth: number;
  /** Virtual tool call rows synthesized from tool.call events on the root span */
  isVirtualToolCall?: boolean;
  /** When >1, this row represents N consecutive identical failed calls collapsed together */
  duplicateGroupCount?: number;
}

/** Filter modes for the waterfall */
type WaterfallFilter = 'all' | 'errors' | 'tools' | 'llm';

/** Parsed tool.call event data from span logs */
type ToolEventData = {
  toolName: string;
  toolType: string;
  durationMs: number;
  isError: boolean;
  toolInput?: string;
  toolOutput?: string;
  toolStep?: unknown;
  toolPreview?: string;
  timestamp: number;
  parentNode: SpanNode;
};

export default function TraceDetailView(props: TraceDetailViewProps) {
  const [trace] = createResource(selectedTraceForDetail, async (traceID) => {
    if (!traceID) return null;
    try {
      return await tracesAPI.get(traceID);
    } catch {
      return null;
    }
  });

  // Build span tree
  const spanTree = createMemo((): SpanNode[] => {
    const data = trace();
    if (!data?.data?.[0]) return [];
    const spans = data.data[0].spans;
    if (!spans || spans.length === 0) return [];

    const spanMap = new Map<string, SpanNode>();
    for (const span of spans) {
      spanMap.set(span.spanID, { span, children: [], depth: 0 });
    }

    const roots: SpanNode[] = [];
    for (const node of spanMap.values()) {
      if (node.span.parentSpanID && spanMap.has(node.span.parentSpanID)) {
        spanMap.get(node.span.parentSpanID)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    function sortChildren(node: SpanNode, depth: number) {
      node.depth = depth;
      node.children.sort((a, b) => a.span.startTime - b.span.startTime);
      for (const child of node.children) sortChildren(child, depth + 1);
    }
    for (const root of roots) sortChildren(root, 0);
    return roots;
  });

  // Flatten tree for rendering, then inject virtual tool call rows
  // from tool.call events on the root span when real tool.execute spans are missing.
  // Also collapses redundant mcp.call children under their parent tool.execute.
  const flatSpans = createMemo((): SpanNode[] => {
    const result: SpanNode[] = [];
    function flatten(node: SpanNode) {
      // Collapse: if this is a tool.execute span with a single mcp.call child,
      // skip the child — the parent already shows all the info we need.
      const collapseMcp = node.span.operationName.startsWith('tool.execute') &&
        node.children.length === 1 &&
        node.children[0].span.operationName.startsWith('mcp.call');

      result.push(node);
      if (!collapseMcp) {
        for (const child of node.children) flatten(child);
      }
    }
    for (const root of spanTree()) flatten(root);

    // Check if we already have real tool.execute or mcp.call spans
    const hasRealToolSpans = result.some(
      (n) => n.span.operationName.startsWith('tool.execute') ||
             n.span.operationName.startsWith('mcp.call'),
    );
    if (hasRealToolSpans) return result;

    // No real tool spans — synthesize virtual rows from tool.call events.
    // Events may live on the root agent.prompt span (hooks path — has tool.duration_ms
    // and real timestamps) or the gen_ai.generate child span (post-hoc path — has
    // tool.input, tool.output, tool.step but no duration and clustered timestamps).
    // Collect from all spans, deduplicate by tool name order, and merge fields.

    // Collect events from all spans, keyed by source
    const hooksEvents: ToolEventData[] = [];  // from agent.prompt (has duration)
    const postHocEvents: ToolEventData[] = []; // from gen_ai.generate/stream (has input/output/step)

    for (const node of result) {
      if (!node.span.logs) continue;
      const isGenAISpan = node.span.operationName.startsWith('gen_ai.');
      for (const log of node.span.logs) {
        const eventField = log.fields?.find((f) => f.key === 'event');
        if (eventField?.value !== 'tool.call') continue;

        const data: ToolEventData = {
          toolName: log.fields?.find((f) => f.key === 'tool.name')?.value as string || 'tool',
          toolType: log.fields?.find((f) => f.key === 'tool.type')?.value as string || 'builtin',
          durationMs: Number(log.fields?.find((f) => f.key === 'tool.duration_ms')?.value ?? 0),
          isError: log.fields?.find((f) => f.key === 'tool.error')?.value === true ||
                   log.fields?.find((f) => f.key === 'tool.error')?.value === 'true',
          toolInput: log.fields?.find((f) => f.key === 'tool.input')?.value as string | undefined,
          toolOutput: log.fields?.find((f) => f.key === 'tool.output')?.value as string | undefined,
          toolStep: log.fields?.find((f) => f.key === 'tool.step')?.value,
          toolPreview: log.fields?.find((f) => f.key === 'tool.preview')?.value as string | undefined,
          timestamp: log.timestamp,
          parentNode: node,
        };

        if (isGenAISpan) {
          postHocEvents.push(data);
        } else {
          hooksEvents.push(data);
        }
      }
    }

    // Merge: prefer hooks events (real timestamps + duration), enrich with post-hoc data.
    // If only one source exists, use it directly.
    let mergedEvents: ToolEventData[];
    if (hooksEvents.length > 0 && postHocEvents.length > 0) {
      // Both paths fired — merge by matching tool call order (same tool at same index).
      mergedEvents = hooksEvents.map((hook, i) => {
        const postHoc = postHocEvents[i];
        if (!postHoc) return hook;
        return {
          ...hook,
          // Keep hooks timestamp and duration (real values)
          // Enrich with post-hoc input/output/step if hooks path lacks them
          toolInput: hook.toolInput ?? postHoc.toolInput,
          toolOutput: hook.toolOutput ?? postHoc.toolOutput,
          toolStep: hook.toolStep ?? postHoc.toolStep,
          toolPreview: hook.toolPreview ?? postHoc.toolPreview,
        };
      });
    } else {
      mergedEvents = hooksEvents.length > 0 ? hooksEvents : postHocEvents;
    }

    if (mergedEvents.length === 0) return result;

    const parentNode = mergedEvents[0]!.parentNode;
    const toolEventNodes: SpanNode[] = mergedEvents.map((data, i) => {
      const durationUs = data.durationMs * 1000; // ms → microseconds
      const tags: Array<{ key: string; type: string; value: unknown }> = [
        { key: 'tool.name', type: 'string', value: data.toolName },
        { key: 'tool.type', type: 'string', value: data.toolType },
        ...(data.isError ? [{ key: 'tool.error', type: 'string', value: 'true' }] : []),
        ...(data.toolInput ? [{ key: 'tool.input', type: 'string', value: data.toolInput }] : []),
        ...(data.toolOutput ? [{ key: 'tool.output', type: 'string', value: data.toolOutput }] : []),
        ...(data.toolStep != null ? [{ key: 'tool.step', type: 'int64', value: data.toolStep }] : []),
        ...(data.toolPreview ? [{ key: 'tool.preview', type: 'string', value: data.toolPreview }] : []),
      ];
      const virtualSpan: TraceSpan = {
        traceID: parentNode.span.traceID,
        spanID: `virtual-tool-${i}`,
        parentSpanID: parentNode.span.spanID,
        operationName: `tool.execute: ${data.toolName}`,
        startTime: durationUs > 0 ? data.timestamp - durationUs : data.timestamp,
        duration: durationUs || 1000, // 1ms placeholder if no duration
        tags,
        status: data.isError ? { code: 2 } : undefined,
      };

      return {
        span: virtualSpan,
        children: [],
        depth: (parentNode?.depth ?? 0) + 1,
        isVirtualToolCall: true,
      };
    });

    // Insert virtual tool rows after the parent span
    const insertAfter = parentNode ?? result[0];
    const enriched: SpanNode[] = [];
    for (const node of result) {
      enriched.push(node);
      if (node === insertAfter) {
        enriched.push(...toolEventNodes);
      }
    }
    return enriched;
  });

  // Time range for waterfall
  const timeRange = createMemo(() => {
    const spans = flatSpans();
    if (spans.length === 0) return { min: 0, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const node of spans) {
      const start = node.span.startTime;
      const end = start + node.span.duration;
      if (start < min) min = start;
      if (end > max) max = end;
    }
    return { min, max: max === min ? max + 1 : max };
  });

  // Filter mode state — controls which spans render in the waterfall
  const [filterMode, setFilterMode] = createSignal<WaterfallFilter>('all');
  const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement | undefined>();

  // Apply filter then collapse adjacent identical failed tool calls
  // (e.g. coder retrying the same `git push` 3 times → "git push ×3 (failed)").
  const visibleSpans = createMemo((): SpanNode[] => {
    const all = flatSpans();
    const mode = filterMode();

    // Step 1: filter
    const filtered = all.filter((node) => {
      if (mode === 'all') return true;
      const op = node.span.operationName;
      const isError = node.span.status?.code === 2 || getTag(node.span, 'tool.error') === 'true';
      if (mode === 'errors') return isError;
      if (mode === 'tools') return op.startsWith('tool.') || op.startsWith('mcp.');
      if (mode === 'llm') return op.startsWith('chat ') || op.startsWith('gen_ai.');
      return true;
    });

    // Step 2: collapse adjacent identical failed tool calls (same operation + same error state)
    const collapsed: SpanNode[] = [];
    for (const node of filtered) {
      const prev = collapsed[collapsed.length - 1];
      const isError = node.span.status?.code === 2 || getTag(node.span, 'tool.error') === 'true';
      const isToolish = node.span.operationName.startsWith('tool.') || node.span.operationName.startsWith('mcp.');
      const sameAsPrev =
        prev &&
        isError &&
        isToolish &&
        prev.span.operationName === node.span.operationName &&
        (prev.span.status?.code === 2 || getTag(prev.span, 'tool.error') === 'true') &&
        getTag(prev.span, 'tool.preview') === getTag(node.span, 'tool.preview');
      if (sameAsPrev) {
        prev.duplicateGroupCount = (prev.duplicateGroupCount ?? 1) + 1;
        // Extend the visual bar to cover both spans' time range
        const newEnd = Math.max(
          prev.span.startTime + prev.span.duration,
          node.span.startTime + node.span.duration,
        );
        prev.span = {
          ...prev.span,
          duration: newEnd - prev.span.startTime,
        };
      } else {
        collapsed.push({ ...node });
      }
    }
    return collapsed;
  });

  // Time ruler tick marks (evenly spaced across the trace duration)
  const timeRulerTicks = createMemo(() => {
    const range = timeRange();
    const totalMs = (range.max - range.min) / 1000;
    if (totalMs <= 0) return [];

    // Pick a nice tick interval
    const targetTicks = 5;
    const rawInterval = totalMs / targetTicks;
    const niceIntervals = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 30000, 60000];
    const interval = niceIntervals.find((n) => n >= rawInterval) ?? rawInterval;

    const ticks: Array<{ pct: number; label: string }> = [];
    for (let ms = 0; ms <= totalMs; ms += interval) {
      const pct = (ms / totalMs) * 100;
      if (pct > 100) break;
      ticks.push({ pct, label: formatDuration(ms) });
    }
    return ticks;
  });

  // Selected span data — reads from shared view store
  const selectedSpanNode = createMemo(() => {
    const id = selectedSpanID();
    if (!id) return null;
    return flatSpans().find((n) => n.span.spanID === id) ?? null;
  });

  // Processes (for resource-level attributes)
  const processes = createMemo(() => {
    return trace()?.data?.[0]?.processes ?? {};
  });

  // Push selected span data to shared store so RightPanel can render it
  createEffect(on([selectedSpanNode, processes], ([node, procs]) => {
    if (node) {
      selectSpan(node.span.spanID, node.span, procs);
    }
  }));

  // Trace-level summary — aggregate tokens across ALL chat/gen_ai spans, extract TTFT
  const rootSummary = createMemo(() => {
    const spans = flatSpans();
    if (spans.length === 0) return null;
    const root = spans[0]?.span;
    if (!root) return null;
    const range = timeRange();

    // Aggregate tokens across all gen_ai (chat) spans
    let totalIn = 0, totalOut = 0, totalReasoning = 0, totalCacheRead = 0, totalCacheWrite = 0;
    for (const node of spans) {
      const s = node.span;
      const inTok = Number(getTag(s, 'gen_ai.usage.input_tokens') ?? 0);
      const outTok = Number(getTag(s, 'gen_ai.usage.output_tokens') ?? 0);
      const reasonTok = Number(getTag(s, 'gen_ai.usage.reasoning_tokens') ?? 0);
      const cacheR = Number(getTag(s, 'gen_ai.usage.cache_read_tokens') ?? 0);
      const cacheW = Number(getTag(s, 'gen_ai.usage.cache_creation_tokens') ?? 0);
      if (inTok || outTok) {
        totalIn += inTok;
        totalOut += outTok;
        totalReasoning += reasonTok;
        totalCacheRead += cacheR;
        totalCacheWrite += cacheW;
      }
    }

    // Find TTFT from gen_ai.first_token event or tag
    let ttft: number | undefined;
    for (const node of spans) {
      const t = getTag(node.span, 'gen_ai.server.time_to_first_token');
      if (t) { ttft = Number(t); break; }
      if (node.span.logs) {
        for (const log of node.span.logs) {
          const ev = log.fields?.find(f => f.key === 'event');
          if (ev?.value === 'gen_ai.first_token') {
            const f = log.fields?.find(f => f.key === 'gen_ai.server.time_to_first_token');
            if (f) { ttft = Number(f.value); break; }
          }
        }
        if (ttft) break;
      }
    }

    return {
      totalDuration: (range.max - range.min) / 1000,
      spanCount: spans.filter((n) => !n.isVirtualToolCall).length,
      model: getTag(root, 'gen_ai.request.model') || getTag(root, 'gen_ai.response.model'),
      provider: getTag(root, 'gen_ai.provider.name'),
      inputTokens: totalIn || undefined,
      outputTokens: totalOut || undefined,
      reasoningTokens: totalReasoning || undefined,
      cacheReadTokens: totalCacheRead || undefined,
      cacheWriteTokens: totalCacheWrite || undefined,
      ttft,
      steps: getTag(root, 'agent.steps'),
      agentName: getTag(root, 'agent.name'),
    };
  });

  // Extract user prompt from the root span's gen_ai.content.prompt or gen_ai.user.message event
  const userPrompt = createMemo(() => {
    const spans = flatSpans();
    if (spans.length === 0) return null;
    const root = spans[0]?.span;
    if (!root?.logs) return null;
    for (const log of root.logs) {
      const eventField = log.fields?.find((f) => f.key === 'event');
      if (eventField?.value === 'gen_ai.content.prompt') {
        const promptField = log.fields?.find((f) => f.key === 'gen_ai.prompt');
        if (promptField) return String(promptField.value);
      }
      if (eventField?.value === 'gen_ai.user.message') {
        const contentField = log.fields?.find((f) => f.key === 'gen_ai.message.content');
        if (contentField) return String(contentField.value);
      }
    }
    return null;
  });

  // Extract assistant response from the root span's gen_ai.content.completion or gen_ai.choice event
  const assistantResponse = createMemo(() => {
    const spans = flatSpans();
    if (spans.length === 0) return null;
    const root = spans[0]?.span;
    if (!root?.logs) return null;
    for (const log of root.logs) {
      const eventField = log.fields?.find((f) => f.key === 'event');
      if (eventField?.value === 'gen_ai.content.completion') {
        const completionField = log.fields?.find((f) => f.key === 'gen_ai.completion');
        if (completionField) return String(completionField.value);
      }
      if (eventField?.value === 'gen_ai.choice') {
        const contentField = log.fields?.find((f) => f.key === 'gen_ai.choice.message.content');
        if (contentField) return String(contentField.value);
      }
    }
    return null;
  });

  // Collect tool calls from the trace for a quick summary.
  // Primary source: real tool.execute spans. Fallback: tool.call events on root span.
  const toolSummary = createMemo(() => {
    const spans = flatSpans();
    const tools: Array<{ name: string; duration: number; isError: boolean }> = [];

    // First, try real tool.execute or mcp.call spans
    for (const node of spans) {
      const op = node.span.operationName;
      if (op.startsWith('tool.execute') && !node.isVirtualToolCall) {
        const name = getTag(node.span, 'tool.name') || op.replace('tool.execute: ', '') || 'tool';
        tools.push({
          name,
          duration: node.span.duration / 1000,
          isError: node.span.status?.code === 2 || getTag(node.span, 'tool.error') === 'true',
        });
      } else if (op.startsWith('mcp.call')) {
        const name = getTag(node.span, 'tool.name') || op.replace('mcp.call: ', '').replace('/', '_') || 'tool';
        tools.push({
          name,
          duration: node.span.duration / 1000,
          isError: node.span.status?.code === 2 || getTag(node.span, 'tool.error') === 'true',
        });
      }
    }
    if (tools.length > 0) return tools;

    // Fallback: virtual tool rows (from tool.call events)
    for (const node of spans) {
      if (node.isVirtualToolCall) {
        const name = getTag(node.span, 'tool.name') || 'tool';
        tools.push({
          name,
          duration: node.span.duration / 1000,
          isError: getTag(node.span, 'tool.error') === 'true',
        });
      }
    }
    return tools;
  });

  return (
    <div class={`flex flex-col ${props.class || ''}`}>
      <Show when={trace.loading}>
        <div class="flex-1 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      </Show>

      <Show when={trace.error}>
        <div class="flex-1 flex items-center justify-center px-4">
          <p class="text-sm text-error">Failed to load trace details</p>
        </div>
      </Show>

      {/* Trace fetched but absent (Tempo 404: spans still flushing, the trace
          expired, or the run errored before emitting any). Render a calm empty
          state rather than a blank stage. */}
      <Show when={!trace.loading && !trace.error && !trace()}>
        <div class="flex-1 flex items-center justify-center px-4 text-center">
          <div>
            <p class="text-sm text-text-secondary">Trace not available</p>
            <p class="text-xs text-text-muted mt-1">
              Tempo has no spans for this trace yet — it may still be flushing, or has expired.
            </p>
          </div>
        </div>
      </Show>

      <Show when={!trace.loading && !trace.error && trace()}>
        <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Summary stats bar — pinned */}
          <Show when={rootSummary()}>
            {(summary) => (
              <div class="flex flex-wrap items-center gap-1.5 px-5 py-2.5 border-b border-border flex-shrink-0">
                <StatPill label="Duration" value={formatDuration(summary().totalDuration)} highlight />
                <StatPill label="Spans" value={String(summary().spanCount)} />
                <Show when={summary().model}>
                  <StatPill label="Model" value={shortModelName(summary().model!)} accent />
                </Show>
                <Show when={summary().provider}>
                  <StatPill label="Provider" value={summary().provider!} />
                </Show>
                <Show when={summary().inputTokens}>
                  <StatPill label="In" value={`${Number(summary().inputTokens).toLocaleString()} tok`} />
                </Show>
                <Show when={summary().outputTokens}>
                  <StatPill label="Out" value={`${Number(summary().outputTokens).toLocaleString()} tok`} />
                </Show>
                <Show when={Number(summary().reasoningTokens) > 0}>
                  <StatPill label="Reasoning" value={`${Number(summary().reasoningTokens).toLocaleString()} tok`} />
                </Show>
                <Show when={Number(summary().cacheReadTokens) > 0}>
                  <StatPill label="Cache Hit" value={`${Number(summary().cacheReadTokens).toLocaleString()} tok`} />
                </Show>
                <Show when={Number(summary().cacheWriteTokens) > 0}>
                  <StatPill label="Cache Write" value={`${Number(summary().cacheWriteTokens).toLocaleString()} tok`} />
                </Show>
                <Show when={summary().ttft}>
                  <StatPill label="TTFT" value={`${summary().ttft}ms`} />
                </Show>
                <Show when={summary().steps}>
                  <StatPill label="Steps" value={String(summary().steps)} />
                </Show>
                <Show when={toolSummary().length > 0}>
                  <StatPill label="Tools" value={String(toolSummary().length)} />
                </Show>
              </div>
            )}
          </Show>

          {/* Scrollable content: prompt+response side-by-side, tools, waterfall */}
          <div ref={setScrollContainer} class="flex-1 overflow-y-auto min-h-0">
            {/* Prompt + Response side-by-side (stacks below ~900px) */}
            <Show when={userPrompt() || assistantResponse()}>
              <div class="flex flex-col min-[900px]:flex-row border-b border-border">
                <Show when={userPrompt()}>
                  <div class="flex-1 min-w-0 px-5 py-3 min-[900px]:border-r border-border min-[900px]:w-1/2">
                    <ExpandableContent label="Prompt" content={userPrompt()!} defaultMaxH="max-h-[20vh]" />
                  </div>
                </Show>
                <Show when={assistantResponse()}>
                  <div class="flex-1 min-w-0 px-5 py-3 border-t min-[900px]:border-t-0 border-border min-[900px]:w-1/2">
                    <ExpandableContent label="Response" content={assistantResponse()!} muted defaultMaxH="max-h-[20vh]" />
                  </div>
                </Show>
              </div>
            </Show>

            {/* Tool calls summary pills */}
            <Show when={toolSummary().length > 0}>
              <div class="px-5 py-2.5 border-b border-border">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mr-0.5 self-center">
                    Tools ({toolSummary().length})
                  </span>
                  <For each={toolSummary()}>
                    {(tool) => (
                      <span
                        class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors ${
                          tool.isError
                            ? 'bg-error/6 border border-error/15 text-error/80'
                            : 'bg-warning/6 border border-warning/15 text-warning/90'
                        }`}
                      >
                        {tool.name.startsWith('mcp_') ? tool.name.slice(4).replace('_', '/') : tool.name}
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Waterfall */}
            <div class="py-1">
              <Show
                when={flatSpans().length > 0}
                fallback={
                  <div class="text-sm text-text-muted text-center py-12">
                    No spans found for this trace.
                  </div>
                }
              >
                {/* Filter toolbar */}
                <div class="flex items-center gap-1.5 px-4 py-2 border-b border-border-subtle">
                  <span class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mr-1">
                    Show
                  </span>
                  <For each={[
                    { id: 'all' as const, label: 'All' },
                    { id: 'errors' as const, label: 'Errors' },
                    { id: 'tools' as const, label: 'Tools' },
                    { id: 'llm' as const, label: 'LLM' },
                  ]}>
                    {(opt) => (
                      <button
                        class={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                          filterMode() === opt.id
                            ? 'bg-accent/15 text-accent border border-accent/30'
                            : 'bg-surface-2/40 text-text-muted border border-transparent hover:bg-surface-hover/50'
                        }`}
                        onClick={() => setFilterMode(opt.id)}
                      >
                        {opt.label}
                      </button>
                    )}
                  </For>
                  <span class="text-[10px] text-text-muted/50 ml-2 tabular-nums">
                    {visibleSpans().length} / {flatSpans().length} spans
                  </span>
                </div>

                {/* Waterfall header with time ruler */}
                <div class="flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-surface/30">
                  <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider" style={{ width: '280px' }}>
                    Operation
                  </div>
                  <div class="flex-1 relative min-w-0" style={{ height: '16px' }}>
                    <For each={timeRulerTicks()}>
                      {(tick) => (
                        <div
                          class="absolute top-0 flex flex-col items-center"
                          style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}
                        >
                          <span class="text-[9px] font-mono text-text-muted/50 tabular-nums whitespace-nowrap">
                            {tick.label}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                  <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider w-16 text-right">
                    Duration
                  </div>
                </div>

                {/* Single indented timeline */}
                <For each={visibleSpans()}>
                  {(node) => {
                    const range = timeRange();
                    const totalDuration = range.max - range.min;
                    const leftPct = () => ((node.span.startTime - range.min) / totalDuration) * 100;
                    const widthPct = () => Math.max(0.3, (node.span.duration / totalDuration) * 100);
                    const durationMs = () => node.span.duration / 1000;
                    const isError = () => node.span.status?.code === 2;
                    const isSelected = () => selectedSpanID() === node.span.spanID;
                    const isVirtual = () => !!node.isVirtualToolCall;
                    const isTiny = () => widthPct() < 5;
                    const barColor = () => {
                      if (isError()) return 'bg-red-500';
                      const op = node.span.operationName;
                      if (op.startsWith('chat ') || op.startsWith('gen_ai.')) return 'bg-purple-500';
                      if (op.startsWith('tool.') || op.startsWith('mcp.')) return 'bg-amber-500';
                      if (op.startsWith('memory.')) return 'bg-emerald-500';
                      if (op === 'agent.step') return 'bg-sky-400';
                      return 'bg-blue-500';
                    };

                    const toolName = () => getTag(node.span, 'tool.name') || getTag(node.span, 'gen_ai.tool.name');
                    const toolPreview = () => getTag(node.span, 'tool.preview');
                    const dupCount = () => node.duplicateGroupCount ?? 1;
                    const model = () => getTag(node.span, 'gen_ai.request.model');

                    // Compute step label from children
                    const stepLabel = createMemo(() => {
                      if (node.span.operationName !== 'agent.step') return undefined;
                      const childOps = node.children.map(c => c.span.operationName);
                      const hasTool = childOps.some(o => o.startsWith('tool.') || o.startsWith('mcp.'));
                      const hasGenAI = childOps.some(o => o.startsWith('chat ') || o.startsWith('gen_ai.'));
                      if (hasGenAI && hasTool) return 'think + tool';
                      if (hasTool) return 'tool';
                      if (hasGenAI) return 'think + respond';
                      return undefined;
                    });

                    const indent = () => node.depth * 14;

                    return (
                      <button
                        class={`w-full flex items-center gap-2 px-4 py-1.5 transition-all duration-100 cursor-pointer border-l-2 rounded-none ${
                          isSelected()
                            ? 'bg-accent/8 border-l-accent'
                            : 'border-l-transparent hover:bg-surface-hover/40'
                        }`}
                        onClick={(e) => {
                          const isCurrentlySelected = selectedSpanID() === node.span.spanID;
                          if (isCurrentlySelected) {
                            clearSelectedSpan();
                          } else {
                            const btn = e.currentTarget as HTMLElement;
                            selectSpan(node.span.spanID, node.span, processes());
                            // After the drawer opens and the scroll area shrinks,
                            // scroll the clicked row into the upper third of the
                            // remaining visible area so it stays in view.
                            const container = scrollContainer();
                            if (container) {
                              requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                  const cRect = container.getBoundingClientRect();
                                  const bRect = btn.getBoundingClientRect();
                                  const targetOffset = cRect.height * 0.33;
                                  const delta = (bRect.top - cRect.top) - targetOffset;
                                  container.scrollBy({ top: delta, behavior: 'smooth' });
                                });
                              });
                            }
                          }
                        }}
                      >
                        {/* Operation name */}
                        <div
                          class="flex-shrink-0 text-[11px] font-mono truncate text-left"
                          style={{ width: '280px', 'padding-left': `${indent()}px` }}
                        >
                          <span class={`${isError() ? 'text-error' : isSelected() ? 'text-text' : 'text-text-secondary'}`}>
                            {spanDisplayName(node.span.operationName, toolName(), model(), stepLabel(), toolPreview(), dupCount())}
                          </span>
                        </div>

                        {/* Waterfall bar with time ruler grid lines */}
                        <div class="flex-1 h-5 relative min-w-0">
                          {/* Grid lines */}
                          <For each={timeRulerTicks()}>
                            {(tick) => (
                              <div
                                class="absolute top-0 bottom-0 border-l border-border-subtle/20"
                                style={{ left: `${tick.pct}%` }}
                              />
                            )}
                          </For>
                          {/* The bar */}
                          <div
                            class={`absolute top-1 h-3 rounded-[3px] transition-all duration-100 ${barColor()} ${
                              isVirtual()
                                ? 'opacity-40'
                                : isSelected()
                                  ? 'opacity-100 shadow-sm'
                                  : 'opacity-75 hover:opacity-95'
                            }`}
                            style={{
                              left: `${leftPct()}%`,
                              width: `${widthPct()}%`,
                              'min-width': '3px',
                              ...(isVirtual() ? { 'background-image': 'repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 6px)' } : {}),
                            }}
                          />
                          {/* Duration label next to tiny bars */}
                          <Show when={isTiny()}>
                            <span
                              class="absolute top-[3px] text-[9px] font-mono text-text-muted/60 tabular-nums whitespace-nowrap"
                              style={{ left: `${Math.min(leftPct() + widthPct() + 0.5, 95)}%` }}
                            >
                              {formatDuration(durationMs())}
                            </span>
                          </Show>
                        </div>

                        {/* Duration */}
                        <span class={`flex-shrink-0 text-[10px] font-mono w-16 text-right tabular-nums ${
                          isSelected() ? 'text-text-secondary' : 'text-text-muted'
                        }`}>
                          {formatDuration(durationMs())}
                        </span>
                      </button>
                    );
                  }}
                </For>

                {/* Legend */}
                <div class="flex flex-wrap gap-4 px-4 py-3 mt-1 border-t border-border-subtle">
                  <LegendDot color="bg-blue-500" label="agent" />
                  <LegendDot color="bg-purple-500" label="gen_ai" />
                  <LegendDot color="bg-amber-500" label="tool / mcp" />
                  <LegendDot color="bg-emerald-500" label="memory" />
                  <LegendDot color="bg-sky-400" label="step" />
                  <LegendDot color="bg-red-500" label="error" />
                </div>
              </Show>
            </div>

            {/* Response is now rendered above, side-by-side with the prompt */}
          </div>

          {/* Bottom drawer — takes real layout space so waterfall above shrinks */}
          <SpanDetailDrawer />
        </div>
      </Show>
    </div>
  );
}

// ── Subcomponents ──

// ── Expandable Content Block ──
function ExpandableContent(props: {
  label: string;
  content: string;
  defaultMaxH?: string;
  muted?: boolean;
  error?: boolean;
  mono?: boolean;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const maxH = () => props.defaultMaxH || 'max-h-24';

  return (
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{props.label}</div>
        <button
          class="text-[10px] font-medium text-accent/70 hover:text-accent transition-colors px-1 py-0.5 rounded hover:bg-accent/5"
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? 'collapse' : 'expand'}
        </button>
      </div>
      <div
        class={`text-[12px] leading-relaxed rounded-lg px-3.5 py-3 border overflow-y-auto transition-all duration-200 ${
          props.error
            ? 'bg-error/4 border-error/12 text-error/80'
            : props.muted
              ? 'bg-surface-2/80 border-border-subtle text-text-secondary'
              : 'bg-surface-2/80 border-border-subtle text-text'
        } ${expanded() ? 'max-h-[70vh]' : maxH()}`}
      >
        <Markdown content={props.content} class="text-[12px]" />
      </div>
    </div>
  );
}

function StatPill(props: { label: string; value: string; accent?: boolean; highlight?: boolean }) {
  return (
    <div class={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
      props.highlight
        ? 'bg-accent/5 border-accent/15'
        : 'bg-surface-2/60 border-border-subtle'
    }`}>
      <span class="text-[10px] text-text-muted">{props.label}</span>
      <span class={`text-[11px] font-mono font-medium tabular-nums ${
        props.accent ? 'text-accent' : props.highlight ? 'text-text' : 'text-text-secondary'
      }`}>
        {props.value}
      </span>
    </div>
  );
}

function LegendDot(props: { color: string; label: string }) {
  return (
    <div class="flex items-center gap-1.5">
      <div class={`w-2.5 h-1.5 rounded-[2px] ${props.color} opacity-80`} />
      <span class="text-[10px] text-text-muted">{props.label}</span>
    </div>
  );
}

// ── Helpers ──

function getTag(span: TraceSpan, key: string): string | undefined {
  const tag = span.tags?.find((t) => t.key === key);
  if (!tag) return undefined;
  return String(tag.value);
}

/** Shorten a model name for display (e.g. "anthropic/claude-sonnet-4-20250514" -> "claude-sonnet-4") */
function shortModelName(model: string): string {
  const name = model.split('/').pop() ?? model;
  return name.replace(/-20\d{6}$/, '');
}

/** Build a human-readable span name with context */
function spanDisplayName(
  operation: string,
  toolName?: string,
  model?: string,
  stepLabel?: string,
  toolPreview?: string,
  dupCount?: number,
): string {
  const dupSuffix = dupCount && dupCount > 1 ? ` ×${dupCount} (failed)` : '';

  if (operation === 'agent.prompt' || operation === 'agent.prompt.internal') return 'prompt';
  if (operation === 'agent.step') return stepLabel ? `step: ${stepLabel}` : 'step';
  // New semconv naming: "chat {model}"
  if (operation.startsWith('chat ')) {
    return operation; // already "chat moonshot-v1-auto" etc.
  }
  if (operation.startsWith('gen_ai.')) {
    const shortOp = operation.slice(7);
    if (model) return `${shortOp} ${shortModelName(model)}`;
    return shortOp;
  }
  // Helper to format a tool name + optional preview tail
  const toolLabel = (rawName: string): string => {
    const cleanName = rawName.startsWith('mcp_')
      ? (() => {
          const parts = rawName.slice(4).split('_');
          return parts.length > 1 ? `${parts[0]}/${parts.slice(1).join('_')}` : rawName.slice(4);
        })()
      : rawName;
    if (toolPreview) {
      // Trim preview to fit 200px column nicely
      const trimmed = toolPreview.length > 50 ? toolPreview.slice(0, 50) + '…' : toolPreview;
      return `${cleanName}: ${trimmed}${dupSuffix}`;
    }
    return `${cleanName}${dupSuffix}`;
  };
  if (operation.startsWith('tool.execute: ')) {
    const name = operation.slice('tool.execute: '.length);
    return toolLabel(name);
  }
  if (operation === 'tool.execute') {
    return toolLabel(toolName || 'tool');
  }
  if (operation.startsWith('mcp.call: ')) return `mcp:${operation.slice('mcp.call: '.length)}${dupSuffix}`;
  if (operation === 'mcp.call') {
    if (toolName) return `mcp:${toolName}${dupSuffix}`;
    return `mcp${dupSuffix}`;
  }
  if (operation.startsWith('memory.')) return operation.slice(7).replace('_', ' ');
  return operation;
}

function formatDuration(ms: number): string {
  if (ms < 0.01) return '<0.01ms';
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
