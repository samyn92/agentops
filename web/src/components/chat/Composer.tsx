// Composer — input area with send/stop/steer/resource-attach functionality
import { createSignal, Show, createMemo, createEffect, For, onCleanup } from 'solid-js';
import { Popover } from '@ark-ui/solid/popover';
import { LightningBoltIcon, SendIcon, StopIcon, CloseIcon, PaperclipIcon } from '../shared/Icons';
import Tip from '../shared/Tip';
import { formatTokens } from '../../lib/format';
import { streaming, contextBudget } from '../../stores/chat';
import { sendMessage, abortStream, steerAgent, composerSeed, setComposerSeed } from '../../stores/chat';
import { selectedAgent, getAgentStatus } from '../../stores/agents';
import { selectedContextItems, removeContextItem, selectedContextCount, clearContextItems, allResources, toggleContextItem, isContextItemSelected } from '../../stores/resources';
import { resourceContextKey, resourceKindIcon } from '../../types/api';
import type { ResourceContext, ContextBudget as ContextBudgetType, AgentResourceBinding } from '../../types';

// ── Context window usage indicator ──

function ContextUsageIndicator(props: { budget: ContextBudgetType }) {
  const usedTokens = createMemo(() => {
    const b = props.budget;
    return b.actual_input_tokens > 0
      ? b.actual_input_tokens
      : b.system_prompt_tokens + b.tool_tokens + b.memory_context_tokens + b.conversation_tokens + b.prompt_tokens;
  });

  const pct = createMemo(() => {
    if (props.budget.context_window <= 0) return 0;
    return Math.min((usedTokens() / props.budget.context_window) * 100, 100);
  });

  const barColor = createMemo(() => {
    const p = pct();
    if (p < 50) return 'bg-accent';
    if (p < 75) return 'bg-warning';
    return 'bg-error';
  });

  const textColor = createMemo(() => {
    const p = pct();
    if (p < 50) return 'text-text-muted/60';
    if (p < 75) return 'text-warning';
    return 'text-error';
  });

  return (
    <Popover.Root positioning={{ placement: 'top-start' }}>
      <Popover.Trigger
        class={`inline-flex items-center gap-1.5 ${textColor()} hover:text-text-secondary transition-colors cursor-pointer`}
      >
        <span class="inline-flex items-center w-8 h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <span
            class={`h-full rounded-full transition-all ${barColor()}`}
            style={{ width: `${pct()}%` }}
          />
        </span>
        <span class="text-[11px] font-mono tabular-nums select-none">
          {pct().toFixed(0)}%
        </span>
      </Popover.Trigger>
      <Popover.Positioner>
        <Popover.Content class="bg-surface border border-border rounded-lg shadow-lg p-3 w-56 z-50">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-text-secondary font-medium">Context window</span>
            <span class="text-xs font-mono tabular-nums text-text-muted">
              {formatTokens(usedTokens())} / {formatTokens(props.budget.context_window)}
            </span>
          </div>

          <div class="w-full h-2 bg-surface-2 rounded-full overflow-hidden mb-3">
            <div
              class={`h-full rounded-full transition-all ${barColor()}`}
              style={{ width: `${pct()}%` }}
            />
          </div>

          <div class="space-y-1.5 text-[11px]">
            <BudgetRow label="System prompt" tokens={props.budget.system_prompt_tokens} total={props.budget.context_window} />
            <BudgetRow label="Tools" tokens={props.budget.tool_tokens} total={props.budget.context_window} />
            <BudgetRow label="Memory context" tokens={props.budget.memory_context_tokens} total={props.budget.context_window} />
            <BudgetRow label="Conversation" tokens={props.budget.conversation_tokens} total={props.budget.context_window} />
            <BudgetRow label="User prompt" tokens={props.budget.prompt_tokens} total={props.budget.context_window} />
            <div class="border-t border-border-subtle pt-1.5 mt-1.5">
              <div class="flex justify-between text-text-secondary">
                <span>Available</span>
                <span class="font-mono tabular-nums">
                  {formatTokens(Math.max(0, props.budget.context_window - usedTokens()))}
                </span>
              </div>
            </div>
            <Show when={props.budget.cache_read_tokens > 0}>
              <div class="flex justify-between text-text-muted/60">
                <span>Cache hits</span>
                <span class="font-mono tabular-nums text-accent/70">
                  {formatTokens(props.budget.cache_read_tokens)}
                </span>
              </div>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}

// Card-styled context usage (matches model button pill)
function ContextUsageIndicatorCard(props: { budget: ContextBudgetType }) {
  const usedTokens = createMemo(() => {
    const b = props.budget;
    return b.actual_input_tokens > 0
      ? b.actual_input_tokens
      : b.system_prompt_tokens + b.tool_tokens + b.memory_context_tokens + b.conversation_tokens + b.prompt_tokens;
  });

  const pct = createMemo(() => {
    if (props.budget.context_window <= 0) return 0;
    return Math.min((usedTokens() / props.budget.context_window) * 100, 100);
  });

  const barColor = createMemo(() => {
    const p = pct();
    if (p < 50) return 'bg-accent';
    if (p < 75) return 'bg-warning';
    return 'bg-error';
  });

  const textColor = createMemo(() => {
    const p = pct();
    if (p < 50) return 'text-text-muted/50';
    if (p < 75) return 'text-warning';
    return 'text-error';
  });

  return (
    <Popover.Root positioning={{ placement: 'top-start' }}>
      <Popover.Trigger
        class={`inline-flex items-center gap-1.5 px-2 py-1 bg-surface-2 rounded-lg text-[10px] font-mono border border-border-subtle shadow-sm hover:border-border transition-colors cursor-pointer ${textColor()}`}
      >
        <span class="inline-flex items-center w-8 h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <span
            class={`h-full rounded-full transition-all ${barColor()}`}
            style={{ width: `${pct()}%` }}
          />
        </span>
        <span class="tabular-nums select-none">
          {pct().toFixed(0)}%
        </span>
      </Popover.Trigger>
      <Popover.Positioner>
        <Popover.Content class="bg-surface border border-border rounded-lg shadow-lg p-3 w-56 z-50">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-text-secondary font-medium">Context window</span>
            <span class="text-xs font-mono tabular-nums text-text-muted">
              {formatTokens(usedTokens())} / {formatTokens(props.budget.context_window)}
            </span>
          </div>

          <div class="w-full h-2 bg-surface-2 rounded-full overflow-hidden mb-3">
            <div
              class={`h-full rounded-full transition-all ${barColor()}`}
              style={{ width: `${pct()}%` }}
            />
          </div>

          <div class="space-y-1.5 text-[11px]">
            <BudgetRow label="System prompt" tokens={props.budget.system_prompt_tokens} total={props.budget.context_window} />
            <BudgetRow label="Tools" tokens={props.budget.tool_tokens} total={props.budget.context_window} />
            <BudgetRow label="Memory context" tokens={props.budget.memory_context_tokens} total={props.budget.context_window} />
            <BudgetRow label="Conversation" tokens={props.budget.conversation_tokens} total={props.budget.context_window} />
            <BudgetRow label="User prompt" tokens={props.budget.prompt_tokens} total={props.budget.context_window} />
            <div class="border-t border-border-subtle pt-1.5 mt-1.5">
              <div class="flex justify-between text-text-secondary">
                <span>Available</span>
                <span class="font-mono tabular-nums">
                  {formatTokens(Math.max(0, props.budget.context_window - usedTokens()))}
                </span>
              </div>
            </div>
            <Show when={props.budget.cache_read_tokens > 0}>
              <div class="flex justify-between text-text-muted/60">
                <span>Cache hits</span>
                <span class="font-mono tabular-nums text-accent/70">
                  {formatTokens(props.budget.cache_read_tokens)}
                </span>
              </div>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}

function BudgetRow(props: { label: string; tokens: number; total: number }) {
  const pct = () => props.total > 0 ? (props.tokens / props.total * 100).toFixed(1) : '0';
  return (
    <div class="flex justify-between text-text-muted">
      <span>{props.label}</span>
      <span class="font-mono tabular-nums">
        {formatTokens(props.tokens)} <span class="text-text-muted/40">({pct()}%)</span>
      </span>
    </div>
  );
}

interface ComposerProps {
  class?: string;
}

// ── Context chip for selected resource items ──

function ContextChip(props: { item: ResourceContext; onRemove: () => void }) {
  const isK8s = () => props.item.kind === 'kubernetes';
  const isGitHub = () => props.item.kind === 'github-repo' || props.item.kind === 'github-org';
  const isGitLab = () => props.item.kind === 'gitlab-project' || props.item.kind === 'gitlab-group';

  const label = () => {
    if (isK8s()) {
      const name = props.item.path?.split('/').pop() || props.item.title || props.item.item_type;
      return name;
    }
    switch (props.item.item_type) {
      case 'file':
        return props.item.path?.split('/').pop() || props.item.path || 'file';
      case 'directory':
        return (props.item.path?.split('/').pop() || props.item.path || 'dir') + '/';
      case 'commit':
        return props.item.sha?.slice(0, 7) || 'commit';
      case 'branch':
        return props.item.path || 'branch';
      case 'issue':
        return `#${props.item.number}` + (props.item.title ? ` ${props.item.title}` : '');
      case 'merge_request':
        return `!${props.item.number}` + (props.item.title ? ` ${props.item.title}` : '');
      default:
        return props.item.item_type;
    }
  };

  // Human-readable type label
  const typeLabel = () => {
    if (isK8s()) {
      return props.item.item_type; // deployment, pod, service, etc.
    }
    switch (props.item.item_type) {
      case 'file': return 'file';
      case 'directory': return 'dir';
      case 'commit': return 'commit';
      case 'branch': return 'branch';
      case 'issue': return 'issue';
      case 'merge_request': return isGitHub() ? 'PR' : 'MR';
      default: return props.item.item_type;
    }
  };

  // Platform icon (branded SVG)
  const platformIcon = () => {
    if (isK8s()) {
      return (
        <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 722 702" fill="#326CE5">
          <path d="M358.986 1.456c-10.627.472-19.969 4.96-28.832 10.08l-248.96 144a68.8 68.8 0 00-25.344 25.504 64.64 64.64 0 00-8.832 34.56v288a64.64 64.64 0 008.832 34.56 68.8 68.8 0 0025.344 25.504l248.96 144c8.64 5.024 17.952 9.312 28.352 10.08a68.8 68.8 0 0036.288-10.08l248.96-144a68.8 68.8 0 0025.344-25.504 64.64 64.64 0 008.832-34.56v-288a64.64 64.64 0 00-8.832-34.56 68.8 68.8 0 00-25.344-25.504l-248.96-144c-9.152-5.344-18.816-9.152-28.768-10.08a78.08 78.08 0 00-7.04 0z"/>
        </svg>
      );
    }
    if (isGitLab()) {
      return (
        <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="#E24329">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
        </svg>
      );
    }
    // Default: GitHub
    return (
      <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
    );
  };

  const chipColor = () => {
    if (isK8s()) return 'bg-[#326CE5]/10 text-[#326CE5] border-[#326CE5]/25';
    if (isGitLab()) return 'bg-[#E24329]/10 text-[#E24329] border-[#E24329]/25';
    return 'bg-accent/10 text-accent border-accent/25';
  };

  const typeBadgeColor = () => {
    if (isK8s()) return 'bg-[#326CE5]/15 text-[#326CE5]';
    if (isGitLab()) return 'bg-[#E24329]/15 text-[#E24329]';
    return 'bg-accent/15 text-accent';
  };

  return (
    <span
      class={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg border ${chipColor()} font-medium max-w-[240px]`}
      title={`${props.item.item_type}: ${props.item.title || props.item.path || ''} (${props.item.resource_name})`}
    >
      {platformIcon()}
      <span class={`text-[9px] uppercase tracking-wide font-semibold px-1 py-0.5 rounded ${typeBadgeColor()}`}>
        {typeLabel()}
      </span>
      <span class="truncate">{label()}</span>
      <button
        class="flex-shrink-0 ml-0.5 hover:text-error transition-colors opacity-60 hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
      >
        <CloseIcon class="w-3 h-3" />
      </button>
    </span>
  );
}

// ── Resource Picker (popover from circular button, left of textarea) ──

function ResourcePickerIcon(props: { kind: string; class?: string }) {
  const cls = () => props.class || 'w-3.5 h-3.5';
  switch (resourceKindIcon(props.kind as any)) {
    case 'github': return (
      <svg class={cls()} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
    );
    case 'gitlab': return (
      <svg class={cls()} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
      </svg>
    );
    default: return (
      <svg class={cls()} viewBox="0 0 722 702" fill="currentColor">
        <path d="M358.986 1.456c-10.627.472-19.969 4.96-28.832 10.08l-248.96 144a68.8 68.8 0 00-25.344 25.504 64.64 64.64 0 00-8.832 34.56v288a64.64 64.64 0 008.832 34.56 68.8 68.8 0 0025.344 25.504l248.96 144c8.64 5.024 17.952 9.312 28.352 10.08a68.8 68.8 0 0036.288-10.08l248.96-144a68.8 68.8 0 0025.344-25.504 64.64 64.64 0 008.832-34.56v-288a64.64 64.64 0 00-8.832-34.56 68.8 68.8 0 00-25.344-25.504l-248.96-144c-9.152-5.344-18.816-9.152-28.768-10.08a78.08 78.08 0 00-7.04 0z"/>
      </svg>
    );
  }
}

function ResourcePicker(props: { disabled: boolean }) {
  const resources = createMemo(() => allResources());
  const hasResources = () => resources().length > 0;
  const ctxCount = () => selectedContextCount();

  return (
    <Show when={hasResources()}>
      <Popover.Root positioning={{ placement: 'top-start' }}>
        <Popover.Trigger
          class={`flex-shrink-0 self-center p-2 rounded-full transition-all duration-200 ${
            ctxCount() > 0
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
          } ${props.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          disabled={props.disabled}
        >
          <div class="relative">
            <PaperclipIcon class="w-4 h-4" />
            <Show when={ctxCount() > 0}>
              <span class="absolute -top-1.5 -right-1.5 px-1 min-w-[14px] h-[14px] flex items-center justify-center text-[8px] font-bold bg-accent text-primary-foreground rounded-full leading-none">
                {ctxCount()}
              </span>
            </Show>
          </div>
        </Popover.Trigger>
        <Popover.Positioner>
          <Popover.Content class="bg-surface border border-border rounded-xl shadow-xl w-64 overflow-hidden z-50">
            <div class="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
              <span class="text-[11px] font-semibold text-text uppercase tracking-wide">Resources</span>
              <Show when={ctxCount() > 0}>
                <button
                  class="text-[10px] text-text-muted hover:text-error transition-colors"
                  onClick={() => clearContextItems()}
                >
                  Clear all
                </button>
              </Show>
            </div>
            <div class="max-h-64 overflow-y-auto py-1">
              <For each={resources()}>
                {(res) => <ResourcePickerItem resource={res} />}
              </For>
            </div>
          </Popover.Content>
        </Popover.Positioner>
      </Popover.Root>
    </Show>
  );
}

function ResourcePickerItem(props: { resource: AgentResourceBinding }) {
  const res = () => props.resource;

  const subtitle = () => {
    if (res().kind === 'github-repo' && res().github) return `${res().github!.owner}/${res().github!.repo}`;
    if (res().kind === 'gitlab-project' && res().gitlab) return res().gitlab!.project;
    if (res().kind === 'kubernetes-cluster') return 'Cluster';
    return res().kind;
  };

  // Build a ResourceContext to toggle — represents the whole resource binding
  const contextItem = (): ResourceContext => ({
    resource_name: res().name,
    kind: res().kind,
    item_type: 'resource',
    title: res().displayName,
  });

  const selected = () => isContextItemSelected(contextItem());

  return (
    <button
      class={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${
        selected()
          ? 'bg-accent/8 hover:bg-accent/12'
          : 'hover:bg-surface-hover'
      }`}
      onClick={() => toggleContextItem(contextItem())}
    >
      <span class={`flex-shrink-0 ${
        res().kind === 'gitlab-project' || res().kind === 'gitlab-group' ? 'text-[#E24329]'
        : res().kind === 'github-repo' || res().kind === 'github-org' ? 'text-text'
        : 'text-[#326CE5]'
      }`}>
        <ResourcePickerIcon kind={res().kind} class="w-3.5 h-3.5" />
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-[11px] font-medium text-text truncate">{res().displayName}</p>
        <p class="text-[9px] text-text-muted truncate">{subtitle()}</p>
      </div>
      <Show when={selected()}>
        <span class="w-4 h-4 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
          <svg class="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      </Show>
      <Show when={!selected()}>
        <span class="w-4 h-4 rounded-full border border-border-subtle flex-shrink-0" />
      </Show>
    </button>
  );
}

export default function Composer(props: ComposerProps) {
  const [input, setInput] = createSignal('');
  const [mode, setMode] = createSignal<'prompt' | 'steer'>('prompt');
  let textareaRef: HTMLTextAreaElement | undefined;

  function autoResize() {
    if (!textareaRef) return;
    textareaRef.style.height = 'auto';
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`;
  }

  // Consume a cross-page composer seed (e.g. the GitLab "New Plan" button):
  // drop the draft into the input without sending so the human can edit, then
  // clear the shared signal so it fires once.
  createEffect(() => {
    const seed = composerSeed();
    if (seed == null) return;
    setComposerSeed(null);
    setInput(seed);
    queueMicrotask(() => {
      autoResize();
      textareaRef?.focus();
    });
  });

  async function handleSubmit() {
    const text = input().trim();
    if (!text) return;

    // Capture mode before clearing — steer check needs current state
    const isSteer = mode() === 'steer' && streaming();

    // Clear input immediately — don't wait for the async operation
    setInput('');
    setMode('prompt');
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    if (isSteer) {
      await steerAgent(text);
    } else {
      await sendMessage(text);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }

    // Escape to toggle steer mode when streaming
    if (e.key === 'Escape' && streaming()) {
      if (mode() === 'steer') {
        setMode('prompt');
      } else {
        abortStream();
      }
    }
  }

  function handleStop() {
    abortStream();
  }

  function toggleSteer() {
    setMode((m) => (m === 'steer' ? 'prompt' : 'steer'));
    textareaRef?.focus();
  }

  const agentOnline = () => {
    const agent = selectedAgent();
    if (!agent) return false;
    return getAgentStatus(agent.namespace, agent.name).isOnline;
  };
  const isDisabled = () => !selectedAgent() || (!agentOnline() && !streaming());
  const isProcessing = () => streaming();
  const ctxCount = () => selectedContextCount();

  const placeholder = () => {
    if (!selectedAgent()) return 'Select an agent to start...';
    if (!agentOnline() && !streaming()) return 'Agent unreachable — waiting for pod...';
    if (mode() === 'steer') return 'Steer the agent (guide its next action)...';
    if (isProcessing()) return 'Agent is working... Press Esc to abort';
    return 'Message the agent...';
  };

  return (
    <div class={`px-4 pt-3 pb-4 border-t border-border-subtle/40 ${props.class || ''}`}>
      <div class="max-w-3xl mx-auto">
        {/* Selected resource context chips */}
        <Show when={ctxCount() > 0}>
          <div class="flex flex-wrap items-center gap-1 mb-2 px-1">
            <For each={selectedContextItems()}>
              {(item) => (
                <ContextChip item={item} onRemove={() => removeContextItem(resourceContextKey(item))} />
              )}
            </For>
            <Show when={ctxCount() > 1}>
              <button
                class="text-[10px] text-text-muted hover:text-error transition-colors ml-1"
                onClick={() => clearContextItems()}
              >
                Clear all
              </button>
            </Show>
          </div>
        </Show>

        {/* Composer container — elevated surface with generous radius */}
        <div
          class={`composer-input bg-surface-2 rounded-3xl border border-border-subtle ${
            isProcessing() ? 'composer-processing' : ''
          }`}
        >
          {/* Input row */}
          <div class="flex items-end gap-2 px-4 py-3 overflow-hidden rounded-t-3xl">
            {/* Resource picker button (left side) */}
            <ResourcePicker disabled={isDisabled()} />

            {/* Steer mode indicator */}
            <Show when={streaming()}>
              <button
                class={`flex-shrink-0 self-center p-1.5 rounded-full transition-all duration-200 ${
                  mode() === 'steer'
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
                }`}
                onClick={toggleSteer}
                title={mode() === 'steer' ? 'Switch to normal mode' : 'Switch to steer mode'}
              >
                <LightningBoltIcon class="w-4 h-4" />
              </button>
            </Show>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              class="flex-1 bg-transparent text-sm text-text placeholder-text-muted/60 resize-none outline-none min-h-[24px] max-h-[200px] leading-[24px] py-0.5"
              placeholder={placeholder()}
              value={input()}
              disabled={isDisabled()}
              rows={1}
              onInput={(e) => {
                setInput(e.currentTarget.value);
                autoResize();
              }}
              onKeyDown={handleKeyDown}
            />

            {/* Action buttons */}
            <div class="flex items-center gap-1.5 flex-shrink-0 self-center">
              <Show
                when={streaming()}
                fallback={
                  <Tip content="Send message (Enter)">
                    <button
                      class={`p-2 rounded-full transition-all duration-200 ${
                        input().trim() && !isDisabled()
                          ? 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm hover:shadow-md scale-100 hover:scale-105'
                          : 'bg-surface-hover text-text-muted/40 cursor-not-allowed'
                      }`}
                      disabled={!input().trim() || isDisabled()}
                      onClick={handleSubmit}
                    >
                      <SendIcon class="w-4 h-4" />
                    </button>
                  </Tip>
                }
              >
                {/* During streaming: steer or stop */}
                <Show when={mode() === 'steer' && input().trim()}>
                  <Tip content="Send steer message">
                    <button
                      class="p-2 rounded-full bg-accent text-white hover:bg-accent/90 transition-all duration-200 shadow-sm"
                      onClick={handleSubmit}
                    >
                      <LightningBoltIcon class="w-4 h-4" />
                    </button>
                  </Tip>
                </Show>

                <Tip content="Stop generation (Esc)">
                  <button
                    class="p-2 rounded-full bg-error/10 text-error hover:bg-error/20 transition-all duration-200"
                    onClick={handleStop}
                  >
                    <StopIcon class="w-4 h-4" />
                  </button>
                </Tip>
              </Show>
            </div>
          </div>

          {/* Bottom bar — hints inside the container */}
          <div class="flex items-center justify-between px-5 pb-2.5 pt-0">
            <span class="inline-flex items-center gap-3 text-[11px] text-text-muted/50">
              <Show when={streaming() && mode() !== 'steer'}>
                <kbd class="px-1.5 py-0.5 bg-surface rounded-md text-[10px] text-text-muted/60 border border-border-subtle/50">Esc</kbd>
                <span class="ml-1">to stop</span>
              </Show>
              <Show when={streaming() && mode() === 'steer'}>
                <span class="text-accent/80 font-medium">Steer mode</span>
                <span class="ml-1">— guide the agent's next action</span>
              </Show>
              {/* Context window usage — always visible, card style */}
              <Show when={contextBudget()} fallback={
                <span class="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-2 rounded-lg text-[10px] font-mono text-text-muted/50 border border-border-subtle shadow-sm">
                  <span class="inline-flex items-center w-8 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                    <span class="h-full rounded-full bg-text-muted/20" style={{ width: '0%' }} />
                  </span>
                  0%
                </span>
              }>
                {(budget) => <ContextUsageIndicatorCard budget={budget()} />}
              </Show>
            </span>
            <Show when={selectedAgent()}>
              {(agent) => {
                const status = () => getAgentStatus(agent().namespace, agent().name);
                return (
                  <Show when={status().model}>
                    <button class="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-2 rounded-lg text-[10px] font-mono text-text-muted/70 border border-border-subtle shadow-sm hover:border-border hover:text-text-secondary transition-colors cursor-pointer">
                      {status().model}
                      <svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                  </Show>
                );
              }}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
