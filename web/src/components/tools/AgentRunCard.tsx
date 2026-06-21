// AgentRunCard — run_agent / get_agent_run results (sub-agent tracking)
// Embeds the same run card used in the right-panel runs list directly
// inside the tool call, providing a consistent clickable card experience.
import { Show, createMemo, createEffect } from 'solid-js';
import Badge from '../shared/Badge';
import { selectRun, allRuns, refreshRuns, getRunSource, type RunSource } from '../../stores/runs';
import { selectAgent } from '../../stores/agents';
import { showRunDetail } from '../../stores/view';
import { getResourceForge, getResourceRepoName } from '../../stores/resources';
import { relativeTime } from '../../lib/format';
import RunPhaseIcon from '../shared/RunPhaseIcon';
import RunOutcome from '../shared/RunOutcome';
import type { ToolMetadata, AgentRunResponse } from '../../types';

interface AgentRunCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  headerless?: boolean;
}

function phaseVariant(phase: string | undefined): 'success' | 'warning' | 'error' | 'info' | 'muted' {
  switch (phase) {
    case 'Completed': case 'Succeeded': return 'success';
    case 'Running': case 'Pending': case 'Queued': return 'warning';
    case 'Failed': case 'Error': return 'error';
    default: return 'muted';
  }
}

function openRun(run: AgentRunResponse) {
  selectAgent(run.metadata.namespace, run.spec.agentRef);
  selectRun(run.metadata.namespace, run.metadata.name);
  showRunDetail();
}

// ── Sub-components (matching RunsPanelContent exactly) ──

function ForgeIcon(props: { forge: 'github' | 'gitlab' | 'git' }) {
  return (
    <span class="flex-shrink-0 w-5 h-5 flex items-center justify-center">
      <Show when={props.forge === 'github'}>
        <svg class="w-[18px] h-[18px] text-text-secondary" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
        </svg>
      </Show>
      <Show when={props.forge === 'gitlab'}>
        <svg class="w-[18px] h-[18px] text-[#FC6D26]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
        </svg>
      </Show>
      <Show when={props.forge === 'git'}>
        <svg class="w-[18px] h-[18px] text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3H9m-3 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
        </svg>
      </Show>
    </span>
  );
}

function ForgeWatermark(props: { forge: 'github' | 'gitlab' | 'git' }) {
  return (
    <div class={`run-card__watermark run-card__watermark--${props.forge}`}>
      <Show when={props.forge === 'github'}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
        </svg>
      </Show>
      <Show when={props.forge === 'gitlab'}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
        </svg>
      </Show>
      <Show when={props.forge === 'git'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3H9m-3 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
        </svg>
      </Show>
    </div>
  );
}

function SourceIcon(props: { source: RunSource }) {
  return (
    <span class="flex-shrink-0 w-4 h-4 flex items-center justify-center">
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
      <Show when={props.source === 'unknown' || props.source === 'console'}>
        <svg class="w-3 h-3 text-text-muted/50" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
        </svg>
      </Show>
    </span>
  );
}

export default function AgentRunCard(props: AgentRunCardProps) {
  const agentName = () => {
    if (props.metadata?.agent) return props.metadata.agent as string;
    try {
      const parsed = JSON.parse(props.input);
      return parsed.agent || parsed.agentRef || '';
    } catch { return ''; }
  };

  const runNameFromMeta = () => (props.metadata?.runName || props.metadata?.name || '') as string;
  const namespace = () => (props.metadata?.namespace || 'agents') as string;
  const phase = () => (props.metadata?.phase || '') as string;
  const isStatusCard = () => props.metadata?.ui === 'agent-run-status';

  // Look up the actual AgentRun from the runs store for full data
  const resolvedRun = createMemo<AgentRunResponse | undefined>(() => {
    const name = runNameFromMeta();
    if (!name) return undefined;
    return (allRuns() ?? []).find(
      (r) => r.metadata.name === name && r.metadata.namespace === namespace(),
    );
  });

  // Derive run card data — prefer resolved run, fall back to metadata
  const run = createMemo(() => {
    const r = resolvedRun();
    if (r) return r;
    return undefined;
  });

  const hasRun = () => !!run();

  // If we have a run name but it's not in the store yet, trigger a refresh
  createEffect(() => {
    if (runNameFromMeta() && !run()) {
      refreshRuns();
    }
  });

  // Forge & repo info from resolved run
  const forge = createMemo(() => {
    const r = run();
    if (!r?.spec.git?.resourceRef) return null;
    return getResourceForge(r.spec.git.resourceRef);
  });
  const repoName = createMemo(() => {
    const r = run();
    if (!r?.spec.git?.resourceRef) return null;
    return getResourceRepoName(r.spec.git.resourceRef);
  });
  const hasGit = createMemo(() => {
    const r = run();
    return !!r?.spec.git;
  });
  const hasOutcome = createMemo(() => {
    const r = run();
    return !!(r?.status?.outcome || r?.spec.outcome?.intent);
  });
  const source = createMemo(() => {
    const r = run();
    return r ? getRunSource(r) : ('agent' as RunSource);
  });
  const isRunning = () => run()?.status?.phase === 'Running';
  const isFailed = () => run()?.status?.phase === 'Failed';

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    const r = run();
    if (r) openRun(r);
  };

  // ── Embedded run card (mirrors RunsPanelContent layout) ──
  const EmbeddedRunCard = () => {
    const r = run()!;
    const cardClass = () => {
      const classes = ['run-card'];
      if (isRunning()) classes.push('run-card--running');
      if (isFailed()) classes.push('run-card--failed');
      return classes.join(' ');
    };

    return (
      <button class={`w-full text-left ${cardClass()}`} onClick={handleClick}>
        {/* Forge watermark */}
        <Show when={forge()}>
          <ForgeWatermark forge={forge()!} />
        </Show>

        {/* Row 1: Source/forge icon + run name + phase icon */}
        <div class="flex items-center gap-1.5">
          <Show
            when={hasGit() && forge()}
            fallback={<SourceIcon source={source()} />}
          >
            <ForgeIcon forge={forge()!} />
          </Show>
          <span class="run-card__title truncate flex-1">{r.metadata.name}</span>
          <RunPhaseIcon phase={r.status?.phase} />
        </div>

        {/* Row 2: Outcome chips */}
        <Show when={hasOutcome()}>
          <div class="mt-1.5" onClick={(e) => e.stopPropagation()}>
            <RunOutcome
              outcome={r.status?.outcome}
              intentHint={r.spec.outcome?.intent}
              variant="compact"
              showSummary={false}
            />
          </div>
        </Show>

        {/* Row 3: time */}
        <div class="run-card__meta">
          <span class="run-card__time ml-auto">{relativeTime(r.metadata.creationTimestamp)}</span>
        </div>

        {/* Row 4: Prompt preview */}
        <Show when={r.spec.prompt}>
          <p class="run-card__prompt">{r.spec.prompt}</p>
        </Show>
      </button>
    );
  };

  // ── Fallback card when run is not yet in the store ──
  const FallbackCard = () => {
    // Parse git info from input params for the fallback
    const gitBranch = () => {
      try { return JSON.parse(props.input).git_branch || ''; } catch { return ''; }
    };
    const gitResource = () => {
      try { return JSON.parse(props.input).git_resource || ''; } catch { return ''; }
    };
    const fallbackForge = () => getResourceForge(gitResource()) || null;
    const fallbackRepo = () => getResourceRepoName(gitResource()) || gitResource();

    return (
      <div class="px-3 py-2.5 space-y-1.5">
        <Show when={gitBranch()}>
          <div class="flex items-center gap-1.5">
            <Show when={fallbackForge()}>
              <ForgeIcon forge={fallbackForge()!} />
            </Show>
            <span class={`run-card__branch-tag ${
              fallbackForge() === 'gitlab' ? 'run-card__branch-tag--gitlab' :
              fallbackForge() === 'github' ? 'run-card__branch-tag--github' : ''
            }`}>
              <svg class="run-card__branch-tag-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3H9m-3 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
              </svg>
              <span class="run-card__branch-tag-text">
                <Show when={fallbackRepo()}>
                  <span class="run-card__branch-tag-repo">{fallbackRepo()}</span>
                </Show>
                <span class="run-card__branch-tag-branch">{gitBranch()}</span>
              </span>
            </span>
          </div>
        </Show>
        <Show when={runNameFromMeta()}>
          <div class="run-card__meta">
            <span class="truncate">{runNameFromMeta()}</span>
          </div>
        </Show>
      </div>
    );
  };

  const Body = () => (
    <div class="p-1">
      <Show when={hasRun()} fallback={<FallbackCard />}>
        <EmbeddedRunCard />
      </Show>
    </div>
  );

  if (props.headerless) {
    return <div class={props.class || ''}><Body /></div>;
  }

  return (
    <div class={`border border-indigo-400/20 rounded-lg overflow-hidden my-1 bg-gradient-to-br from-indigo-500/5 via-purple-500/3 to-transparent ${props.class || ''}`}>
      <div class="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-indigo-500/10 via-purple-500/6 to-transparent border-b border-indigo-500/10">
        <span class="text-xs font-semibold bg-gradient-to-r from-indigo-300 to-purple-300 bg-clip-text text-transparent">
          {isStatusCard() ? 'Run Status' : 'Run Agent'}
        </span>
        <Show when={agentName()}>
          <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 font-mono">
            {agentName()}
          </span>
        </Show>
        <div class="flex items-center gap-1.5 ml-auto">
          <Show when={phase()}>
            <Badge variant={phaseVariant(phase())}>{phase()}</Badge>
          </Show>
          <Show when={!phase()}>
            <Badge variant={props.isError ? 'error' : 'success'}>
              {props.isError ? 'Error' : 'Created'}
            </Badge>
          </Show>
        </div>
      </div>
      <Body />
    </div>
  );
}
