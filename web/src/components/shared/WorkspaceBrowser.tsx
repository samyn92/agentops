// WorkspaceBrowser — GitLab-native repository browser for the top bar.
//
// Two modes in one palette:
//  1. **Scope** (default) — shows the board's project list (same repos the
//     board has data for). Selecting one sets the projectFilter to scope the
//     board. This is the direct replacement for the old RepoSwitcher.
//  2. **Explore** — shows the user's full GitLab access (groups, subgroups,
//     starred). Lazy-loaded from /api/v1/workspaces on first switch.
//
// Opened via the top-bar pill or "/" hotkey.
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
import { workspaces, type WorkspaceGroup, type WorkspaceProject, type WorkspacesResponse } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { GitLabIcon } from '../shared/Icons';
import Spinner from '../shared/Spinner';

// Re-export for convenience.
export type { WorkspaceProject };

/** Minimal project shape from the board's Integration-scoped project list. */
export interface BoardProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url?: string;
  avatar_url?: string;
  star_count?: number;
  open_issues_count?: number;
  last_activity_at?: string;
  archived?: boolean;
  visibility?: string;
  topics?: string[];
}

export interface WorkspaceBrowserProps {
  /** Currently selected project ID (null = all repos). */
  projectFilter: Accessor<number | null>;
  /** Called when the user picks a project (or null for "all"). */
  onSelectProject: (id: number | null) => void;
  /** Current workspace group path (for the pill label). */
  currentGroup?: Accessor<string | undefined>;
  /** Board's project list — the projects the board actually has data for. */
  boardProjects?: Accessor<BoardProject[] | undefined>;
}

type Tab = 'scope' | 'explore';

export default function WorkspaceBrowser(props: WorkspaceBrowserProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [highlight, setHighlight] = createSignal(0);
  const [tab, setTab] = createSignal<Tab>('scope');

  // Explore tab: lazy-loaded full GitLab tree.
  const [wsData, setWsData] = createSignal<WorkspacesResponse | null>(null);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  let exploreFetched = false;

  function ensureExploreLoaded() {
    if (exploreFetched) return;
    exploreFetched = true;
    workspaces.list().then(d => {
      setWsData(d);
      // Auto-expand top-level groups.
      const paths = new Set<string>();
      for (const g of d.groups) paths.add(g.fullPath);
      setExpanded(paths);
    }).catch(() => {});
  }

  // ── Pill label ──
  const activeProjectName = createMemo(() => {
    const id = props.projectFilter();
    if (id == null) return null;
    const bp = props.boardProjects?.();
    if (bp) {
      const found = bp.find(p => p.id === id);
      if (found) return found.name;
    }
    return null;
  });

  // ── Scope tab: board projects filtered by search query ──
  const scopeProjects = createMemo(() => {
    const list = (props.boardProjects?.() ?? []).slice()
      .sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''));
    const q = query().trim().toLowerCase();
    if (!q) return list;
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.path_with_namespace.toLowerCase().includes(q) ||
      (p.topics ?? []).some(t => t.toLowerCase().includes(q))
    );
  });

  // ── Explore tab: full GitLab projects filtered by search ──
  const exploreProjects = createMemo((): WorkspaceProject[] => {
    const d = wsData();
    if (!d) return [];
    const all: WorkspaceProject[] = [];
    const collect = (groups: WorkspaceGroup[]) => {
      for (const g of groups) {
        if (g.projects) all.push(...g.projects);
        if (g.subgroups) collect(g.subgroups);
      }
    };
    collect(d.groups);
    all.push(...d.projects);
    // Dedup.
    const seen = new Set<number>();
    const deduped: WorkspaceProject[] = [];
    for (const p of all) { if (!seen.has(p.id)) { seen.add(p.id); deduped.push(p); } }
    const q = query().trim().toLowerCase();
    if (!q) return deduped;
    return deduped.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.pathWithNamespace.toLowerCase().includes(q) ||
      (p.topics ?? []).some(t => t.toLowerCase().includes(q))
    );
  });

  // Row count for keyboard navigation.
  const rowCount = createMemo(() => {
    const list = tab() === 'scope' ? scopeProjects() : exploreProjects();
    return list.length + 1; // +1 for "All repositories"
  });

  function openPalette() {
    setQuery('');
    setHighlight(0);
    setTab('scope');
    setOpen(true);
  }
  function close() { setOpen(false); }

  function pickById(id: number | null) {
    props.onSelectProject(id);
    close();
  }

  function activate(idx: number) {
    if (idx === 0) { pickById(null); return; }
    if (tab() === 'scope') {
      const p = scopeProjects()[idx - 1];
      if (p) pickById(p.id);
    } else {
      const p = exploreProjects()[idx - 1];
      if (p) pickById(p.id);
    }
  }

  function switchToExplore() {
    ensureExploreLoaded();
    setTab('explore');
    setHighlight(0);
  }

  // Reset highlight on query/tab change.
  createEffect(() => { query(); tab(); setHighlight(0); });

  // "/" hotkey.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open() || e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      e.preventDefault();
      openPalette();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, rowCount() - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(highlight()); }
    else if (e.key === 'Tab') { e.preventDefault(); tab() === 'scope' ? switchToExplore() : setTab('scope'); }
  }

  function toggleGroup(path: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <>
      {/* Trigger pill */}
      <button
        class="repo-pill flex items-center gap-2 rounded-lg px-2.5 py-1.5 border border-border-subtle bg-surface-2 max-w-[22rem] hover:border-border hover:bg-surface-3 transition-colors"
        onClick={openPalette}
        title="Browse repositories ( / )"
      >
        <GitLabIcon class="w-4 h-4 text-[#FC6D26] flex-none" />
        <Show when={activeProjectName()} fallback={
          <>
            <Show when={props.currentGroup?.()}>
              <span class="text-[11.5px] text-text-muted truncate max-w-[10rem]">{props.currentGroup!()}</span>
              <span class="text-text-muted text-[11px]">/</span>
            </Show>
            <span class="text-[12.5px] font-semibold">All repositories</span>
          </>
        }>
          <span class="text-[12.5px] font-semibold truncate">{activeProjectName()}</span>
        </Show>
        <kbd class="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-subtle bg-surface text-text-muted leading-none">/</kbd>
      </button>

      {/* Modal */}
      <Show when={open()}>
        <Portal>
          <div class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4" onClick={close}>
            <div
              class="w-full max-w-xl rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
              onClick={e => e.stopPropagation()}
            >
              {/* Header: search + tabs */}
              <div class="border-b border-border">
                <div class="flex items-center gap-2 px-4 py-3">
                  <GitLabIcon class="w-4 h-4 text-[#FC6D26] flex-none" />
                  <input
                    ref={el => queueMicrotask(() => el.focus())}
                    class="flex-1 bg-transparent outline-none text-[14px] placeholder:text-text-muted"
                    placeholder={tab() === 'scope' ? 'Filter workspace repos...' : 'Search all GitLab repos...'}
                    value={query()}
                    onInput={e => setQuery(e.currentTarget.value)}
                    onKeyDown={onKey}
                  />
                  <kbd class="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-text-muted">esc</kbd>
                </div>
                <div class="flex items-center gap-1 px-4 pb-2">
                  <TabBtn label="Workspace" active={tab() === 'scope'} count={props.boardProjects?.()?.length ?? 0}
                    onClick={() => setTab('scope')} />
                  <TabBtn label="Explore GitLab" active={tab() === 'explore'} count={exploreProjects().length}
                    onClick={switchToExplore} />
                </div>
              </div>

              {/* List */}
              <div class="flex-1 overflow-y-auto p-1.5">
                {/* "All repositories" row — always first */}
                <Row active={highlight() === 0} onHover={() => setHighlight(0)} onPick={() => pickById(null)}>
                  <span class="w-7 h-7 rounded-md grid place-items-center text-[13px] text-text-muted bg-surface-2 flex-none">*</span>
                  <div class="min-w-0 flex-1">
                    <div class="text-[13px] font-semibold">All repositories</div>
                    <div class="text-[11px] text-text-muted">Show work from every repo</div>
                  </div>
                  <Show when={props.projectFilter() == null}>
                    <span class="text-accent text-[12px]">&#10003;</span>
                  </Show>
                </Row>

                {/* Scope tab */}
                <Show when={tab() === 'scope'}>
                  <For each={scopeProjects()}>
                    {(p, i) => (
                      <Row active={highlight() === i() + 1} onHover={() => setHighlight(i() + 1)} onPick={() => pickById(p.id)}>
                        <BoardProjectAvatar p={p} />
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="text-[12.5px] font-semibold truncate">{p.name}</span>
                            <Show when={p.archived}><span class="text-[9px] uppercase text-text-muted border border-border-subtle rounded px-1">archived</span></Show>
                            <Show when={p.visibility && p.visibility !== 'public'}><span class="text-[10px] text-text-muted">{p.visibility}</span></Show>
                          </div>
                          <div class="text-[10.5px] text-text-muted truncate font-mono">{p.path_with_namespace}</div>
                        </div>
                        <div class="flex items-center gap-2 text-[10.5px] text-text-muted flex-none">
                          <Show when={(p.open_issues_count ?? 0) > 0}><span>{p.open_issues_count} issues</span></Show>
                          <Show when={(p.star_count ?? 0) > 0}><span>&#9733; {p.star_count}</span></Show>
                          <Show when={p.last_activity_at}><span class="hidden sm:inline">{relativeTime(p.last_activity_at!)}</span></Show>
                          <Show when={p.web_url}>
                            <a class="grid place-items-center w-5 h-5 rounded text-text-muted hover:text-[#FC6D26] hover:bg-surface-2 transition-colors"
                              href={p.web_url} target="_blank" rel="noreferrer" title="Open in GitLab" onClick={e => e.stopPropagation()}>
                              <GitLabIcon class="w-3.5 h-3.5" />
                            </a>
                          </Show>
                          <Show when={props.projectFilter() === p.id}><span class="text-accent">&#10003;</span></Show>
                        </div>
                      </Row>
                    )}
                  </For>
                  <Show when={scopeProjects().length === 0 && query().trim()}>
                    <p class="text-[12.5px] text-text-muted text-center py-8">No repos match "{query()}"</p>
                  </Show>
                </Show>

                {/* Explore tab */}
                <Show when={tab() === 'explore'}>
                  <Show when={wsData()} fallback={<div class="grid place-items-center py-12"><Spinner size="sm" /></div>}>
                    {/* Starred */}
                    <Show when={wsData()!.starred.length > 0 && !query().trim()}>
                      <div class="px-2 pt-2 pb-1 text-[10.5px] font-medium text-text-muted uppercase tracking-wider">Starred</div>
                      <For each={wsData()!.starred}>
                        {p => (
                          <Row active={false} onHover={() => {}} onPick={() => pickById(p.id)}>
                            <ExploreAvatar p={p} />
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5">
                                <span class="text-[12.5px] font-semibold truncate">{p.name}</span>
                                <span class="text-amber-400 text-[10px]">&#9733;</span>
                              </div>
                              <div class="text-[10.5px] text-text-muted truncate font-mono">{p.pathWithNamespace}</div>
                            </div>
                            <Show when={props.projectFilter() === p.id}><span class="text-accent text-[12px]">&#10003;</span></Show>
                          </Row>
                        )}
                      </For>
                    </Show>

                    {/* Groups tree (no search) */}
                    <Show when={!query().trim()}>
                      <Show when={wsData()!.groups.length > 0}>
                        <div class="px-2 pt-3 pb-1 text-[10.5px] font-medium text-text-muted uppercase tracking-wider">Groups</div>
                        <For each={wsData()!.groups}>
                          {g => <GroupNode group={g} depth={0} expanded={expanded()} onToggle={toggleGroup}
                            onPick={pickById} projectFilter={props.projectFilter} />}
                        </For>
                      </Show>
                      <Show when={wsData()!.projects.length > 0}>
                        <div class="px-2 pt-3 pb-1 text-[10.5px] font-medium text-text-muted uppercase tracking-wider">Other projects</div>
                        <For each={wsData()!.projects}>
                          {p => (
                            <Row active={false} onHover={() => {}} onPick={() => pickById(p.id)}>
                              <ExploreAvatar p={p} />
                              <div class="min-w-0 flex-1">
                                <span class="text-[12.5px] font-semibold truncate">{p.name}</span>
                                <div class="text-[10.5px] text-text-muted truncate font-mono">{p.pathWithNamespace}</div>
                              </div>
                              <Show when={props.projectFilter() === p.id}><span class="text-accent text-[12px]">&#10003;</span></Show>
                            </Row>
                          )}
                        </For>
                      </Show>
                    </Show>

                    {/* Search results in explore mode */}
                    <Show when={query().trim()}>
                      <For each={exploreProjects()}>
                        {(p, i) => (
                          <Row active={highlight() === i() + 1} onHover={() => setHighlight(i() + 1)} onPick={() => pickById(p.id)}>
                            <ExploreAvatar p={p} />
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5">
                                <span class="text-[12.5px] font-semibold truncate">{p.name}</span>
                                <Show when={p.starred}><span class="text-amber-400 text-[10px]">&#9733;</span></Show>
                              </div>
                              <div class="text-[10.5px] text-text-muted truncate font-mono">{p.pathWithNamespace}</div>
                            </div>
                            <Show when={props.projectFilter() === p.id}><span class="text-accent text-[12px]">&#10003;</span></Show>
                          </Row>
                        )}
                      </For>
                      <Show when={exploreProjects().length === 0}>
                        <p class="text-[12.5px] text-text-muted text-center py-8">No repos match "{query()}"</p>
                      </Show>
                    </Show>
                  </Show>
                </Show>
              </div>

              {/* Footer */}
              <div class="flex items-center gap-3 px-4 py-2 border-t border-border text-[10.5px] text-text-muted">
                <span><kbd class="font-mono">&#8593;&#8595;</kbd> navigate</span>
                <span><kbd class="font-mono">&#8629;</kbd> select</span>
                <span><kbd class="font-mono">tab</kbd> switch</span>
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

function TabBtn(props: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      class={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors ${
        props.active ? 'bg-accent/10 text-accent border border-accent/20' : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
      }`}
      onClick={props.onClick}
    >
      {props.label}
      <Show when={props.count > 0}>
        <span class={`ml-1 text-[10px] ${props.active ? 'text-accent' : 'text-text-muted'}`}>({props.count})</span>
      </Show>
    </button>
  );
}

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

function BoardProjectAvatar(props: { p: BoardProject }) {
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

function ExploreAvatar(props: { p: WorkspaceProject }) {
  return (
    <Show when={props.p.avatarUrl} fallback={
      <span class="w-7 h-7 rounded-md grid place-items-center text-[11px] bg-surface-2 text-text-muted flex-none font-mono">
        {props.p.name[0]?.toLowerCase()}
      </span>
    }>
      <img src={props.p.avatarUrl} class="w-7 h-7 rounded-md flex-none" alt="" />
    </Show>
  );
}

function GroupNode(props: {
  group: WorkspaceGroup; depth: number; expanded: Set<string>;
  onToggle: (p: string) => void; onPick: (id: number | null) => void;
  projectFilter: Accessor<number | null>;
}) {
  const isExp = () => props.expanded.has(props.group.fullPath);
  const hasKids = () => (props.group.subgroups?.length ?? 0) > 0 || (props.group.projects?.length ?? 0) > 0;
  return (
    <div style={{ "padding-left": `${props.depth * 12}px` }}>
      <button class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2 transition-colors text-left"
        onClick={() => props.onToggle(props.group.fullPath)}>
        <span class={`text-[11px] text-text-muted transition-transform ${isExp() ? 'rotate-90' : ''}`}>
          {hasKids() ? '\u25B8' : ' '}
        </span>
        <Show when={props.group.avatarUrl} fallback={
          <span class="w-6 h-6 rounded-md grid place-items-center text-[11px] bg-indigo-500/10 text-indigo-400 flex-none font-semibold">
            {props.group.name[0]?.toUpperCase()}
          </span>
        }>
          <img src={props.group.avatarUrl} class="w-6 h-6 rounded-md flex-none" alt="" />
        </Show>
        <span class="text-[12.5px] font-semibold truncate">{props.group.name}</span>
        <span class="text-[10px] text-text-muted font-mono ml-1">{props.group.fullPath}</span>
        <a class="ml-auto w-5 h-5 grid place-items-center rounded text-text-muted hover:text-[#FC6D26] transition-colors"
          href={props.group.webUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
          <GitLabIcon class="w-3.5 h-3.5" />
        </a>
      </button>
      <Show when={isExp()}>
        <For each={props.group.subgroups}>
          {sg => <GroupNode group={sg} depth={props.depth + 1} expanded={props.expanded}
            onToggle={props.onToggle} onPick={props.onPick} projectFilter={props.projectFilter} />}
        </For>
        <div style={{ "padding-left": `${(props.depth + 1) * 12}px` }}>
          <For each={props.group.projects}>
            {p => (
              <Row active={false} onHover={() => {}} onPick={() => props.onPick(p.id)}>
                <ExploreAvatar p={p} />
                <div class="min-w-0 flex-1">
                  <span class="text-[12.5px] font-semibold truncate">{p.name}</span>
                  <Show when={p.starred}><span class="text-amber-400 text-[10px] ml-1">&#9733;</span></Show>
                  <div class="text-[10.5px] text-text-muted truncate font-mono">{p.pathWithNamespace}</div>
                </div>
                <Show when={props.projectFilter() === p.id}><span class="text-accent text-[12px]">&#10003;</span></Show>
              </Row>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
