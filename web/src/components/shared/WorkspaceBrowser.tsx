// WorkspaceBrowser — unified scope selector for the top bar.
//
// Single pill that shows the current scope:
//   "samyn92-lab"              → group workspace, all projects
//   "samyn92-lab / billing-svc" → group workspace, filtered to one project
//   "Homecluster"              → single-project workspace
//
// Opens a palette showing:
//   - Available workspaces (Integration CRDs: gitlab-group or gitlab-project)
//   - Under each group workspace: its projects (for filtering)
//
// This replaces both the old workspace <select> AND the RepoSwitcher.
import {
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
  type Accessor,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { relativeTime } from '../../lib/format';
import { GitLabIcon } from '../shared/Icons';
import Spinner from '../shared/Spinner';

/** Minimal Integration shape from the parent page. */
export interface WorkspaceIntegration {
  metadata: { name: string; namespace: string };
  spec: {
    kind: string;
    displayName?: string;
    gitlabGroup?: { group: string };
    gitlab?: { project: string };
  };
  status?: { phase?: string };
}

/** Board project shape. */
export interface BoardProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url?: string;
  avatar_url?: string;
  last_activity_at?: string;
  open_issues_count?: number;
  star_count?: number;
  visibility?: string;
  archived?: boolean;
  topics?: string[];
}

export interface WorkspaceBrowserProps {
  /** All available workspace integrations (deduped). */
  workspaces: Accessor<WorkspaceIntegration[]>;
  /** Currently selected workspace. */
  selected: Accessor<WorkspaceIntegration | null>;
  /** Switch workspace. */
  onSelectWorkspace: (ws: WorkspaceIntegration) => void;
  /** Currently selected project ID (null = all). */
  projectFilter: Accessor<number | null>;
  /** Set project filter. */
  onSelectProject: (id: number | null) => void;
  /** Board's project list for the active workspace. */
  boardProjects: Accessor<BoardProject[] | undefined>;
}

export default function WorkspaceBrowser(props: WorkspaceBrowserProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [highlight, setHighlight] = createSignal(0);

  // Current workspace label.
  const wsLabel = createMemo(() => {
    const ws = props.selected();
    if (!ws) return 'Select workspace';
    return ws.spec.displayName || ws.spec.gitlabGroup?.group || ws.spec.gitlab?.project || ws.metadata.name;
  });

  // Current project name (if filtered).
  const projectName = createMemo(() => {
    const id = props.projectFilter();
    if (id == null) return null;
    const bp = props.boardProjects();
    if (!bp) return null;
    const found = bp.find(p => p.id === id);
    return found?.name ?? null;
  });

  // Filtered projects for the active workspace.
  const filteredProjects = createMemo(() => {
    const bp = (props.boardProjects() ?? []).slice()
      .sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''));
    const q = query().trim().toLowerCase();
    if (!q) return bp;
    return bp.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.path_with_namespace.toLowerCase().includes(q) ||
      (p.topics ?? []).some(t => t.toLowerCase().includes(q))
    );
  });

  // Is the current workspace a group (has multiple projects)?
  const isGroup = () => props.selected()?.spec.kind === 'gitlab-group';

  function openPalette() { setQuery(''); setHighlight(0); setOpen(true); }
  function close() { setOpen(false); }

  function selectWorkspace(ws: WorkspaceIntegration) {
    props.onSelectWorkspace(ws);
    props.onSelectProject(null);
    // Stay open if group (show projects next).
    if (ws.spec.kind !== 'gitlab-group') close();
  }

  function selectProject(id: number | null) {
    props.onSelectProject(id);
    close();
  }

  // Reset highlight on query change.
  createEffect(() => { query(); setHighlight(0); });

  // "/" hotkey.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open() || e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
      e.preventDefault();
      openPalette();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  function onKey(e: KeyboardEvent) {
    const total = isGroup() ? filteredProjects().length + 1 : props.workspaces().length;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, total - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (isGroup()) {
        if (highlight() === 0) selectProject(null);
        else {
          const p = filteredProjects()[highlight() - 1];
          if (p) selectProject(p.id);
        }
      } else {
        const ws = props.workspaces()[highlight()];
        if (ws) selectWorkspace(ws);
      }
    }
  }

  return (
    <>
      {/* Pill */}
      <button
        class="flex items-center gap-2 rounded-lg px-3 py-1.5 border border-border-subtle bg-surface-2 hover:border-border hover:bg-surface-3 transition-colors max-w-[24rem]"
        onClick={openPalette}
        title="Switch workspace or filter project ( / )"
      >
        <GitLabIcon class="w-4 h-4 text-[#FC6D26] flex-none" />
        <span class="text-[12.5px] font-semibold truncate">{wsLabel()}</span>
        <Show when={projectName()}>
          <span class="text-text-muted text-[11px]">/</span>
          <span class="text-[12px] truncate text-text-secondary">{projectName()}</span>
        </Show>
        <Show when={isGroup() && !projectName()}>
          <span class="text-[10.5px] text-text-muted ml-1">all repos</span>
        </Show>
        <kbd class="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-subtle bg-surface text-text-muted">/</kbd>
      </button>

      {/* Palette */}
      <Show when={open()}>
        <Portal>
          <div class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4" onClick={close}>
            <div
              class="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[65vh]"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
                <GitLabIcon class="w-4 h-4 text-[#FC6D26] flex-none" />
                <Show when={isGroup()}>
                  <button class="text-[11px] text-text-muted hover:text-text-secondary" onClick={() => setQuery('')}>
                    {wsLabel()}
                  </button>
                  <span class="text-text-muted text-[11px]">/</span>
                </Show>
                <input
                  ref={el => queueMicrotask(() => el.focus())}
                  class="flex-1 bg-transparent outline-none text-[13px] placeholder:text-text-muted"
                  placeholder={isGroup() ? 'Filter projects...' : 'Search workspaces...'}
                  value={query()}
                  onInput={e => setQuery(e.currentTarget.value)}
                  onKeyDown={onKey}
                />
                <kbd class="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-text-muted">esc</kbd>
              </div>

              {/* Content */}
              <div class="flex-1 overflow-y-auto p-1.5">
                {/* Show projects when a group workspace is selected */}
                <Show when={isGroup()}>
                  {/* "All repositories" option */}
                  <Row active={highlight() === 0} onHover={() => setHighlight(0)} onPick={() => selectProject(null)}>
                    <span class="w-7 h-7 rounded-md grid place-items-center text-[12px] text-text-muted bg-surface-2 flex-none">*</span>
                    <div class="min-w-0 flex-1">
                      <div class="text-[12.5px] font-semibold">All repositories</div>
                      <div class="text-[10.5px] text-text-muted">Show work across all projects in {wsLabel()}</div>
                    </div>
                    <Show when={props.projectFilter() == null}><Check /></Show>
                  </Row>

                  {/* Project list */}
                  <For each={filteredProjects()}>
                    {(p, i) => (
                      <Row active={highlight() === i() + 1} onHover={() => setHighlight(i() + 1)} onPick={() => selectProject(p.id)}>
                        <ProjectAvatar p={p} />
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="text-[12.5px] font-semibold truncate">{p.name}</span>
                            <Show when={p.archived}><Tag>archived</Tag></Show>
                          </div>
                          <div class="text-[10.5px] text-text-muted truncate font-mono">{p.path_with_namespace}</div>
                        </div>
                        <div class="flex items-center gap-2 text-[10.5px] text-text-muted flex-none">
                          <Show when={(p.open_issues_count ?? 0) > 0}><span>{p.open_issues_count} issues</span></Show>
                          <Show when={p.last_activity_at}><span class="hidden sm:inline">{relativeTime(p.last_activity_at!)}</span></Show>
                          <Show when={p.web_url}>
                            <a class="w-5 h-5 grid place-items-center rounded text-text-muted hover:text-[#FC6D26] transition-colors"
                              href={p.web_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                              <GitLabIcon class="w-3.5 h-3.5" />
                            </a>
                          </Show>
                          <Show when={props.projectFilter() === p.id}><Check /></Show>
                        </div>
                      </Row>
                    )}
                  </For>

                  <Show when={filteredProjects().length === 0 && query().trim()}>
                    <p class="text-[12px] text-text-muted text-center py-6">No projects match "{query()}"</p>
                  </Show>

                  {/* Back to workspace list */}
                  <div class="border-t border-border-subtle mt-2 pt-2 px-1">
                    <button
                      class="text-[11px] text-text-muted hover:text-accent transition-colors"
                      onClick={() => { props.onSelectProject(null); /* show workspaces by clearing selection temporarily */ }}
                    >
                      Switch workspace...
                    </button>
                  </div>
                </Show>

                {/* Show workspace list when no group is active OR for single-project workspaces */}
                <Show when={!isGroup()}>
                  <div class="px-2 py-1.5 text-[10.5px] font-medium text-text-muted uppercase tracking-wider">Workspaces</div>
                  <For each={props.workspaces()}>
                    {(ws, i) => {
                      const label = () => ws.spec.displayName || ws.spec.gitlabGroup?.group || ws.spec.gitlab?.project || ws.metadata.name;
                      const isActive = () => props.selected()?.metadata.name === ws.metadata.name;
                      const kind = () => ws.spec.kind === 'gitlab-group' ? 'group' : 'project';
                      return (
                        <Row active={highlight() === i()} onHover={() => setHighlight(i())} onPick={() => selectWorkspace(ws)}>
                          <span class="w-7 h-7 rounded-md grid place-items-center text-[11px] font-semibold flex-none"
                            classList={{ 'bg-indigo-500/10 text-indigo-400': kind() === 'group', 'bg-emerald-500/10 text-emerald-400': kind() === 'project' }}>
                            {kind() === 'group' ? 'G' : 'P'}
                          </span>
                          <div class="min-w-0 flex-1">
                            <div class="text-[12.5px] font-semibold truncate">{label()}</div>
                            <div class="text-[10.5px] text-text-muted">{kind()}</div>
                          </div>
                          <Show when={isActive()}><Check /></Show>
                        </Row>
                      );
                    }}
                  </For>
                </Show>
              </div>

              {/* Footer */}
              <div class="flex items-center gap-3 px-4 py-2 border-t border-border text-[10.5px] text-text-muted">
                <span><kbd class="font-mono">&#8593;&#8595;</kbd> navigate</span>
                <span><kbd class="font-mono">&#8629;</kbd> select</span>
                <span class="ml-auto"><kbd class="font-mono">esc</kbd> close</span>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}

// ── Helpers ──

function Row(props: { active: boolean; onHover: () => void; onPick: () => void; children: any }) {
  return (
    <div
      class={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
        props.active ? 'bg-accent/8 ring-1 ring-accent/20' : 'hover:bg-surface-2'
      }`}
      onMouseEnter={props.onHover}
      onClick={props.onPick}
    >
      {props.children}
    </div>
  );
}

function Check() {
  return <span class="text-accent text-[12px] flex-none">&#10003;</span>;
}

function Tag(props: { children: any }) {
  return <span class="text-[9px] uppercase tracking-wide text-text-muted border border-border-subtle rounded px-1 py-px">{props.children}</span>;
}

function ProjectAvatar(props: { p: BoardProject }) {
  return (
    <Show when={props.p.avatar_url} fallback={
      <span class="w-7 h-7 rounded-md grid place-items-center text-[11px] bg-surface-2 text-text-muted flex-none font-mono">
        {props.p.name[0]?.toLowerCase()}
      </span>
    }>
      <img src={props.p.avatar_url} class="w-7 h-7 rounded-md flex-none" alt="" />
    </Show>
  );
}
