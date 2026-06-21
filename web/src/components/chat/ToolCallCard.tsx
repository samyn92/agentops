// ToolCallCard — Unified tool lifecycle card.
// One card, one lifecycle: composing → running → done.
// Same shell for all tools. Content varies by status and tool type.
// Design principles:
// - Show intent, not bytes (delegation = "Delegating to coder", bash = "$ command")
// - Elapsed time always visible (>1s shows live timer)
// - pulse-left-edge animation for active states
// - 150ms CSS transitions for state changes
//
// IMPORTANT: SolidJS reactivity note — the parent ToolCallCard owns the
// elapsed timer and the persistent DOM shell. Status changes (composing →
// running → done) swap inner content via Show/Switch but never unmount
// the outer component, so the timer and entry animation survive deltas.
import { Show, Switch, Match, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ToolPart, ToolMetadata } from '../../types';
import Badge from '../shared/Badge';
import GenericCard from '../tools/GenericCard';
import TerminalCard from '../tools/TerminalCard';
import DiffCard from '../tools/DiffCard';
import CodeCard from '../tools/CodeCard';
import FileTreeCard from '../tools/FileTreeCard';
import SearchResultsCard from '../tools/SearchResultsCard';
import FileCreatedCard from '../tools/FileCreatedCard';
import WebFetchCard from '../tools/WebFetchCard';
import AgentRunCard from '../tools/AgentRunCard';
import DelegationFanOutCard from '../tools/DelegationFanOutCard';
import KubernetesCard from '../tools/KubernetesCard';
import HelmCard from '../tools/HelmCard';
import {
  detectToolCategory,
  toolThemes,
  getCategoryIcon,
  getCategoryLabel,
  getToolDisplayName,
  type ToolCategory,
} from '../../lib/capability-themes';
import { isToolCollapsed } from '../../stores/settings';
import { getToolStyle, parsePartialArgs, parseAgentName } from '../../lib/detect';

interface ToolCallCardProps {
  part: ToolPart;
  class?: string;
}

interface ToolCardRendererProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  headerless?: boolean;
}

// Tool renderer dispatch map
const renderers: Record<string, (props: ToolCardRendererProps) => any> = {
  terminal: TerminalCard,
  diff: DiffCard,
  code: CodeCard,
  'file-tree': FileTreeCard,
  'search-results': SearchResultsCard,
  'file-created': FileCreatedCard,
  'web-fetch': WebFetchCard,
  'agent-run': AgentRunCard,
  'agent-run-status': AgentRunCard,
  'delegation-fan-out': DelegationFanOutCard,
  'kubernetes-resources': KubernetesCard,
  'helm-release': HelmCard,
};

// ── Format helpers ──

function formatDuration(ms: number | undefined): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function stripCommandPrefix(output: string | undefined): string {
  if (!output) return '';
  const firstNewline = output.indexOf('\n');
  if (firstNewline > 0 && output.startsWith('$ ')) {
    return output.slice(firstNewline + 1);
  }
  return output;
}

// ── Intent-based composing label ──

function getComposingIntent(toolName: string, input: string): { label: string; detail: string } {
  if (toolName === 'run_agent' || toolName === 'run_agents') {
    const agent = parseAgentName(input);
    return {
      label: 'Delegating',
      detail: agent ? `to ${agent}` : '',
    };
  }

  const parsed = parsePartialArgs(toolName, input);
  const style = getToolStyle(toolName);

  switch (toolName) {
    case 'bash':
      return { label: 'Composing', detail: parsed ? `$ ${parsed.value}` : style.label };
    case 'read':
      return { label: 'Reading', detail: parsed?.value || '' };
    case 'edit':
      return { label: 'Editing', detail: parsed?.value || '' };
    case 'write':
      return { label: 'Writing', detail: parsed?.value || '' };
    case 'glob':
    case 'ls':
      return { label: 'Finding files', detail: parsed?.value || '' };
    case 'grep':
      return { label: 'Searching', detail: parsed?.value || '' };
    case 'fetch':
    case 'webfetch':
      return { label: 'Fetching', detail: parsed?.value || '' };
    case 'get_agent_run':
      return { label: 'Checking run', detail: parsed?.value || '' };
    default:
      return { label: 'Composing', detail: style.label };
  }
}

// ── Running activity label ──

function getRunningLabel(toolName: string, input: string): { label: string; detail: string } {
  try {
    const parsed = JSON.parse(input);
    switch (toolName) {
      case 'bash': {
        const cmd = parsed.command as string || '';
        return { label: 'Executing', detail: cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd };
      }
      case 'read':
        return { label: 'Reading', detail: (parsed.filePath || '').split('/').slice(-2).join('/') };
      case 'edit':
        return { label: 'Editing', detail: (parsed.filePath || '').split('/').slice(-2).join('/') };
      case 'write':
        return { label: 'Writing', detail: (parsed.filePath || '').split('/').slice(-2).join('/') };
      case 'glob':
      case 'ls':
        return { label: 'Finding files', detail: parsed.pattern || '' };
      case 'grep':
        return { label: 'Searching', detail: parsed.pattern || '' };
      case 'fetch':
      case 'webfetch': {
        const url = (parsed.url as string) || '';
        return { label: 'Fetching', detail: url.length > 50 ? url.slice(0, 50) + '...' : url };
      }
      case 'task':
        return { label: 'Running sub-agent', detail: parsed.description || '' };
      case 'run_agent': {
        const agent = parsed.agent || parsed.name || '';
        return { label: 'Delegating', detail: agent ? `to ${agent}` : '' };
      }
      case 'run_agents': {
        const delegations = parsed.delegations as Array<{ agent?: string }> | undefined;
        return {
          label: 'Delegating',
          detail: delegations ? `to ${delegations.map(d => d.agent || '?').join(', ')}` : '',
        };
      }
      case 'get_agent_run':
        return { label: 'Checking run', detail: parsed.name || '' };
      default: {
        if (toolName.startsWith('mcp_')) {
          const keys = Object.keys(parsed);
          if (keys.length > 0) {
            const first = String(parsed[keys[0]]);
            return { label: `Running`, detail: first.length > 50 ? first.slice(0, 50) + '...' : first };
          }
        }
        return { label: `Running`, detail: toolName.replace(/[_-]/g, ' ') };
      }
    }
  } catch {
    return { label: 'Running', detail: '' };
  }
}

// ── Tool Icon ──

function ToolIcon(props: { toolName: string; category: ToolCategory; class?: string }) {
  const isThemed = () => props.category !== 'builtin';
  const theme = () => toolThemes[props.category];

  if (isThemed()) {
    const Icon = getCategoryIcon(props.category);
    return <Icon class={`${props.class || 'w-6 h-6'} ${theme().iconColor}`} />;
  }

  const style = getToolStyle(props.toolName);
  return (
    <Switch fallback={
      <svg class={`${props.class || 'w-4 h-4'} ${style.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    }>
      <Match when={props.toolName === 'bash'}>
        <svg class={`${props.class || 'w-4 h-4'} text-[#4EAA25]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </Match>
      <Match when={props.toolName === 'read'}>
        <svg class={`${props.class || 'w-4 h-4'} text-[#E8A838]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </Match>
      <Match when={props.toolName === 'edit' || props.toolName === 'write'}>
        <svg class={`${props.class || 'w-4 h-4'} text-[#E8A838]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </Match>
      <Match when={props.toolName === 'glob' || props.toolName === 'ls'}>
        <svg class={`${props.class || 'w-4 h-4'} text-[#4285F4]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </Match>
      <Match when={props.toolName === 'grep'}>
        <svg class={`${props.class || 'w-4 h-4'} text-[#4285F4]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </Match>
      <Match when={props.toolName === 'fetch' || props.toolName === 'webfetch'}>
        <svg class={`${props.class || 'w-4 h-4'} text-info`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
        </svg>
      </Match>
      <Match when={props.toolName === 'task'}>
        <svg class={`${props.class || 'w-4 h-4'} text-info`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </Match>
      <Match when={props.toolName === 'run_agent' || props.toolName === 'run_agents' || props.toolName === 'get_agent_run'}>
        <img src="/logo.png" alt="" class={props.class || 'w-5 h-5'} draggable={false} />
      </Match>
    </Switch>
  );
}

// ── Static input summary for non-builtin tools ──

function ToolInputSection(props: { input: string; output?: string }) {
  const inputSummary = createMemo(() => {
    if (props.output) {
      const firstLine = props.output.split('\n')[0];
      if (firstLine.startsWith('$ ')) return firstLine;
    }
    try {
      const parsed = JSON.parse(props.input);
      const keys = Object.keys(parsed);
      if (keys.length === 0) return '';
      return keys.slice(0, 3).map((k) => {
        const v = parsed[k];
        const vStr = typeof v === 'string'
          ? (v.length > 40 ? `"${v.slice(0, 40)}..."` : `"${v}"`)
          : JSON.stringify(v);
        return `${k}=${vStr}`;
      }).join(', ') + (keys.length > 3 ? ` +${keys.length - 3} more` : '');
    } catch {
      return '';
    }
  });

  return (
    <Show when={inputSummary()}>
      <div class="px-3 py-1 border-b border-border-subtle/30">
        <span class="text-xs text-text-secondary font-mono truncate block">{inputSummary()}</span>
      </div>
    </Show>
  );
}

// ── Main component ──
// Single persistent component per tool call. The elapsed timer, entry
// animation, and DOM shell all live here and survive status transitions.
// Inner content swaps via Show guards keyed on status category.

export default function ToolCallCard(props: ToolCallCardProps) {
  // Access part reactively via getter — SolidJS will track props.part changes
  // but won't unmount/remount us (we're the same component instance).
  const part = () => props.part;
  const status = () => part().status;

  // Is this tool still "active" (composing or running)?
  const isActive = () => status() === 'composing' || status() === 'running' || status() === 'pending';
  const isDone = () => status() === 'completed' || status() === 'error';

  // ── Elapsed timer (owned by parent, survives status transitions) ──
  const [elapsed, setElapsed] = createSignal(0);
  const startTime = Date.now();
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  // Start timer immediately; stop when done
  createEffect(() => {
    if (isActive()) {
      if (!timerInterval) {
        timerInterval = setInterval(() => {
          setElapsed(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
      }
    } else {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }
  });
  onCleanup(() => {
    if (timerInterval) clearInterval(timerInterval);
  });

  // ── Derived state for active card ──
  const category = createMemo(() => detectToolCategory(part().toolName));

  // Intent label for composing state (updates reactively as input grows)
  const intent = createMemo(() => {
    if (status() !== 'composing') return { label: '', detail: '' };
    return getComposingIntent(part().toolName, part().input);
  });

  // Activity label for running state
  const activity = createMemo(() => {
    if (status() !== 'running' && status() !== 'pending') return { label: '', detail: '' };
    return getRunningLabel(part().toolName, part().input);
  });

  // ── Active card (composing / running) ──
  // Rendered as a single persistent div. Inner text swaps reactively.

  const activeLabel = () => {
    if (status() === 'composing') return intent().label;
    return activity().label;
  };

  const activeDetail = () => {
    if (status() === 'composing') return intent().detail;
    return activity().detail;
  };

  // ── Done state helpers ──
  const theme = createMemo(() => toolThemes[category()]);
  const isThemed = createMemo(() => category() !== 'builtin');
  const categoryLabel = createMemo(() => getCategoryLabel(category()));

  const defaultExpanded = () => !isToolCollapsed(part().toolName, part().isError);
  const [expanded, setExpanded] = createSignal(defaultExpanded());

  // Reset expanded when transitioning to done
  createEffect(() => {
    if (isDone()) {
      setExpanded(defaultExpanded());
    }
  });

  const WatermarkIcon = createMemo(() => {
    if (!isThemed() || category() === 'generic') return null;
    return getCategoryIcon(category());
  });

  const statusConfig = createMemo(() => {
    if (part().isError) return { label: 'Error', variant: 'error' as const };
    return { label: 'Done', variant: 'success' as const };
  });

  const Renderer = createMemo(() => {
    const uiHint = part().metadata?.ui as string | undefined;
    if (uiHint && renderers[uiHint]) return renderers[uiHint];
    switch (part().toolName) {
      case 'bash': return TerminalCard;
      case 'edit': return DiffCard;
      case 'read': return CodeCard;
      case 'glob': case 'ls': return FileTreeCard;
      case 'grep': return SearchResultsCard;
      case 'write': return FileCreatedCard;
      case 'fetch': case 'webfetch': return WebFetchCard;
      case 'run_agent': case 'get_agent_run': return AgentRunCard;
      case 'run_agents': return DelegationFanOutCard;
      default: return GenericCard;
    }
  });

  // MCP metadata
  const mcpParsed = createMemo(() => {
    const name = part().toolName;
    if (!name.startsWith('mcp_')) return null;
    const rest = name.slice(4);
    const idx = rest.indexOf('_');
    if (idx < 0) return { server: rest, tool: '' };
    return { server: rest.slice(0, idx), tool: rest.slice(idx + 1) };
  });
  const mcpServer = createMemo(() => (part().metadata?.server as string | undefined) || mcpParsed()?.server || '');
  const mcpOriginalTool = createMemo(() => (part().metadata?.tool as string | undefined) || mcpParsed()?.tool || '');
  const mcpTransport = createMemo(() => (part().metadata?.transport as string | undefined) || '');

  const hasInputArgs = createMemo(() => {
    if (!part().input || part().input === '{}') return false;
    const skip = ['bash', 'read', 'edit', 'write', 'grep', 'glob', 'ls', 'fetch', 'webfetch', 'run_agent', 'run_agents', 'get_agent_run'];
    if (skip.includes(part().toolName)) return false;
    return true;
  });

  // Compact inline row for "read" tool when done
  const isReadFile = createMemo(() => isDone() && part().toolName === 'read' && !part().isError);

  // ── Render ──

  return (
    <>
      {/* Active state: composing or running — lightweight inline card */}
      <Show when={isActive()}>
        <div class="tool-card tool-card--active fade-slide-in">
          <div class="tool-card__left-edge tool-card__left-edge--pulse" />
          <div class="flex items-center gap-2.5 px-3 py-2 min-w-0">
            {/* Icon: plain for composing, spinner wrapper for running */}
            <Show
              when={status() !== 'composing'}
              fallback={
                <ToolIcon toolName={part().toolName} category={category()} class="w-4 h-4 shrink-0" />
              }
            >
              <div class="relative flex items-center justify-center w-5 h-5 shrink-0">
                <div class="absolute inset-0 border-[1.5px] border-accent/20 border-t-accent/70 rounded-full animate-spin" />
                <ToolIcon toolName={part().toolName} category={category()} class="w-3 h-3" />
              </div>
            </Show>

            {/* Label + detail */}
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <span class="text-xs font-semibold text-text-secondary shrink-0">
                {activeLabel()}
              </span>
              <Show when={activeDetail()}>
                <span class="text-xs text-text-muted font-mono truncate min-w-0">
                  {activeDetail()}
                </span>
              </Show>
              <Show when={status() === 'composing' && !activeDetail()}>
                <span class="flex items-center gap-1">
                  <span class="typing-dot w-1 h-1 rounded-full bg-accent" />
                  <span class="typing-dot w-1 h-1 rounded-full bg-accent" style="animation-delay: 0.2s" />
                  <span class="typing-dot w-1 h-1 rounded-full bg-accent" style="animation-delay: 0.4s" />
                </span>
              </Show>
            </div>

            {/* Elapsed timer */}
            <Show when={elapsed() >= 1}>
              <span class="text-[10px] text-text-muted tabular-nums shrink-0">{formatElapsed(elapsed())}</span>
            </Show>
          </div>
        </div>
      </Show>

      {/* Done state: compact read file row */}
      <Show when={isReadFile()}>
        <div class="group">
          <div
            onClick={() => setExpanded((v) => !v)}
            class="flex items-center gap-2 py-1 cursor-pointer select-none text-sm hover:bg-surface-hover/50 rounded px-1 -mx-1 transition-colors"
          >
            <span class={`shrink-0 transition-transform duration-150 ${expanded() ? 'rotate-90' : ''} text-text-muted`}>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </span>
            <ToolIcon toolName="read" category="builtin" class="w-3.5 h-3.5" />
            <span class="text-text-muted font-medium">Read</span>
            <span class="text-text-secondary font-mono text-xs truncate">
              {(() => {
                try {
                  const parsed = JSON.parse(part().input);
                  return parsed.filePath || parsed.file_path || '';
                } catch { return ''; }
              })()}
            </span>
            <Show when={part().duration || (typeof part().metadata?.duration === 'number' && part().metadata?.duration)}>
              <span class="text-xs text-text-muted ml-auto shrink-0">{formatDuration(part().duration ?? (part().metadata?.duration as number))}</span>
            </Show>
          </div>
          <Show when={expanded()}>
            <div class="ml-7 mb-1">
              <Dynamic
                component={Renderer()}
                toolName={part().toolName}
                input={part().input}
                output={part().output}
                isError={part().isError}
                metadata={part().metadata}
                headerless
              />
            </div>
          </Show>
        </div>
      </Show>

      {/* Done state: full rich card (non-read tools) */}
      <Show when={isDone() && !isReadFile()}>
        <div
          class={`tool-card rounded-lg border relative overflow-hidden ${
            isThemed() ? `${theme().border} ${theme().bg}` : part().isError ? 'border-error/30 bg-error/5' : 'border-border bg-surface-2/30'
          } ${props.class || ''}`}
        >
          {/* Watermark */}
          <Show when={WatermarkIcon()}>
            {(Icon) => (
              <div class="absolute -right-4 -bottom-4 pointer-events-none">
                <Dynamic component={Icon()} class={`w-32 h-32 max-md:w-20 max-md:h-20 ${theme().watermark}`} />
              </div>
            )}
          </Show>

          {/* Header */}
          <div
            onClick={() => setExpanded((v) => !v)}
            class={`px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 relative cursor-pointer select-none transition-colors hover:bg-surface-hover/30 ${
              expanded() ? 'border-b border-inherit' : ''
            } ${isThemed() ? theme().headerBg : ''}`}
          >
            <span class={`shrink-0 transition-transform duration-150 ${expanded() ? 'rotate-90' : ''} text-text-muted`}>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </span>

            <ToolIcon toolName={part().toolName} category={category()} />

            <Show
              when={mcpServer()}
              fallback={
                <span class="text-sm font-semibold text-text shrink-0">
                  {getToolDisplayName(part().toolName)}
                </span>
              }
            >
              <span class="text-sm font-mono text-text-secondary shrink-0">
                {mcpServer()}<Show when={mcpOriginalTool()}>{' '}<span class="text-text-muted">&rsaquo;</span>{' '}{mcpOriginalTool()}</Show>
              </span>
            </Show>

            <Show when={isThemed() && categoryLabel() && !mcpServer()}>
              <span class={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${theme().badge}`}>
                {categoryLabel()}
              </span>
            </Show>

            <Show when={mcpTransport()}>
              <span class={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                mcpTransport() === 'sse'
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'bg-indigo-500/15 text-indigo-400'
              }`}>
                {mcpTransport() === 'sse' ? 'MCP Server' : 'Inline MCP'}
              </span>
            </Show>

            <Show when={part().metadata?.version}>
              <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-emerald-500/15 text-emerald-400">
                v{part().metadata!.version as string}
              </span>
            </Show>

            <Show when={part().metadata?.description || part().metadata?.command}>
              <span class="text-xs text-text-muted truncate min-w-0 max-md:w-full max-md:order-last">
                {(() => {
                  const desc = part().metadata?.description as string | undefined;
                  const cmd = part().metadata?.command as string | undefined;
                  const label = desc || cmd || '';
                  return label.length > 80 ? `${label.slice(0, 80)}...` : label;
                })()}
              </span>
            </Show>

            <span class="flex items-center gap-2 ml-auto shrink-0">
              <Badge variant={statusConfig().variant}>
                {part().isError
                  ? 'Error'
                  : formatDuration(part().duration || (part().metadata?.duration as number | undefined)) || 'Done'
                }
              </Badge>
            </span>
          </div>

          {/* Content */}
          <Show when={expanded()}>
            <div class="relative">
              <Show when={hasInputArgs()}>
                <ToolInputSection input={part().input} output={part().output} />
              </Show>
              <Dynamic
                component={Renderer()}
                toolName={part().toolName}
                input={part().input}
                output={stripCommandPrefix(part().output)}
                isError={part().isError}
                metadata={part().metadata}
                headerless
              />
            </div>
          </Show>
        </div>
      </Show>
    </>
  );
}
