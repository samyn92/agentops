// AgentPanel — unified Agent tab for daemon (orchestrator) agents.
// Single scrollable page: live runtime stats, memory, configuration, tools,
// resources, system prompt. Delegation/ops data lives exclusively in the Ops tab.
// Does NOT show platformProtocol.
import { Show, For, createSignal, createMemo, createResource } from 'solid-js';
import { selectedAgent, getAgentStatus, getAgentRuntimeStatus } from '../../stores/agents';
import { agents as agentsAPI, agentResources as resourcesAPI } from '../../lib/api';
import {
  memoryEnabled,
  observations,
  observationsLoading,
  memoryStats,
  setSearchQuery,
  searchResults,
  searchLoading,
  searchMemory,
} from '../../stores/memory';
import { relativeTime, formatDateTime } from '../../lib/format';
import Spinner from '../shared/Spinner';
import Markdown from '../shared/Markdown';
import { BrainIcon, SearchIcon, CloseIcon } from '../shared/Icons';
import type { AgentCRD, AgentResourceBinding, AgentResourceRef, RuntimeStatus } from '../../types';

// ── Main Component ──

export default function AgentPanel() {
  const agent = () => selectedAgent();

  const [crd] = createResource(
    () => agent() ? { ns: agent()!.namespace, name: agent()!.name } : null,
    async (params) => {
      if (!params) return null;
      try { return await agentsAPI.get(params.ns, params.name) as AgentCRD; }
      catch { return null; }
    },
  );

  const [resources] = createResource(
    () => agent() ? { ns: agent()!.namespace, name: agent()!.name } : null,
    async (params) => {
      if (!params) return [];
      try { return await resourcesAPI.forAgent(params.ns, params.name); }
      catch { return []; }
    },
  );

  const spec = () => crd()?.spec;
  const runtimeStatus = () => {
    const a = agent();
    if (!a) return null;
    return getAgentRuntimeStatus(a.namespace, a.name);
  };
  const agentStatus = () => {
    const a = agent();
    if (!a) return { phase: '', isOnline: false, model: '', image: '' };
    return getAgentStatus(a.namespace, a.name);
  };
  const hasMemory = () => memoryEnabled();

  return (
    <div class="h-full overflow-y-auto">
      <Show when={crd.loading}>
        <div class="flex items-center justify-center py-12">
          <Spinner size="md" />
        </div>
      </Show>

      <Show when={crd()}>
        {(data) => (
          <div class="px-6 py-5 space-y-6">

            {/* ═══════════════════════════════════════════════════
                1. HERO HEADER — live runtime stats + context budget
                ═══════════════════════════════════════════════════ */}
            <HeroHeader
              runtimeStatus={runtimeStatus()}
              status={agentStatus()}
              spec={spec()!}
              crd={data()}
            />

            {/* ═══════════════════════════════════════════════════
                2. SYSTEM PROMPT — collapsible markdown
                ═══════════════════════════════════════════════════ */}
            <Show when={spec()?.systemPrompt}>
              <SystemPromptSection prompt={spec()!.systemPrompt!} />
            </Show>

            {/* ═══════════════════════════════════════════════════
                3. RESOURCES — bindings with badges
                ═══════════════════════════════════════════════════ */}
            <Show when={spec()?.resourceBindings?.length}>
              <ResourceBindingsSection bindings={spec()!.resourceBindings!} resources={resources() ?? []} />
            </Show>

            {/* ═══════════════════════════════════════════════════
                4. TOOLS — builtin + OCI with badges
                ═══════════════════════════════════════════════════ */}
            <Show when={(spec()?.builtinTools?.length || 0) + (spec()?.tools?.length || 0) > 0}>
              <ToolsSection spec={spec()!} />
            </Show>

            {/* ═══════════════════════════════════════════════════
                5. MEMORY — stats strip + recent observations + search
                ═══════════════════════════════════════════════════ */}
            <Show when={hasMemory()}>
              <MemorySection spec={spec()!} />
            </Show>

            {/* ═══════════════════════════════════════════════════
                6. CONFIGURATION — model, image, maxSteps, timeout, etc.
                ═══════════════════════════════════════════════════ */}
            <ConfigurationSection spec={spec()!} />

            {/* ═══════════════════════════════════════════════════
                7. FOOTER — namespace, created date
                ═══════════════════════════════════════════════════ */}
            <div class="pt-4 border-t border-border-subtle flex items-center gap-3 text-[11px] text-text-muted">
              <span>Created {formatDateTime(data().metadata.creationTimestamp)}</span>
              <span class="text-text-muted/40">|</span>
              <span class="font-mono">{data().metadata.namespace}/{data().metadata.name}</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SECTION 1: Hero Header
// ═══════════════════════════════════════════════════

function HeroHeader(props: {
  runtimeStatus: RuntimeStatus | null;
  status: { phase: string; isOnline: boolean; model: string; image: string };
  spec: import('../../types').AgentSpec;
  crd: AgentCRD;
}) {
  const rs = () => props.runtimeStatus;

  return (
    <div class="space-y-3">
      {/* Live runtime stat cards */}
      <Show when={rs()}>
        <div class="grid grid-cols-4 gap-2">
          <StatCard
            label="Status"
            value={rs()!.busy ? 'Busy' : 'Idle'}
            variant={rs()!.busy ? 'accent' : undefined}
            pulse={rs()!.busy}
          />
          <StatCard label="Messages" value={String(rs()!.messages ?? 0)} />
          <StatCard label="Turns" value={String(rs()!.turns ?? 0)} />
          <StatCard label="Steps" value={String(rs()!.steps ?? 0)} />
        </div>
      </Show>
    </div>
  );
}

function StatCard(props: { value: string; label: string; variant?: 'accent' | 'success' | 'error'; pulse?: boolean }) {
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
      <div class={`text-lg font-mono font-semibold tabular-nums relative ${color()}`}>{props.value}</div>
      <div class="text-[10px] text-text-muted uppercase tracking-wider relative">{props.label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SECTION 2: Memory (inline summary)
// ═══════════════════════════════════════════════════

function MemorySection(props: { spec: import('../../types').AgentSpec }) {
  const stats = () => memoryStats();
  const obs = () => observations();
  const loading = () => observationsLoading();
  const [localQuery, setLocalQuery] = createSignal('');
  let debounceTimer: number | undefined;
  const mem = () => props.spec.memory;

  const isSearching = () => localQuery().trim().length > 0;

  function handleSearchInput(e: InputEvent) {
    const val = (e.target as HTMLInputElement).value;
    setLocalQuery(val);
    clearTimeout(debounceTimer);
    if (val.trim().length >= 2) {
      debounceTimer = window.setTimeout(() => searchMemory(val), 300);
    }
  }

  function handleSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimer);
      const val = localQuery();
      if (val.trim()) searchMemory(val);
    }
    if (e.key === 'Escape') {
      setLocalQuery('');
      setSearchQuery('');
    }
  }

  // Observation type metadata
  const TYPE_COLORS: Record<string, string> = {
    decision: 'bg-accent', bugfix: 'bg-error', discovery: 'bg-accent',
    pattern: 'bg-success', architecture: 'bg-info', config: 'bg-warning',
    learning: 'bg-success', preference: 'bg-text-muted/40',
  };

  return (
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Memory</h3>
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-info/8 border border-info/12 text-info">
          <BrainIcon class="w-2.5 h-2.5" />
          enabled
        </span>
      </div>

      {/* Stats strip */}
      <Show when={stats()}>
        <div class="flex items-center gap-4 text-[11px] text-text-muted">
          <span><span class="font-mono text-text-secondary">{stats()!.total_observations}</span> memories</span>
          <span><span class="font-mono text-text-secondary">{stats()!.total_sessions}</span> sessions</span>
        </div>
      </Show>

      {/* Memory config: auto-* badges + context limit */}
      <Show when={mem()}>
        <div class="flex flex-wrap items-center gap-1.5">
          {[
            { label: 'Auto-summarize', enabled: mem()!.autoSummarize !== false },
            { label: 'Auto-save', enabled: mem()!.autoSave !== false },
            { label: 'Auto-search', enabled: mem()!.autoSearch !== false },
          ].map((feat) => (
            <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
              feat.enabled ? 'bg-success/6 border-success/10 text-success' : 'bg-surface-3 border-border-subtle text-text-muted'
            }`}>
              <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {feat.enabled
                  ? <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                  : <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                }
              </svg>
              {feat.label}
            </span>
          ))}
          <Show when={mem()!.contextLimit !== undefined}>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-surface-3 border border-border-subtle text-text-muted"
              title="Number of recent context entries injected per turn"
            >
              contextLimit: <span class="font-mono text-text-secondary">{mem()!.contextLimit}</span>
            </span>
          </Show>
        </div>
      </Show>

      {/* Inline search */}
      <div class="flex items-center gap-2 px-2.5 py-1.5 bg-surface-2 rounded-lg border border-border-subtle focus-within:border-border-hover transition-colors">
        <SearchIcon class="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <input
          type="text"
          class="flex-1 bg-transparent text-xs text-text placeholder:text-text-muted outline-none"
          placeholder="Search memories..."
          value={localQuery()}
          onInput={handleSearchInput}
          onKeyDown={handleSearchKeyDown}
        />
        <Show when={searchLoading()}>
          <Spinner size="sm" />
        </Show>
        <Show when={isSearching() && !searchLoading()}>
          <button
            class="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
            onClick={() => { setLocalQuery(''); setSearchQuery(''); }}
          >
            <CloseIcon class="w-3 h-3" />
          </button>
        </Show>
      </div>

      {/* Search results */}
      <Show when={isSearching() && searchResults().length > 0}>
        <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
          <For each={searchResults().slice(0, 5)}>
            {(result) => (
              <div class="px-3 py-2">
                <div class="flex items-center gap-1.5 mb-0.5">
                  <span class={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_COLORS[result.type] || 'bg-text-muted/40'}`} />
                  <span class="text-xs font-medium text-text truncate flex-1">{result.title}</span>
                  <span class="text-[10px] text-text-muted/50 flex-shrink-0">#{Math.abs(result.rank).toFixed(1)}</span>
                </div>
                <p class="text-[11px] text-text-secondary/70 line-clamp-1">{result.content.slice(0, 120)}</p>
              </div>
            )}
          </For>
          <Show when={searchResults().length > 5}>
            <div class="px-3 py-1.5 text-[10px] text-text-muted text-center">
              +{searchResults().length - 5} more results
            </div>
          </Show>
        </div>
      </Show>

      {/* Recent observations (when not searching) */}
      <Show when={!isSearching() && obs().length > 0}>
        <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
          <For each={obs().slice(0, 5)}>
            {(ob) => (
              <div class="px-3 py-2">
                <div class="flex items-center gap-1.5 mb-0.5">
                  <span class={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_COLORS[ob.type] || 'bg-text-muted/40'}`} />
                  <span class="text-xs font-medium text-text truncate flex-1">{ob.title}</span>
                  <span class="text-[10px] text-text-muted flex-shrink-0">{relativeTime(ob.created_at)}</span>
                </div>
                <p class="text-[11px] text-text-secondary/70 line-clamp-1">{ob.content.slice(0, 120)}</p>
              </div>
            )}
          </For>
          <Show when={obs().length > 5}>
            <div class="px-3 py-1.5 text-[10px] text-text-muted text-center">
              +{obs().length - 5} older memories
            </div>
          </Show>
        </div>
      </Show>

      <Show when={!isSearching() && !loading() && obs().length === 0}>
        <div class="text-[11px] text-text-muted/60 py-2">No memories yet.</div>
      </Show>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SECTION 5: Configuration
// ═══════════════════════════════════════════════════

function ConfigurationSection(props: { spec: import('../../types').AgentSpec }) {
  const spec = () => props.spec;

  return (
    <div class="space-y-2">
      <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Configuration</h3>
      <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
        <Show when={spec().model}>
          <ConfigRow label="Model" value={spec().model} mono />
        </Show>
        <Show when={spec().image}>
          <ConfigRow label="Image" value={spec().image!} mono />
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

      {/* Concurrency */}
      <Show when={spec().concurrency}>
        <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
          <Show when={spec().concurrency!.maxRuns}>
            <ConfigRow label="Max Concurrent Runs" value={String(spec().concurrency!.maxRuns)} />
          </Show>
          <Show when={spec().concurrency!.policy}>
            <ConfigRow label="Concurrency Policy">
              <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-accent/8 border border-accent/12 text-accent">
                {spec().concurrency!.policy}
              </span>
            </ConfigRow>
          </Show>
        </div>
      </Show>

      {/* Providers */}
      <Show when={spec().providers?.length}>
        <div class="flex flex-wrap gap-1.5 mt-2">
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
      </Show>

      {/* Environment */}
      <Show when={spec().env && Object.keys(spec().env!).length > 0}>
        <div class="space-y-1.5 mt-2">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-medium text-text-muted uppercase tracking-wider">Environment</span>
            <span class="text-[10px] text-text-muted font-mono">{Object.keys(spec().env!).length} vars</span>
          </div>
          <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle">
            <For each={Object.entries(spec().env!)}>
              {([key, value]) => (
                <div class="flex items-center justify-between gap-4 px-3.5 py-2 min-h-[32px]">
                  <span class="text-[11px] font-mono text-text-muted flex-shrink-0">{key}</span>
                  <span class="text-[11px] font-mono text-text text-right truncate max-w-[200px]">{value}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Storage & Infrastructure */}
      <Show when={spec().storage || spec().resources}>
        <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden divide-y divide-border-subtle mt-2">
          <Show when={spec().storage}>
            <ConfigRow label="Storage" value={spec().storage!.size} mono />
            <Show when={spec().storage!.storageClass}>
              <ConfigRow label="Storage Class" value={spec().storage!.storageClass!} mono />
            </Show>
          </Show>
          <Show when={spec().resources?.requests}>
            <ConfigRow label="CPU Request" value={spec().resources!.requests!.cpu || '\u2014'} mono />
            <ConfigRow label="Memory Request" value={spec().resources!.requests!.memory || '\u2014'} mono />
          </Show>
          <Show when={spec().resources?.limits}>
            <ConfigRow label="CPU Limit" value={spec().resources!.limits!.cpu || '\u2014'} mono />
            <ConfigRow label="Memory Limit" value={spec().resources!.limits!.memory || '\u2014'} mono />
          </Show>
        </div>
      </Show>

      {/* Schedule */}
      <Show when={spec().schedule}>
        <div class="rounded-xl bg-surface-2 border border-border-subtle p-3.5 mt-2">
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
      </Show>
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

// ═══════════════════════════════════════════════════
// SECTION 6: Tools
// ═══════════════════════════════════════════════════

function ToolsSection(props: { spec: import('../../types').AgentSpec }) {
  const builtinCount = () => props.spec.builtinTools?.length || 0;
  const ociCount = () => props.spec.tools?.length || 0;

  return (
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Tools</h3>
        <span class="text-[10px] text-text-muted font-mono">{builtinCount() + ociCount()}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <For each={props.spec.builtinTools ?? []}>
          {(tool) => (
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono bg-surface-3 border border-border-subtle text-text-secondary">
              <svg class="w-2.5 h-2.5 text-text-muted/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.42 15.17l-5.29-5.29a4 4 0 115.66-5.66l.1.1a1.65 1.65 0 002.34 0l.1-.1a4 4 0 015.66 5.66l-5.29 5.29a2 2 0 01-2.83 0z" />
              </svg>
              {tool}
            </span>
          )}
        </For>
        <For each={props.spec.tools ?? []}>
          {(tool) => (
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono bg-info/8 border border-info/15 text-info">
              <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              {tool.name}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SECTION 7: Resource Bindings
// ═══════════════════════════════════════════════════

function ResourceBindingsSection(props: { bindings: AgentResourceRef[]; resources: AgentResourceBinding[] }) {
  return (
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Resources</h3>
        <span class="text-[10px] text-text-muted font-mono">{props.bindings.length}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <For each={props.bindings}>
          {(binding) => {
            const detail = props.resources.find(r => r.name === binding.name);
            return (
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-surface-2 border border-border-subtle text-text-secondary">
                <svg class="w-3 h-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                {binding.name}
                <Show when={binding.readOnly}>
                  <span class="text-[9px] text-warning/70">RO</span>
                </Show>
                <Show when={binding.autoContext}>
                  <span class="text-[9px] text-info/70">auto</span>
                </Show>
                <Show when={detail?.kind}>
                  <span class="text-[9px] text-text-muted/50">{detail!.kind}</span>
                </Show>
              </span>
            );
          }}
        </For>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SECTION 8: System Prompt
// ═══════════════════════════════════════════════════

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
