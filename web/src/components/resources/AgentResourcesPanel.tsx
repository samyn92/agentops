// AgentResourcesPanel — Agent resources browser.
// Embedded in the right sidebar "Resources" tab.
// Shows all resource types (Git repos, Kubernetes cluster) in a
// single list. Clicking an entry drills into its specific browser view.
// Agent Tools have moved to the right sidebar Tools tab.
import { createSignal, Show, For, createMemo, createResource } from 'solid-js';
import { selectedAgent } from '../../stores/agents';
import { browsableResources, allResources, selectedContextCount, clearContextItems } from '../../stores/resources';
import { kubernetesBrowse } from '../../lib/api';
import { resourceKindIcon } from '../../types/api';
import type { AgentResourceBinding } from '../../types';
import ResourceBrowser from './ResourceBrowser';
import KubernetesBrowser from './KubernetesBrowser';
import Tip from '../shared/Tip';

// ── Types ──

type DrillView =
  | { type: 'list' }
  | { type: 'git'; resource: AgentResourceBinding }
  | { type: 'kubernetes' };

// ── SVG brand icons ──

function GitHubIcon(props: { class?: string }) {
  return (
    <svg class={props.class || 'w-4 h-4'} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

function GitLabIcon(props: { class?: string }) {
  return (
    <svg class={props.class || 'w-4 h-4'} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
    </svg>
  );
}

function KubernetesIcon(props: { class?: string }) {
  return (
    <svg class={props.class || 'w-4 h-4'} viewBox="0 0 722 702" fill="currentColor">
      <path d="M358.986 1.456c-10.627.472-19.969 4.96-28.832 10.08l-248.96 144a68.8 68.8 0 00-25.344 25.504 64.64 64.64 0 00-8.832 34.56v288a64.64 64.64 0 008.832 34.56 68.8 68.8 0 0025.344 25.504l248.96 144c8.64 5.024 17.952 9.312 28.352 10.08a68.8 68.8 0 0036.288-10.08l248.96-144a68.8 68.8 0 0025.344-25.504 64.64 64.64 0 008.832-34.56v-288a64.64 64.64 0 00-8.832-34.56 68.8 68.8 0 00-25.344-25.504l-248.96-144c-9.152-5.344-18.816-9.152-28.768-10.08a78.08 78.08 0 00-7.04 0z"/>
    </svg>
  );
}

// ── Resource entry item for the top-level list ──

interface ResourceEntry {
  id: string;
  label: string;
  subtitle?: string;
  icon: 'github' | 'gitlab' | 'kubernetes';
  color: string;    // tailwind text color or hex
  bgColor: string;  // hover/active bg
  onClick: () => void;
  badge?: string;
  phase?: string;
}

function ResourceEntryRow(props: { entry: ResourceEntry }) {
  const iconEl = () => {
    switch (props.entry.icon) {
      case 'github': return <GitHubIcon class="w-4 h-4" />;
      case 'gitlab': return <GitLabIcon class="w-4 h-4" />;
      case 'kubernetes': return <KubernetesIcon class="w-4 h-4" />;
    }
  };

  return (
    <button
      class={`w-full text-left px-3 py-2.5 hover:bg-surface-hover transition-colors flex items-center gap-3 border-b border-border-subtle group`}
      onClick={props.entry.onClick}
    >
      <span class={`flex-shrink-0 ${props.entry.color}`}>
        {iconEl()}
      </span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-xs text-text font-medium truncate">{props.entry.label}</span>
          <Show when={props.entry.badge}>
            <span class={`text-[9px] font-medium px-1.5 py-0.5 rounded-full leading-none ${props.entry.bgColor}`}>
              {props.entry.badge}
            </span>
          </Show>
          <Show when={props.entry.phase && props.entry.phase !== 'Ready'}>
            <span class={`text-[9px] px-1 py-0.5 rounded ${props.entry.phase === 'Failed' ? 'text-error bg-error/10' : 'text-warning bg-warning/10'}`}>
              {props.entry.phase}
            </span>
          </Show>
        </div>
        <Show when={props.entry.subtitle}>
          <p class="text-[10px] text-text-muted truncate mt-0.5">{props.entry.subtitle}</p>
        </Show>
      </div>
      <svg class="w-3.5 h-3.5 text-text-muted/40 group-hover:text-text-muted transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// ── Sidebar-embedded resources panel ──

export default function AgentResourcesPanel() {
  const [view, setView] = createSignal<DrillView>({ type: 'list' });
  const ctxCount = () => selectedContextCount();

  // Fetch namespaces to show count in the list
  const [nsList] = createResource(
    () => !!selectedAgent(),
    async (hasAgent) => {
      if (!hasAgent) return [];
      try {
        return await kubernetesBrowse.namespaces();
      } catch {
        return [];
      }
    }
  );

  // Build entries list
  const gitResources = createMemo(() => browsableResources());

  const entries = createMemo<ResourceEntry[]>(() => {
    const result: ResourceEntry[] = [];

    // Git repos (github-repo, gitlab-project)
    for (const res of gitResources()) {
      const iconType = resourceKindIcon(res.kind);
      result.push({
        id: `git:${res.name}`,
        label: res.displayName,
        subtitle: res.kind === 'github-repo'
          ? res.github ? `${res.github.owner}/${res.github.repo}` : res.kind
          : res.gitlab ? res.gitlab.project : res.kind,
        icon: iconType === 'gitlab' ? 'gitlab' : 'github',
        color: iconType === 'gitlab' ? 'text-[#E24329]' : 'text-text',
        bgColor: iconType === 'gitlab' ? 'bg-[#E24329]/10 text-[#E24329]' : 'bg-accent/10 text-accent',
        phase: res.phase,
        onClick: () => setView({ type: 'git', resource: res }),
      });
    }

    // Kubernetes cluster (always present — it's the cluster itself)
    const nsCount = (nsList() || []).length;
    result.push({
      id: 'kubernetes',
      label: 'Kubernetes Cluster',
      subtitle: nsCount > 0 ? `${nsCount} namespaces` : 'Browse cluster resources',
      icon: 'kubernetes',
      color: 'text-[#326CE5]',
      bgColor: 'bg-[#326CE5]/10 text-[#326CE5]',
      badge: nsCount > 0 ? `${nsCount} ns` : undefined,
      onClick: () => setView({ type: 'kubernetes' }),
    });

    return result;
  });

  // Header title based on current view
  const headerTitle = () => {
    const v = view();
    switch (v.type) {
      case 'list': return null;
      case 'git': return v.resource.displayName;
      case 'kubernetes': return 'Kubernetes';
    }
  };

  const headerIcon = () => {
    const v = view();
    switch (v.type) {
      case 'list': return null;
      case 'git': {
        const iconType = resourceKindIcon(v.resource.kind);
        return iconType === 'gitlab'
          ? <GitLabIcon class="w-3.5 h-3.5 text-[#E24329]" />
          : <GitHubIcon class="w-3.5 h-3.5 text-text" />;
      }
      case 'kubernetes':
        return <KubernetesIcon class="w-3.5 h-3.5 text-[#326CE5]" />;
    }
  };

  return (
    <div class="h-full flex flex-col overflow-hidden">
      {/* Drill-in sub-header (only when not on the list view) */}
      <Show when={view().type !== 'list'}>
        <div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-2/80 flex-shrink-0">
          <Tip content="Back to resources">
            <button
              class="p-0.5 text-text-muted hover:text-text rounded transition-colors"
              onClick={() => setView({ type: 'list' })}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </Tip>
          {headerIcon()}
          <span class="text-xs font-semibold text-text uppercase tracking-wide">{headerTitle()}</span>
          <Show when={ctxCount() > 0}>
            <span class="text-[10px] font-medium bg-accent text-white px-1.5 py-0.5 rounded-full leading-none">
              {ctxCount()}
            </span>
            <Tip content="Clear all selections">
              <button
                class="text-[10px] text-text-muted hover:text-error transition-colors ml-auto"
                onClick={() => clearContextItems()}
              >
                Clear
              </button>
            </Tip>
          </Show>
        </div>
      </Show>

      {/* Content area */}
      <div class="flex-1 min-h-0 overflow-hidden">
        {/* List view */}
        <Show when={view().type === 'list'}>
          <div class="h-full overflow-y-auto">
            <Show when={entries().length === 0}>
              <div class="flex flex-col items-center justify-center py-12 px-4">
                <svg class="w-10 h-10 text-text-muted/30 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p class="text-xs text-text-muted text-center">No resources available for this agent.</p>
              </div>
            </Show>
            <For each={entries()}>
              {(entry) => <ResourceEntryRow entry={entry} />}
            </For>
          </div>
        </Show>

        {/* Git resource drill-in: embed ResourceBrowser in inline mode */}
        <Show when={view().type === 'git'}>
          <ResourceBrowserInline
            resource={(view() as { type: 'git'; resource: AgentResourceBinding }).resource}
          />
        </Show>

        {/* Kubernetes drill-in: embed KubernetesBrowser in inline mode */}
        <Show when={view().type === 'kubernetes'}>
          <KubernetesBrowserInline />
        </Show>
      </div>
    </div>
  );
}

// ── Inline wrappers ──
// Render existing browser components in "embedded" mode inside the panel's
// content area. Embedded mode strips the backdrop, header, and popover chrome.

function ResourceBrowserInline(props: { resource: AgentResourceBinding }) {
  return (
    <div class="h-full relative">
      <ResourceBrowser
        open={true}
        onClose={() => {}}
        class="!absolute !inset-0 !mb-0 !w-full !h-full !rounded-none !border-0 !shadow-none"
        initialResource={props.resource}
        embedded={true}
      />
    </div>
  );
}

function KubernetesBrowserInline() {
  return (
    <div class="h-full relative">
      <KubernetesBrowser
        open={true}
        onClose={() => {}}
        class="!absolute !inset-0 !mb-0 !w-full !h-full !rounded-none !border-0 !shadow-none"
        embedded={true}
      />
    </div>
  );
}
