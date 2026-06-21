// SpanDetailPanel — shows detailed info for a selected trace span.
// Extracted from TraceDetailView for use in the RightPanel sidebar.
// When a span is selected in the waterfall, this panel replaces the
// Memory/Tools/Resources tabs in the right sidebar.
import { createSignal, createMemo, Show, For } from 'solid-js';
import { showTraceDetail } from '../../stores/view';
import { CloseIcon } from '../shared/Icons';
import Tip from '../shared/Tip';
import type { TraceSpan, TraceProcess } from '../../types';

interface SpanDetailPanelProps {
  span: TraceSpan;
  processes: Record<string, TraceProcess>;
  onClose: () => void;
}

export default function SpanDetailPanel(props: SpanDetailPanelProps) {
  const isError = () => props.span.status?.code === 2;
  const isVirtual = () => props.span.spanID.startsWith('virtual-tool-');

  // Get tool.input and tool.output from tags (virtual rows carry these)
  const toolInput = createMemo(() => {
    const v = props.span.tags?.find(t => t.key === 'tool.input')?.value;
    return v ? String(v) : null;
  });
  const toolOutput = createMemo(() => {
    const v = props.span.tags?.find(t => t.key === 'tool.output')?.value;
    return v ? String(v) : null;
  });
  const toolName = createMemo(() => {
    const v = props.span.tags?.find(t => t.key === 'tool.name')?.value;
    return v ? String(v) : null;
  });

  // Parse tool input JSON into something readable
  const parsedInput = createMemo(() => {
    const raw = toolInput();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  });

  // Extract the most relevant field from parsed input for the hero display
  const heroContent = createMemo(() => {
    const p = parsedInput();
    const name = toolName();
    if (!p) return null;
    if (name === 'bash' || name === 'Bash') {
      return { label: 'Command', value: String(p.command ?? p.cmd ?? ''), lang: 'bash' };
    }
    if (name === 'ls' || name === 'list_directory') {
      return { label: 'Path', value: String(p.path ?? p.directory ?? '.'), lang: 'path' };
    }
    if (name === 'read' || name === 'Read' || name === 'read_file') {
      const path = String(p.filePath ?? p.path ?? p.file ?? '');
      const offset = p.offset ? ` (offset: ${p.offset})` : '';
      const limit = p.limit ? ` (limit: ${p.limit})` : '';
      return { label: 'File', value: path + offset + limit, lang: 'path' };
    }
    if (name === 'write' || name === 'Write' || name === 'write_file') {
      return { label: 'File', value: String(p.filePath ?? p.path ?? p.file ?? ''), lang: 'path' };
    }
    if (name === 'glob' || name === 'Glob') {
      return { label: 'Pattern', value: String(p.pattern ?? ''), lang: 'glob' };
    }
    if (name === 'grep' || name === 'Grep' || name === 'search') {
      return { label: 'Pattern', value: String(p.pattern ?? p.query ?? ''), lang: 'regex' };
    }
    if (name === 'git_status') {
      return { label: 'Operation', value: 'git status', lang: 'bash' };
    }
    if (name === 'run_agent') {
      const agent = String(p.agent ?? '');
      const prompt = String(p.prompt ?? '');
      return { label: 'Delegate to', value: `${agent}: ${prompt}`, lang: 'text' };
    }
    // Fallback: show the first string field
    for (const [key, val] of Object.entries(p)) {
      if (typeof val === 'string' && val.length > 0) {
        return { label: key, value: val, lang: 'text' };
      }
    }
    return null;
  });

  // Categorize tags into semantic groups for display
  const tagGroups = createMemo(() => {
    const tags = (props.span.tags ?? []).filter(t =>
      // Hide tool.input/output from tag list — shown in dedicated sections
      t.key !== 'tool.input' && t.key !== 'tool.output'
    );
    const groups: Record<string, Array<{ key: string; value: unknown; type: string }>> = {
      'GenAI': [],
      'Agent': [],
      'Delegation': [],
      'Tool': [],
      'Memory': [],
      'Other': [],
    };

    for (const tag of tags) {
      if (tag.key.startsWith('gen_ai.')) {
        groups['GenAI'].push(tag);
      } else if (tag.key.startsWith('delegation.')) {
        groups['Delegation'].push(tag);
      } else if (tag.key.startsWith('agent.') || tag.key.startsWith('step.')) {
        groups['Agent'].push(tag);
      } else if (tag.key.startsWith('tool.') || tag.key.startsWith('mcp.')) {
        groups['Tool'].push(tag);
      } else if (tag.key.startsWith('memory.')) {
        groups['Memory'].push(tag);
      } else {
        groups['Other'].push(tag);
      }
    }

    // Remove empty groups
    return Object.entries(groups).filter(([, tags]) => tags.length > 0);
  });

  // Process tags (resource attributes from the process)
  const processTags = createMemo(() => {
    const pid = props.span.processID;
    if (!pid || !props.processes[pid]) return [];
    return props.processes[pid].tags ?? [];
  });

  // Quick info extracted from tags for the header area
  const quickInfo = createMemo(() => {
    const tags = props.span.tags ?? [];
    const get = (key: string) => tags.find(t => t.key === key)?.value;
    return {
      model: get('gen_ai.request.model') || get('gen_ai.response.model'),
      provider: get('gen_ai.provider.name'),
      inputTokens: get('gen_ai.usage.input_tokens') as number | undefined,
      outputTokens: get('gen_ai.usage.output_tokens') as number | undefined,
      reasoningTokens: get('gen_ai.usage.reasoning_tokens') as number | undefined,
      cacheWriteTokens: get('gen_ai.usage.cache_creation_tokens') as number | undefined,
      cacheReadTokens: get('gen_ai.usage.cache_read_tokens') as number | undefined,
      ttft: get('gen_ai.server.time_to_first_token') as number | undefined,
      serverAddress: get('server.address') as string | undefined,
      serverPort: get('server.port') as string | undefined,
      finishReasons: get('gen_ai.response.finish_reasons') as string | undefined,
      toolName: get('tool.name'),
      agentName: get('agent.name'),
      stepNumber: get('step.number') as number | undefined,
    };
  });

  // Parse finish_reasons into a readable summary
  const finishReasonsSummary = createMemo(() => {
    const raw = quickInfo().finishReasons;
    if (!raw) return null;
    const reasons = (raw as string).split(',').map(r => r.trim()).filter(Boolean);
    if (reasons.length === 0) return null;
    const counts = new Map<string, number>();
    for (const r of reasons) {
      counts.set(r, (counts.get(r) || 0) + 1);
    }
    const parts: string[] = [];
    for (const [reason, count] of counts) {
      parts.push(count > 1 ? `${count}x ${reason}` : reason);
    }
    return parts.join(', ');
  });

  return (
    <div class="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
        <div class="flex-1 min-w-0">
          <div class={`text-xs font-mono font-medium truncate ${isError() ? 'text-error' : 'text-text'}`}>
            {props.span.operationName}
          </div>
          <div class="text-[10px] text-text-muted font-mono mt-0.5">
            {isVirtual() ? 'reconstructed from events' : props.span.spanID.slice(0, 16)}
          </div>
        </div>
        <Tip content="Close span detail">
          <button
            class="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors flex-shrink-0"
            onClick={props.onClose}
          >
            <CloseIcon class="w-3.5 h-3.5" />
          </button>
        </Tip>
      </div>

      {/* Scrollable content */}
      <div class="flex-1 overflow-y-auto">
        {/* Duration + Status row */}
        <div class="flex gap-2 px-4 py-2.5 border-b border-border-subtle">
          <MiniStat label="Duration" value={formatDuration(props.span.duration / 1000)} />
          <Show when={isError()}>
            <MiniStat label="Status" value="ERROR" error />
          </Show>
          <Show when={!isError() && props.span.status?.code === 1}>
            <MiniStat label="Status" value="OK" success />
          </Show>
        </div>

        {/* ── Tool Deep Inspection ── */}
        {/* Hero: the most important field (command, path, pattern) in big mono text */}
        <Show when={heroContent()}>
          {(hero) => (
            <div class="px-4 py-3 border-b border-border-subtle">
              <div class="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">{hero().label}</div>
              <div class={`text-[13px] font-mono leading-relaxed rounded-lg px-3 py-2.5 border break-all whitespace-pre-wrap ${
                hero().lang === 'bash'
                  ? 'bg-[#1a1b26] text-emerald-400 border-emerald-500/20'
                  : hero().lang === 'path'
                    ? 'bg-surface-2 text-accent border-accent/15'
                    : 'bg-surface-2 text-text border-border-subtle'
              }`}>
                <Show when={hero().lang === 'bash'}>
                  <span class="text-text-muted/50 select-none mr-1.5">$</span>
                </Show>
                {hero().value}
              </div>
            </div>
          )}
        </Show>

        {/* Full tool input JSON (collapsed by default if hero already shows it) */}
        <Show when={toolInput()}>
          <div class="px-4 py-3 border-b border-border-subtle">
            <ExpandableContent
              label="Input (full args)"
              content={formatJSON(toolInput()!)}
              defaultMaxH="max-h-32"
              mono
            />
          </div>
        </Show>

        {/* Tool output — the result from the command */}
        <Show when={toolOutput()}>
          <div class="px-4 py-3 border-b border-border-subtle">
            <ExpandableContent
              label="Output"
              content={toolOutput()!}
              defaultMaxH="max-h-48"
              mono
              muted={!isError()}
              error={isError()}
            />
          </div>
        </Show>

        {/* Server info */}
        <Show when={quickInfo().serverAddress}>
          <div class="flex flex-wrap gap-2 px-4 py-2 border-b border-border-subtle">
            <MiniStat label="Server" value={`${quickInfo().serverAddress}${quickInfo().serverPort ? ':' + quickInfo().serverPort : ''}`} />
          </div>
        </Show>

        {/* Quick token/model info for gen_ai spans */}
        <Show when={quickInfo().inputTokens || quickInfo().outputTokens}>
          <div class="flex flex-wrap gap-2 px-4 py-2 border-b border-border-subtle">
            <Show when={quickInfo().inputTokens}>
              <MiniStat label="Input" value={`${Number(quickInfo().inputTokens).toLocaleString()} tok`} />
            </Show>
            <Show when={quickInfo().outputTokens}>
              <MiniStat label="Output" value={`${Number(quickInfo().outputTokens).toLocaleString()} tok`} />
            </Show>
            <Show when={quickInfo().reasoningTokens}>
              <MiniStat label="Reasoning" value={`${Number(quickInfo().reasoningTokens).toLocaleString()} tok`} />
            </Show>
            <Show when={quickInfo().cacheWriteTokens}>
              <MiniStat label="Cache Write" value={`${Number(quickInfo().cacheWriteTokens).toLocaleString()} tok`} />
            </Show>
            <Show when={quickInfo().cacheReadTokens}>
              <MiniStat label="Cache Read" value={`${Number(quickInfo().cacheReadTokens).toLocaleString()} tok`} />
            </Show>
          </div>
        </Show>

        {/* Time to first token */}
        <Show when={quickInfo().ttft}>
          <div class="flex flex-wrap gap-2 px-4 py-2 border-b border-border-subtle">
            <MiniStat label="TTFT" value={`${Number(quickInfo().ttft).toLocaleString()}ms`} />
          </div>
        </Show>

        {/* Finish reasons summary */}
        <Show when={finishReasonsSummary()}>
          <div class="px-4 py-2 border-b border-border-subtle">
            <div class="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">Finish Reasons</div>
            <div class="text-[11px] font-mono text-text-secondary">{finishReasonsSummary()}</div>
          </div>
        </Show>

        {/* Status error message */}
        <Show when={isError() && props.span.status?.message}>
          <div class="mx-4 mt-3 px-3 py-2 bg-error/5 border border-error/20 rounded-lg">
            <span class="text-[10px] uppercase tracking-wider text-error font-medium">Error</span>
            <p class="text-xs text-error/80 font-mono mt-1 whitespace-pre-wrap break-all">
              {props.span.status!.message}
            </p>
          </div>
        </Show>

        {/* Tag groups */}
        <div class="px-4 py-3 space-y-3">
          <For each={tagGroups()}>
            {([groupName, tags]) => (
              <div>
                <div class="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
                  {groupName}
                </div>
                <div class="space-y-0.5">
                  <For each={tags as Array<{ key: string; value: unknown; type: string }>}>
                    {(tag) => (
                      <TagRow key={tag.key} value={tag.value} type={tag.type} />
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>

           {/* Resource Attributes (from process) */}
          <Show when={processTags().length > 0}>
            <div>
              <div class="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
                Resource
              </div>
              <div class="space-y-0.5">
                <For each={processTags()}>
                  {(tag: { key: string; value: unknown; type?: string }) => (
                    <TagRow key={tag.key} value={tag.value} type={tag.type || 'string'} />
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        {/* Linked Traces — delegation links */}
        <Show when={(props.span.links?.length ?? 0) > 0}>
          <div class="px-4 py-3 border-t border-border-subtle">
            <div class="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-2">
              Linked Traces
            </div>
            <div class="space-y-1.5">
              <For each={props.span.links!}>
                {(link) => {
                  const linkType = () => link.tags?.find(t => t.key === 'link.type')?.value as string | undefined;
                  const agentName = () => link.tags?.find(t => t.key === 'link.parent_agent')?.value as string | undefined;
                  const runName = () => link.tags?.find(t => t.key === 'link.run_name')?.value as string | undefined;
                  return (
                    <button
                      class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-accent/5 border border-accent/15 hover:bg-accent/10 hover:border-accent/25 transition-colors cursor-pointer text-left"
                      onClick={() => link.traceID && showTraceDetail(link.traceID)}
                      title={`Navigate to linked trace ${link.traceID?.slice(0, 16)}...`}
                    >
                      <svg class="w-3.5 h-3.5 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      <div class="flex-1 min-w-0">
                        <Show when={linkType() === 'delegation'}>
                          <span class="text-[10px] text-accent font-medium">Parent trace</span>
                        </Show>
                        <Show when={linkType() !== 'delegation'}>
                          <span class="text-[10px] text-text-muted">{linkType() || 'linked'}</span>
                        </Show>
                        <Show when={agentName()}>
                          <span class="text-[10px] font-mono text-accent ml-1">{agentName()}</span>
                        </Show>
                        <Show when={runName()}>
                          <div class="text-[9px] font-mono text-text-muted truncate">{runName()}</div>
                        </Show>
                        <div class="text-[9px] font-mono text-text-muted/60 truncate">{link.traceID?.slice(0, 24)}...</div>
                      </div>
                      <svg class="w-3 h-3 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* Events / Logs */}
        <Show when={(props.span.logs?.length ?? 0) > 0}>
          <div class="px-4 py-3 border-t border-border-subtle">
            <div class="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-2">
              Events
            </div>
            <div class="space-y-2">
              <For each={props.span.logs!}>
                {(log) => {
                  const eventName = log.fields?.find((f) => f.key === 'event')?.value as string | undefined;
                  const otherFields = log.fields?.filter((f) => f.key !== 'event') ?? [];

                  const isContentEvent = () =>
                    eventName === 'gen_ai.content.prompt' ||
                    eventName === 'gen_ai.content.completion' ||
                    eventName === 'gen_ai.tool.input' ||
                    eventName === 'gen_ai.tool.output' ||
                    eventName === 'gen_ai.user.message' ||
                    eventName === 'gen_ai.choice' ||
                    eventName === 'gen_ai.system.message' ||
                    eventName === 'gen_ai.assistant.message';

                  const isSystemPrompt = () => eventName === 'gen_ai.system.message';
                  const isFirstToken = () => eventName === 'gen_ai.first_token';

                  const contentLabel = () => {
                    switch (eventName) {
                      case 'gen_ai.content.prompt': return 'Prompt';
                      case 'gen_ai.content.completion': return 'Response';
                      case 'gen_ai.tool.input': return 'Tool Input';
                      case 'gen_ai.tool.output': return 'Tool Output';
                      case 'gen_ai.user.message': return 'Prompt';
                      case 'gen_ai.choice': return 'Response';
                      case 'gen_ai.system.message': return 'System Prompt';
                      case 'gen_ai.assistant.message': return 'Assistant';
                      case 'gen_ai.first_token': return 'First Token';
                      default: return eventName || 'event';
                    }
                  };

                  const contentText = () => {
                    if (isFirstToken()) {
                      const ttftField = otherFields.find((f) => f.key === 'gen_ai.server.time_to_first_token');
                      return ttftField ? `TTFT: ${ttftField.value}ms` : null;
                    }
                    if (!isContentEvent()) return null;
                    const contentKeys = [
                      'gen_ai.prompt', 'gen_ai.completion', 'tool.input', 'tool.output',
                      'gen_ai.message.content', 'gen_ai.choice.message.content',
                    ];
                    for (const key of contentKeys) {
                      const field = otherFields.find((f) => f.key === key);
                      if (field) return String(field.value);
                    }
                    return null;
                  };

                  const stepNumber = () => {
                    if (eventName !== 'gen_ai.assistant.message') return null;
                    const field = otherFields.find((f) => f.key === 'gen_ai.message.step');
                    return field ? String(field.value) : null;
                  };

                  const isErrorOutput = () =>
                    eventName === 'gen_ai.tool.output' &&
                    otherFields.some((f) => f.key === 'tool.error' && f.value === true);

                  // Skip tool.call events in the Events section — they're already shown as waterfall rows
                  if (eventName === 'tool.call') return null;

                  // Skip HTTP noise events (streaming chunk metadata from net/http)
                  if (eventName === 'write' || eventName === 'http.write') {
                    if (otherFields.some(f => f.key === 'http.wrote_bytes')) return null;
                  }

                  return (
                    <div class={`rounded-lg px-3 py-2 border ${
                      isErrorOutput()
                        ? 'bg-error/5 border-error/20'
                        : isSystemPrompt()
                          ? 'bg-purple-500/5 border-purple-500/20'
                          : isFirstToken()
                            ? 'bg-info/5 border-info/20'
                            : isContentEvent()
                              ? 'bg-surface-2 border-border'
                              : 'bg-surface-2 border-border-subtle'
                    }`}>
                      <div class="flex items-center gap-2">
                        <span class={`text-[10px] font-mono font-medium ${
                          isErrorOutput() ? 'text-error' :
                          isSystemPrompt() ? 'text-purple-400' :
                          isFirstToken() ? 'text-info' :
                          isContentEvent() ? 'text-accent' : 'text-warning'
                        }`}>
                          {contentLabel()}
                        </span>
                        <Show when={stepNumber()}>
                          <span class="text-[9px] text-text-muted font-mono">step {stepNumber()}</span>
                        </Show>
                        <Show when={!isContentEvent()}>
                          <span class="text-[9px] text-text-muted font-mono">
                            {log.timestamp > 0 ? new Date(log.timestamp / 1000).toISOString().slice(11, 23) : ''}
                          </span>
                        </Show>
                      </div>
                      <Show when={(isContentEvent() || isFirstToken()) && contentText()}>
                        <div class="mt-1.5 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                          {contentText()}
                        </div>
                      </Show>
                      <Show when={!isContentEvent() && otherFields.length > 0}>
                        <div class="mt-1.5 space-y-0.5">
                          <For each={otherFields}>
                            {(field) => (
                              <div class="flex gap-2 text-[10px]">
                                <span class="text-text-muted font-mono flex-shrink-0">{field.key}:</span>
                                <span class="text-text-secondary font-mono break-all">{String(field.value)}</span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                      {/* Show non-content fields for content events too */}
                      <Show when={isContentEvent()}>
                        {(() => {
                          const metaFields = otherFields.filter(
                            (f) => !['gen_ai.prompt', 'gen_ai.completion', 'tool.input', 'tool.output',
                              'gen_ai.message.content', 'gen_ai.choice.message.content',
                              'gen_ai.server.time_to_first_token', 'gen_ai.message.step'].includes(f.key)
                          );
                          return (
                            <Show when={metaFields.length > 0}>
                              <div class="mt-1 space-y-0.5">
                                <For each={metaFields}>
                                  {(field) => (
                                    <div class="flex gap-2 text-[9px]">
                                      <span class="text-text-muted font-mono flex-shrink-0">{field.key}:</span>
                                      <span class="text-text-secondary font-mono break-all">{String(field.value)}</span>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          );
                        })()}
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ── Subcomponents ──

function ExpandableContent(props: {
  label: string;
  content: string;
  defaultMaxH?: string;
  muted?: boolean;
  error?: boolean;
  mono?: boolean;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const maxH = () => props.defaultMaxH || 'max-h-28';

  return (
    <div>
      <div class="flex items-center justify-between mb-1">
        <div class="text-[10px] font-medium text-text-muted uppercase tracking-wider">{props.label}</div>
        <button
          class="text-[10px] text-accent hover:text-accent/80 transition-colors px-1"
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? 'collapse' : 'expand'}
        </button>
      </div>
      <div
        class={`text-xs font-mono rounded-lg px-3 py-2.5 border overflow-y-auto whitespace-pre-wrap break-words transition-all ${
          props.error
            ? 'bg-error/5 border-error/20 text-error/80'
            : props.muted
              ? 'bg-surface-2 border-border-subtle text-text-secondary'
              : 'bg-surface-2 border-border-subtle text-text'
        } ${expanded() ? 'max-h-[70vh]' : maxH()}`}
      >
        {props.content}
      </div>
    </div>
  );
}

function MiniStat(props: { label: string; value: string; error?: boolean; success?: boolean }) {
  return (
    <div class="flex flex-col gap-0.5 px-2 py-1 rounded-md bg-surface-2 border border-border-subtle min-w-[50px]">
      <span class="text-[9px] text-text-muted uppercase tracking-wider">{props.label}</span>
      <span
        class={`text-[11px] font-mono font-medium ${
          props.error ? 'text-error' : props.success ? 'text-success' : 'text-text'
        }`}
      >
        {props.value}
      </span>
    </div>
  );
}

function TagRow(props: { key: string; value: unknown; type: string }) {
  const isTokenCount = () =>
    props.key.includes('.input_tokens') ||
    props.key.includes('.output_tokens') ||
    props.key.includes('.reasoning_tokens') ||
    props.key.includes('.cache_');
  const isModel = () => props.key.includes('.model') || props.key.includes('.provider');
  const isError = () => props.key === 'tool.error' && props.value === true;

  // Pretty display key (strip namespace prefix)
  const displayKey = () => {
    const k = props.key;
    if (k.startsWith('gen_ai.')) return k.slice(7);
    if (k.startsWith('agent.')) return k.slice(6);
    if (k.startsWith('tool.')) return k.slice(5);
    if (k.startsWith('memory.')) return k.slice(7);
    if (k.startsWith('step.')) return k.slice(5);
    if (k.startsWith('delegation.')) return k.slice(11);
    return k;
  };

  // Format value — special handling for finish_reasons
  const displayValue = () => {
    const v = props.value;
    // Parse repeated finish_reasons into a summary
    if (props.key === 'gen_ai.response.finish_reasons' && typeof v === 'string') {
      const reasons = v.split(',').map(r => r.trim()).filter(Boolean);
      if (reasons.length > 3) {
        const counts = new Map<string, number>();
        for (const r of reasons) counts.set(r, (counts.get(r) || 0) + 1);
        const parts: string[] = [];
        for (const [reason, count] of counts) parts.push(count > 1 ? `${count}x ${reason}` : reason);
        return parts.join(', ');
      }
    }
    if (typeof v === 'number') {
      if (isTokenCount()) return v.toLocaleString();
      return String(v);
    }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v ?? '');
  };

  return (
    <div class="flex items-start gap-2 py-0.5">
      <span
        class="text-[10px] font-mono text-text-muted flex-shrink-0 min-w-[110px] truncate"
        title={props.key}
      >
        {displayKey()}
      </span>
      <span
        class={`text-[11px] font-mono break-all ${
          isError()
            ? 'text-error'
            : isModel()
              ? 'text-accent font-medium'
              : isTokenCount()
                ? 'text-info'
                : 'text-text-secondary'
        }`}
        title={`${props.key}: ${displayValue()}`}
      >
        {displayValue()}
      </span>
    </div>
  );
}

/** Format JSON string for display (pretty-print if valid JSON) */
function formatJSON(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function formatDuration(ms: number): string {
  if (ms < 0.01) return '<0.01ms';
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
