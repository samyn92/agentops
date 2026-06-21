// ResourceBrowser — overlay panel for browsing GitHub/GitLab resources bound to the agent.
// Renders in the composer area as a popover with tabbed navigation.
// Supports checkbox selection of items for per-turn resource context injection.
import { createSignal, createResource, Show, For, Switch, Match, createMemo } from 'solid-js';
import { agentResources } from '../../lib/api';
import { selectedAgent } from '../../stores/agents';
import { browsableResources, toggleContextItem, isContextItemSelected, selectedContextCount, clearContextItems } from '../../stores/resources';
import type { AgentResourceBinding, GitFile, GitCommit, GitBranch, GitMergeRequest, GitIssue, GitPipeline, ResourceContext } from '../../types';
import { isBrowsableResource, resourceKindIcon } from '../../types/api';
import Badge from '../shared/Badge';
import Tip from '../shared/Tip';
import Spinner from '../shared/Spinner';
import { relativeTime } from '../../lib/format';

// ── Tab types ──

type BrowserTab = 'files' | 'commits' | 'mergerequests' | 'issues' | 'branches' | 'pipelines';

const TABS: { id: BrowserTab; label: string; icon: string }[] = [
  { id: 'files', label: 'Files', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
  { id: 'commits', label: 'Commits', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'mergerequests', label: 'MRs', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  { id: 'issues', label: 'Issues', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z' },
  { id: 'branches', label: 'Branches', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
  { id: 'pipelines', label: 'CI', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
];

// Pipelines are GitLab-only. Filter the tab list to what the resource supports.
function visibleTabs(kind: string): { id: BrowserTab; label: string; icon: string }[] {
  const isGitLab = kind.startsWith('gitlab');
  return TABS.filter((t) => (t.id === 'pipelines' ? isGitLab : true));
}

// ── SVG Icons ──

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

// ── Selection checkbox ──

function SelectionCheckbox(props: { checked: boolean; onChange: () => void; class?: string }) {
  return (
    <button
      class={`flex-shrink-0 w-3.5 h-3.5 rounded border transition-all ${
        props.checked
          ? 'bg-accent border-accent text-white'
          : 'border-border-subtle hover:border-accent/50 bg-transparent'
      } ${props.class || ''}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        props.onChange();
      }}
    >
      <Show when={props.checked}>
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
        </svg>
      </Show>
    </button>
  );
}

// ── Resource selector chip ──

function ResourceChip(props: {
  resource: AgentResourceBinding;
  selected: boolean;
  onClick: () => void;
}) {
  const icon = () => resourceKindIcon(props.resource.kind);

  return (
    <button
      class={`resource-chip flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
        props.selected
          ? 'bg-accent/15 border-accent/40 text-accent shadow-sm'
          : 'bg-surface border-border-subtle text-text-secondary hover:border-border-hover hover:bg-surface-hover'
      }`}
      onClick={props.onClick}
      title={props.resource.description || props.resource.displayName}
    >
      <Show when={icon() === 'github'}>
        <GitHubIcon class="w-3.5 h-3.5" />
      </Show>
      <Show when={icon() === 'gitlab'}>
        <GitLabIcon class="w-3.5 h-3.5" />
      </Show>
      <span class="truncate max-w-[120px]">{props.resource.displayName}</span>
      <Show when={props.resource.phase !== 'Ready'}>
        <Badge variant={props.resource.phase === 'Failed' ? 'error' : 'warning'}>
          {props.resource.phase}
        </Badge>
      </Show>
    </button>
  );
}

// ── File browser sub-view ──

function FileBrowser(props: { resource: AgentResourceBinding; gitRef?: string }) {
  const [currentPath, setCurrentPath] = createSignal('');
  const agent = () => selectedAgent()!;

  const [files] = createResource(
    () => ({ path: currentPath(), ref: props.gitRef }),
    async ({ path, ref }) => {
      return agentResources.files(agent().namespace, agent().name, props.resource.name, path, ref);
    }
  );

  const pathParts = createMemo(() => {
    const p = currentPath();
    if (!p) return [];
    return p.split('/').filter(Boolean);
  });

  function navigateToDir(path: string) {
    setCurrentPath(path);
  }

  function navigateUp() {
    const parts = pathParts();
    if (parts.length <= 1) {
      setCurrentPath('');
    } else {
      setCurrentPath(parts.slice(0, -1).join('/'));
    }
  }

  // Normalize: GitHub uses "dir"/"file", GitLab uses "tree"/"blob"
  function isDir(f: GitFile): boolean {
    return f.type === 'dir' || f.type === 'tree';
  }

  // Sort: dirs first, then files, alphabetical
  const sortedFiles = createMemo(() => {
    const list = files() || [];
    return [...list].sort((a, b) => {
      const aDir = isDir(a) ? 0 : 1;
      const bDir = isDir(b) ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });
  });

  function makeFileContext(file: GitFile): ResourceContext {
    return {
      resource_name: props.resource.name,
      kind: props.resource.kind,
      item_type: isDir(file) ? 'directory' : 'file',
      path: file.path,
      ref: props.gitRef,
    };
  }

  return (
    <div class="flex flex-col h-full">
      {/* Breadcrumb */}
      <div class="flex items-center gap-1 px-3 py-1.5 text-[11px] text-text-muted border-b border-border-subtle bg-surface-2/50">
        <button
          class="hover:text-accent transition-colors font-medium"
          onClick={() => setCurrentPath('')}
        >
          /
        </button>
        <For each={pathParts()}>
          {(part, i) => (
            <>
              <span class="text-text-muted/40">/</span>
              <button
                class="hover:text-accent transition-colors"
                onClick={() => setCurrentPath(pathParts().slice(0, i() + 1).join('/'))}
              >
                {part}
              </button>
            </>
          )}
        </For>
      </div>

      {/* File list */}
      <div class="flex-1 overflow-y-auto">
        <Show when={files.loading}>
          <div class="flex items-center justify-center py-8">
            <Spinner size="sm" />
          </div>
        </Show>

        <Show when={!files.loading}>
          {/* Go up */}
          <Show when={currentPath()}>
            <button
              class="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors flex items-center gap-2 text-text-muted"
              onClick={navigateUp}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
              </svg>
              ..
            </button>
          </Show>

          <For each={sortedFiles()}>
            {(file) => {
              const ctx = () => makeFileContext(file);
              const checked = () => isContextItemSelected(ctx());

              return (
                <div
                  class={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors flex items-center gap-2 group cursor-pointer ${
                    checked() ? 'bg-accent/5' : ''
                  }`}
                  onClick={() => {
                    if (isDir(file)) {
                      navigateToDir(file.path);
                    } else {
                      toggleContextItem(ctx());
                    }
                  }}
                >
                  {/* Checkbox (all items) */}
                  <SelectionCheckbox
                    checked={checked()}
                    onChange={() => toggleContextItem(ctx())}
                  />
                  {/* Icon */}
                  <Show when={isDir(file)} fallback={
                    <svg class="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  }>
                    <button
                      class="flex-shrink-0 hover:text-accent transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToDir(file.path);
                      }}
                      title={`Open ${file.name}`}
                    >
                      <svg class="w-3.5 h-3.5 text-accent/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </button>
                  </Show>
                  <span
                    class={`truncate ${isDir(file) ? 'text-text font-medium hover:text-accent cursor-pointer' : 'text-text-secondary'}`}
                    onClick={(e) => {
                      if (isDir(file)) {
                        e.stopPropagation();
                        navigateToDir(file.path);
                      }
                    }}
                  >
                    {file.name}
                  </span>
                  <Show when={file.size && !isDir(file)}>
                    <span class="ml-auto text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatFileSize(file.size!)}
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>

          <Show when={sortedFiles().length === 0 && !files.loading}>
            <div class="px-3 py-6 text-center text-[11px] text-text-muted">
              Empty directory
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ── Commit browser sub-view ──

function CommitBrowser(props: { resource: AgentResourceBinding; gitRef?: string }) {
  const agent = () => selectedAgent()!;

  const [commits] = createResource(
    () => ({ ref: props.gitRef || '' }),
    async ({ ref }) => {
      return agentResources.commits(agent().namespace, agent().name, props.resource.name, ref || undefined);
    }
  );

  function getSha(c: GitCommit): string {
    return c.sha || c.id || '';
  }

  function getShortSha(c: GitCommit): string {
    return getSha(c).slice(0, 7);
  }

  function getMessage(c: GitCommit): string {
    if (c.title) return c.title;
    if (c.commit?.message) return c.commit.message.split('\n')[0];
    return c.message?.split('\n')[0] || '';
  }

  function getAuthor(c: GitCommit): string {
    if (c.author_name) return c.author_name;
    if (c.author?.login) return c.author.login;
    if (c.commit?.author?.name) return c.commit.author.name;
    return '';
  }

  function getDate(c: GitCommit): string {
    if (c.authored_date) return c.authored_date;
    if (c.commit?.author?.date) return c.commit.author.date;
    return '';
  }

  function makeCommitContext(c: GitCommit): ResourceContext {
    return {
      resource_name: props.resource.name,
      kind: props.resource.kind,
      item_type: 'commit',
      sha: getSha(c),
      title: getMessage(c),
      ref: props.gitRef,
    };
  }

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={commits.loading}>
        <div class="flex items-center justify-center py-8">
          <Spinner size="sm" />
        </div>
      </Show>

      <Show when={!commits.loading}>
        <For each={commits() || []}>
          {(commit) => {
            const ctx = () => makeCommitContext(commit);
            const checked = () => isContextItemSelected(ctx());

            return (
              <div
                class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${
                  checked() ? 'bg-accent/5' : ''
                }`}
                onClick={() => toggleContextItem(ctx())}
              >
                <div class="flex items-start gap-2">
                  <SelectionCheckbox
                    checked={checked()}
                    onChange={() => toggleContextItem(ctx())}
                    class="mt-0.5"
                  />
                  <span class="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-mono bg-surface-2 border border-border-subtle rounded text-text-muted">
                    {getShortSha(commit)}
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="text-xs text-text truncate leading-tight">{getMessage(commit)}</p>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="text-[10px] text-text-muted">{getAuthor(commit)}</span>
                      <span class="text-[10px] text-text-muted/60">{relativeTime(getDate(commit))}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        </For>

        <Show when={(commits() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No commits found</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Branch browser sub-view ──

function BranchBrowser(props: { resource: AgentResourceBinding; onSelectBranch: (name: string) => void; currentRef?: string }) {
  const agent = () => selectedAgent()!;

  const [branches] = createResource(
    () => true,
    async () => {
      return agentResources.branches(agent().namespace, agent().name, props.resource.name);
    }
  );

  const defaultBranch = () => {
    if (props.resource.kind === 'github-repo') return props.resource.github?.defaultBranch || 'main';
    if (props.resource.kind === 'gitlab-project') return props.resource.gitlab?.defaultBranch || 'main';
    return 'main';
  };

  function makeBranchContext(branch: GitBranch): ResourceContext {
    return {
      resource_name: props.resource.name,
      kind: props.resource.kind,
      item_type: 'branch',
      path: branch.name,
    };
  }

  return (
    <div class="flex-1 overflow-y-auto">
      <Show when={branches.loading}>
        <div class="flex items-center justify-center py-8">
          <Spinner size="sm" />
        </div>
      </Show>

      <Show when={!branches.loading}>
        <For each={branches() || []}>
          {(branch) => {
            const isDefault = () => branch.name === defaultBranch();
            const isCurrent = () => branch.name === (props.currentRef || defaultBranch());
            const ctx = () => makeBranchContext(branch);
            const checked = () => isContextItemSelected(ctx());

            return (
              <div
                class={`w-full text-left px-3 py-2 text-xs hover:bg-surface-hover transition-colors flex items-center gap-2 border-b border-border-subtle cursor-pointer ${
                  isCurrent() ? 'bg-accent/5' : ''
                } ${checked() ? 'bg-accent/5' : ''}`}
              >
                <SelectionCheckbox
                  checked={checked()}
                  onChange={() => toggleContextItem(ctx())}
                />
                <button
                  class="flex-1 flex items-center gap-2 text-left"
                  onClick={() => props.onSelectBranch(branch.name)}
                >
                  <svg class={`w-3.5 h-3.5 flex-shrink-0 ${isCurrent() ? 'text-accent' : 'text-text-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  <span class={`font-mono truncate ${isCurrent() ? 'text-accent font-medium' : 'text-text-secondary'}`}>
                    {branch.name}
                  </span>
                  <Show when={isDefault()}>
                    <Badge variant="muted">default</Badge>
                  </Show>
                  <Show when={branch.protected}>
                    <svg class="w-3 h-3 text-warning ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </Show>
                </button>
              </div>
            );
          }}
        </For>

        <Show when={(branches() || []).length === 0}>
          <div class="px-3 py-6 text-center text-[11px] text-text-muted">No branches found</div>
        </Show>
      </Show>
    </div>
  );
}

// ── Merge Request / PR browser sub-view ──

function MergeRequestBrowser(props: { resource: AgentResourceBinding }) {
  const agent = () => selectedAgent()!;
  const [state, setState] = createSignal<'open' | 'closed' | 'merged'>('open');

  const [mrs] = createResource(
    state,
    async (s) => {
      return agentResources.mergeRequests(agent().namespace, agent().name, props.resource.name, s);
    }
  );

  const isGitHub = () => props.resource.kind === 'github-repo';

  function getNumber(mr: GitMergeRequest): number {
    return mr.number || mr.iid || 0;
  }

  function getAuthor(mr: GitMergeRequest): string {
    return mr.user?.login || mr.author?.username || '';
  }

  function getUrl(mr: GitMergeRequest): string {
    return mr.html_url || mr.web_url || '';
  }

  function stateVariant(s: string): 'success' | 'error' | 'info' | 'muted' {
    if (s === 'open' || s === 'opened') return 'success';
    if (s === 'merged') return 'info';
    if (s === 'closed') return 'error';
    return 'muted';
  }

  function makeMRContext(mr: GitMergeRequest): ResourceContext {
    return {
      resource_name: props.resource.name,
      kind: props.resource.kind,
      item_type: 'merge_request',
      number: getNumber(mr),
      title: mr.title,
      url: getUrl(mr),
    };
  }

  return (
    <div class="flex flex-col h-full">
      {/* State filter */}
      <div class="flex items-center gap-1 px-3 py-1.5 border-b border-border-subtle bg-surface-2/50">
        <For each={['open', 'closed', 'merged'] as const}>
          {(s) => (
            <button
              class={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                state() === s
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
              }`}
              onClick={() => setState(s)}
            >
              {s === 'open' ? (isGitHub() ? 'Open PRs' : 'Open MRs') : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          )}
        </For>
      </div>

      {/* MR list */}
      <div class="flex-1 overflow-y-auto">
        <Show when={mrs.loading}>
          <div class="flex items-center justify-center py-8">
            <Spinner size="sm" />
          </div>
        </Show>

        <Show when={!mrs.loading}>
          <For each={mrs() || []}>
            {(mr) => {
              const ctx = () => makeMRContext(mr);
              const checked = () => isContextItemSelected(ctx());

              return (
                <div
                  class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${
                    checked() ? 'bg-accent/5' : ''
                  }`}
                  onClick={() => toggleContextItem(ctx())}
                >
                  <div class="flex items-start gap-2">
                    <SelectionCheckbox
                      checked={checked()}
                      onChange={() => toggleContextItem(ctx())}
                      class="mt-0.5"
                    />
                    <Badge variant={stateVariant(mr.state)} class="flex-shrink-0 mt-0.5">
                      #{getNumber(mr)}
                    </Badge>
                    <div class="flex-1 min-w-0">
                      <p class="text-xs text-text truncate leading-tight">
                        {mr.title}
                      </p>
                      <div class="flex items-center gap-2 mt-0.5">
                        <span class="text-[10px] text-text-muted">{getAuthor(mr)}</span>
                        <span class="text-[10px] text-text-muted/60">{relativeTime(mr.updated_at || mr.created_at)}</span>
                        <Show when={mr.draft}>
                          <span class="text-[10px] text-warning">draft</span>
                        </Show>
                      </div>
                      <Show when={mr.source_branch}>
                        <div class="flex items-center gap-1 mt-0.5">
                          <span class="text-[9px] font-mono text-text-muted bg-surface-2 px-1 rounded">{mr.source_branch}</span>
                          <svg class="w-2.5 h-2.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                          <span class="text-[9px] font-mono text-text-muted bg-surface-2 px-1 rounded">{mr.target_branch}</span>
                        </div>
                      </Show>
                    </div>
                    {/* External link (still clickable separately) */}
                    <Tip content="Open in browser">
                      <a
                        href={getUrl(mr)}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="flex-shrink-0 p-0.5 text-text-muted/40 hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </Tip>
                  </div>
                </div>
              );
            }}
          </For>

          <Show when={(mrs() || []).length === 0}>
            <div class="px-3 py-6 text-center text-[11px] text-text-muted">
              No {isGitHub() ? 'pull requests' : 'merge requests'} found
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ── Issue browser sub-view ──

function IssueBrowser(props: { resource: AgentResourceBinding }) {
  const agent = () => selectedAgent()!;
  const [state, setState] = createSignal<'open' | 'closed'>('open');

  const [issues] = createResource(
    state,
    async (s) => {
      return agentResources.issues(agent().namespace, agent().name, props.resource.name, s);
    }
  );

  function getNumber(issue: GitIssue): number {
    return issue.number || issue.iid || 0;
  }

  function getAuthor(issue: GitIssue): string {
    return issue.user?.login || issue.author?.username || '';
  }

  function getUrl(issue: GitIssue): string {
    return issue.html_url || issue.web_url || '';
  }

  function makeIssueContext(issue: GitIssue): ResourceContext {
    return {
      resource_name: props.resource.name,
      kind: props.resource.kind,
      item_type: 'issue',
      number: getNumber(issue),
      title: issue.title,
      url: getUrl(issue),
    };
  }

  return (
    <div class="flex flex-col h-full">
      {/* State filter */}
      <div class="flex items-center gap-1 px-3 py-1.5 border-b border-border-subtle bg-surface-2/50">
        <For each={['open', 'closed'] as const}>
          {(s) => (
            <button
              class={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                state() === s
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
              }`}
              onClick={() => setState(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          )}
        </For>
      </div>

      {/* Issue list */}
      <div class="flex-1 overflow-y-auto">
        <Show when={issues.loading}>
          <div class="flex items-center justify-center py-8">
            <Spinner size="sm" />
          </div>
        </Show>

        <Show when={!issues.loading}>
          <For each={issues() || []}>
            {(issue) => {
              const ctx = () => makeIssueContext(issue);
              const checked = () => isContextItemSelected(ctx());

              return (
                <div
                  class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${
                    checked() ? 'bg-accent/5' : ''
                  }`}
                  onClick={() => toggleContextItem(ctx())}
                >
                  <div class="flex items-start gap-2">
                    <SelectionCheckbox
                      checked={checked()}
                      onChange={() => toggleContextItem(ctx())}
                      class="mt-0.5"
                    />
                    <Badge variant={issue.state === 'open' || issue.state === 'opened' ? 'success' : 'error'} class="flex-shrink-0 mt-0.5">
                      #{getNumber(issue)}
                    </Badge>
                    <div class="flex-1 min-w-0">
                      <p class="text-xs text-text truncate leading-tight">
                        {issue.title}
                      </p>
                      <div class="flex items-center gap-2 mt-0.5">
                        <span class="text-[10px] text-text-muted">{getAuthor(issue)}</span>
                        <span class="text-[10px] text-text-muted/60">{relativeTime(issue.updated_at || issue.created_at)}</span>
                      </div>
                      <Show when={issue.labels && issue.labels.length > 0}>
                        <div class="flex flex-wrap gap-1 mt-1">
                          <For each={issue.labels!.slice(0, 4)}>
                            {(label) => (
                              <span
                                class="px-1.5 py-0 text-[9px] rounded-full border"
                                style={{
                                  'background-color': label.color ? `#${label.color}20` : undefined,
                                  'border-color': label.color ? `#${label.color}40` : undefined,
                                  color: label.color ? `#${label.color}` : undefined,
                                }}
                              >
                                {label.name}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                    {/* External link */}
                    <Tip content="Open in browser">
                      <a
                        href={getUrl(issue)}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="flex-shrink-0 p-0.5 text-text-muted/40 hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </Tip>
                  </div>
                </div>
              );
            }}
          </For>

          <Show when={(issues() || []).length === 0}>
            <div class="px-3 py-6 text-center text-[11px] text-text-muted">No issues found</div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ── Pipeline Browser (GitLab CI) ──

function PipelineBrowser(props: { resource: AgentResourceBinding; gitRef?: string }) {
  const agent = () => selectedAgent()!;

  const [pipelines] = createResource(
    () => ({ name: props.resource.name, ref: props.gitRef }),
    (key) =>
      agentResources.pipelines(agent().namespace, agent().name, key.name, key.ref)
  );

  function statusVariant(status: string): 'success' | 'error' | 'warning' | 'muted' {
    switch (status) {
      case 'success':
        return 'success';
      case 'failed':
        return 'error';
      case 'running':
      case 'pending':
      case 'created':
        return 'warning';
      default:
        return 'muted';
    }
  }

  function makePipelineContext(p: GitPipeline): ResourceContext {
    return {
      resource_name: props.resource.name,
      kind: props.resource.kind,
      item_type: 'pipeline',
      number: p.iid || p.id,
      title: `pipeline #${p.id} (${p.status})${p.ref ? ` on ${p.ref}` : ''}`,
      url: p.web_url || '',
    };
  }

  return (
    <div class="flex flex-col h-full">
      <div class="flex-1 overflow-y-auto">
        <Show when={pipelines.loading}>
          <div class="flex items-center justify-center py-8">
            <Spinner size="sm" />
          </div>
        </Show>

        <Show when={!pipelines.loading}>
          <For each={pipelines() || []}>
            {(p) => {
              const ctx = () => makePipelineContext(p);
              const checked = () => isContextItemSelected(ctx());

              return (
                <div
                  class={`px-3 py-2 border-b border-border-subtle hover:bg-surface-hover transition-colors group cursor-pointer ${
                    checked() ? 'bg-accent/5' : ''
                  }`}
                  onClick={() => toggleContextItem(ctx())}
                >
                  <div class="flex items-start gap-2">
                    <SelectionCheckbox
                      checked={checked()}
                      onChange={() => toggleContextItem(ctx())}
                      class="mt-0.5"
                    />
                    <Badge variant={statusVariant(p.status)} class="flex-shrink-0 mt-0.5">
                      {p.status}
                    </Badge>
                    <div class="flex-1 min-w-0">
                      <p class="text-xs text-text truncate leading-tight">
                        #{p.id}
                        <Show when={p.ref}>
                          <span class="text-text-muted"> · {p.ref}</span>
                        </Show>
                      </p>
                      <div class="flex items-center gap-2 mt-0.5">
                        <Show when={p.sha}>
                          <span class="text-[10px] font-mono text-text-muted">{p.sha!.slice(0, 8)}</span>
                        </Show>
                        <span class="text-[10px] text-text-muted/60">{relativeTime(p.updated_at || p.created_at)}</span>
                      </div>
                    </div>
                    <Tip content="Open in browser">
                      <a
                        href={p.web_url || ''}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="flex-shrink-0 p-0.5 text-text-muted/40 hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </Tip>
                  </div>
                </div>
              );
            }}
          </For>

          <Show when={(pipelines() || []).length === 0}>
            <div class="px-3 py-6 text-center text-[11px] text-text-muted">No pipelines found</div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ── Main ResourceBrowser component ──

interface ResourceBrowserProps {
  open: boolean;
  onClose: () => void;
  class?: string;
  /** When set, the browser opens directly to this resource (used in embedded/unified panel mode) */
  initialResource?: AgentResourceBinding;
  /** When true, skip rendering backdrop and header (parent panel handles those) */
  embedded?: boolean;
}

export default function ResourceBrowser(props: ResourceBrowserProps) {
  const [selectedResource, setSelectedResource] = createSignal<AgentResourceBinding | null>(
    props.initialResource || null
  );
  const [activeTab, setActiveTab] = createSignal<BrowserTab>('files');
  const [currentRef, setCurrentRef] = createSignal<string | undefined>(undefined);

  const resources = createMemo(() => browsableResources());
  const ctxCount = () => selectedContextCount();

  // Auto-select first resource when opening
  const handleResourceSelect = (res: AgentResourceBinding) => {
    setSelectedResource(res);
    setActiveTab('files');
    setCurrentRef(undefined);
  };

  // Auto-select: use initialResource if provided, otherwise first browsable
  createResource(
    () => props.open,
    async (open) => {
      if (open) {
        if (props.initialResource) {
          setSelectedResource(props.initialResource);
        } else if (!selectedResource() && resources().length > 0) {
          setSelectedResource(resources()[0]);
        }
      }
    }
  );

  function handleBranchSelect(branchName: string) {
    setCurrentRef(branchName);
    setActiveTab('files');
  }

  return (
    <Show when={props.open}>
      {/* Backdrop — skip in embedded mode */}
      <Show when={!props.embedded}>
        <div class="fixed inset-0 z-40" onClick={() => props.onClose()} />
      </Show>

      {/* Browser panel */}
      <div
        class={`${props.embedded ? '' : 'absolute z-50'} resource-browser-panel bg-surface ${props.embedded ? '' : 'border border-border rounded-xl shadow-lg'} overflow-hidden animate-popover-in ${props.class || ''}`}
        style={props.embedded ? { width: '100%', height: '100%' } : { width: '420px', height: '480px' }}
      >
        {/* Header — skip in embedded mode (parent panel has it) */}
        <Show when={!props.embedded}>
        <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-2/80">
          <div class="flex items-center gap-2">
            <svg class="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span class="text-xs font-semibold text-text uppercase tracking-wide">Resources</span>
            {/* Selection count badge */}
            <Show when={ctxCount() > 0}>
              <span class="text-[10px] font-medium bg-accent text-white px-1.5 py-0.5 rounded-full leading-none">
                {ctxCount()}
              </span>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            {/* Clear selection button */}
            <Show when={ctxCount() > 0}>
              <Tip content="Clear all selections">
                <button
                  class="text-[10px] text-text-muted hover:text-error transition-colors"
                  onClick={() => clearContextItems()}
                >
                  Clear
                </button>
              </Tip>
            </Show>
            {/* Current ref indicator */}
            <Show when={currentRef()}>
              <span class="text-[10px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                {currentRef()}
              </span>
            </Show>
            <button
              class="p-1 text-text-muted hover:text-text rounded transition-colors"
              onClick={() => props.onClose()}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        </Show>

        {/* Resource chips — in embedded mode, hide if single resource since user already selected it from the list */}
        <Show when={resources().length > 1 && !(props.embedded && props.initialResource)}>
          <div class="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-subtle overflow-x-auto">
            <For each={resources()}>
              {(res) => (
                <ResourceChip
                  resource={res}
                  selected={selectedResource()?.name === res.name}
                  onClick={() => handleResourceSelect(res)}
                />
              )}
            </For>
          </div>
        </Show>

        {/* No resources */}
        <Show when={resources().length === 0}>
          <div class="flex flex-col items-center justify-center h-full py-12 px-4">
            <svg class="w-10 h-10 text-text-muted/30 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p class="text-xs text-text-muted text-center">
              No browsable resources bound to this agent.
            </p>
            <p class="text-[10px] text-text-muted/60 text-center mt-1">
              Add a github-repo or gitlab-project AgentResource.
            </p>
          </div>
        </Show>

        {/* Tab bar + content */}
        <Show when={selectedResource()}>
          {(res) => (
            <>
              {/* Tab navigation */}
              <div class="flex items-center border-b border-border-subtle">
                <For each={visibleTabs(res().kind)}>
                  {(tab) => (
                    <button
                      class={`resource-tab flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium transition-colors relative ${
                        activeTab() === tab.id
                          ? 'text-accent'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d={tab.icon} />
                      </svg>
                      {tab.label}
                      <Show when={activeTab() === tab.id}>
                        <div class="absolute bottom-0 left-1 right-1 h-[2px] bg-accent rounded-full" />
                      </Show>
                    </button>
                  )}
                </For>
              </div>

              {/* Tab content — adjust height based on embedded vs standalone mode */}
              <div class="flex-1 overflow-hidden" style={{ height: props.embedded ? 'calc(100% - 36px)' : 'calc(100% - 110px)' }}>
                <Switch>
                  <Match when={activeTab() === 'files'}>
                    <FileBrowser resource={res()} gitRef={currentRef()} />
                  </Match>
                  <Match when={activeTab() === 'commits'}>
                    <CommitBrowser resource={res()} gitRef={currentRef()} />
                  </Match>
                  <Match when={activeTab() === 'branches'}>
                    <BranchBrowser
                      resource={res()}
                      currentRef={currentRef()}
                      onSelectBranch={handleBranchSelect}
                    />
                  </Match>
                  <Match when={activeTab() === 'mergerequests'}>
                    <MergeRequestBrowser resource={res()} />
                  </Match>
                  <Match when={activeTab() === 'issues'}>
                    <IssueBrowser resource={res()} />
                  </Match>
                  <Match when={activeTab() === 'pipelines'}>
                    <PipelineBrowser resource={res()} gitRef={currentRef()} />
                  </Match>
                </Switch>
              </div>
            </>
          )}
        </Show>
      </div>
    </Show>
  );
}

// ── Utility ──

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
