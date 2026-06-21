// Mission Control — the unified AgentOps cockpit.
//
// One screen. The GitLab group's agent work board IS the home: each column is a
// stage in the agent state machine (planning → todo → in-progress → review →
// approved), each card a unit of work fused with the AgentRun executing it.
// Selecting a card docks a right-hand COCKPIT whose Conversation tab embeds the
// live agent chat (the issue thread and the agent stream are the same surface),
// alongside Plan / Trace / Diff & Gate.
//
//   ┌──────┬───────────────────────────────────┬───────────────┐
//   │Fleet │  Board (agent-lane kanban)         │  Cockpit dock │
//   │ rail │  ▓ planning ▓ todo ▓ in-progress…  │  stepper+tabs │
//   └──────┴───────────────────────────────────┴───────────────┘
//
// This is a standalone full-bleed shell (h-dvh) — it does not reuse the chat
// MainApp frame, so the background fills the viewport. The embedded <ChatView/>
// binds to the globally-selected agent, which the cockpit sets on open.
import {
  createResource,
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
  type Accessor,
  type Resource,
} from 'solid-js';
import { Portal, Dynamic } from 'solid-js/web';
import { A, useNavigate } from '@solidjs/router';

import { gitlabGroup, integrations, channels, agentRuns } from '../lib/api';
import type { DispatchResponse } from '../lib/api';
import { selectAgent, selectedAgent, agentList } from '../stores/agents';
import { currentUser, isAuthenticated, isAuthDisabled, login, logout } from '../stores/auth';
import { setComposerSeed, streaming } from '../stores/chat';
import { showTraceDetail, clearCenterOverlay } from '../stores/view';
import { onResourceChanged, onBoardChanged } from '../stores/events';
import { relativeTime, phaseVariant, formatTokens } from '../lib/format';
import Badge from '../components/shared/Badge';
import Spinner from '../components/shared/Spinner';
import { GitLabIcon } from '../components/shared/Icons';
import Markdown from '../components/shared/Markdown';
import RunOutcome from '../components/shared/RunOutcome';
import DiffCard from '../components/tools/DiffCard';
import ChatView from '../components/chat/ChatView';
import TraceDetailView from '../components/traces/TraceDetailView';
import AppErrorBoundary from '../components/shared/ErrorBoundary';
import WorkspaceBrowser from '../components/shared/WorkspaceBrowser';
import PlanRefinement from '../components/shared/PlanRefinement';
import NewPlanModal from '../components/shared/NewPlanModal';
import type {
  AgentRunOutcome,
  AgentRunArtifact,
  GitGroupIssue,
  GitLabProject,
  GitLabel,
  GitMember,
  GitNote,
  GitJob,
  GitPipeline,
  GroupRunJoin,
  GroupProjectPipelineHealth,
  GitMilestone,
  IntegrationResource,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// State machine → lanes. `accent` drives the lane glow + card progress fill.
// ─────────────────────────────────────────────────────────────────────────────
interface ColumnDef {
  label: string;
  title: string;
  accent: string;
  glyph: string;
  state?: string; // GitLab issue state filter (Approved is closed → 'all')
  // trigger === a gitlab-label bridge fires the implementer agent the instant a
  // card lands on this label (then moves it to in-progress). Dropping a card
  // here is therefore a real dispatch, not just a status change.
  trigger?: boolean;
}

const COLUMNS: ColumnDef[] = [
  { label: 'agent::planning', title: 'Planning', accent: '#a855f7', glyph: '✎' },
  { label: 'agent::todo', title: 'Todo', accent: '#71717a', glyph: '◷', trigger: true },
  { label: 'agent::in-progress', title: 'In Progress', accent: '#3b82f6', glyph: '⚙' },
  // Needs Review & Changes use state:'all': merging an MR auto-closes its linked
  // issue ("Closes #N"), so a card can be CLOSED while still labelled
  // needs-review/changes-requested (e.g. merged via CLI/GitLab UI, or the
  // bridge promoted it and a human merged). state:'opened' would make it vanish
  // from the board entirely; state:'all' keeps it visible until relabelled.
  { label: 'agent::needs-review', title: 'Needs Review', accent: '#eab308', glyph: '⌁', state: 'all' },
  { label: 'agent::changes-requested', title: 'Changes', accent: '#ef4444', glyph: '↺', trigger: true, state: 'all' },
  { label: 'agent::approved', title: 'Approved', accent: '#22c55e', glyph: '✓', state: 'all' },
];

const LAST_STATE = COLUMNS.length - 1;

type CockpitTab = 'conversation' | 'plan' | 'trace' | 'gate';

// The five center views the switcher toggles between. "board" is the live
// drag-and-drop kanban (the spine); the rest are ported observability views.
type CenterView = 'board' | 'overview' | 'mrs' | 'issues' | 'cicd';

interface WsCtx {
  ns: string;
  intg: string;
  // Display label: the group path (group) or the project path (single project).
  group: string;
  // Workspace kind — board logic that differs (e.g. degenerate RepoSwitcher) branches on this.
  kind: 'gitlab-group' | 'gitlab-project';
  // Single-project workspaces pin to exactly this project path (the board shows only it).
  projectPath?: string;
}
interface FleetMember {
  ns: string;
  name: string;
  mode: string;        // task | daemon
  model: string;
  role: string;        // inferred role label (PM, Coder, CI Watcher, …)
  active: number;      // runs in flight
  total: number;       // runs seen on this board
  phase: string;
  latest: string;
}

// An autonomous-agent escalation: a moment a human is required. Surfaced on the
// fleet rail as a badge on the owning agent. The default CI-fix budget must
// match the BFF's defaultCIFixBudget (dispatch.go) so the UI and guardrail agree.
const CI_FIX_BUDGET = 2;
interface Escalation {
  kind: 'ci-blocked';
  iid: string;
  project?: string;
  mrIID: number;
  agentNs: string;
  agentName: string;
  reason: string;
}

type CockpitTarget =
  | { kind: 'card'; issue: GitGroupIssue }
  | { kind: 'mr'; projectId: number; mrIID: number; title: string; web_url?: string }
  | { kind: 'compose'; ns: string; name: string; title: string; kicker: string };

// ── run ↔ card join (mirrors the workspace join) ────────────────────────────
function joinMatchesProject(j: GroupRunJoin, proj: GitLabProject | undefined, projectId: number): boolean {
  if (!j.project) return true;
  if (j.project === String(projectId)) return true;
  if (proj && (j.project === proj.path_with_namespace || j.project === proj.path)) return true;
  return false;
}
function joinActive(j: GroupRunJoin | undefined): boolean {
  const p = j?.phase;
  return p === 'Running' || p === 'Active' || p === 'Pending' || p === 'Queued';
}
function joinOutcome(j: GroupRunJoin): AgentRunOutcome {
  return {
    intent: j.intent,
    summary: j.summary,
    artifacts: (j.artifacts ?? []).map((a) => ({
      kind: a.kind as AgentRunArtifact['kind'], url: a.url, ref: a.ref, title: a.title,
    })),
  };
}
function stateIndex(labels?: string[]): number {
  let idx = -1;
  for (const l of labels ?? []) {
    const i = COLUMNS.findIndex((c) => c.label === l);
    if (i > idx) idx = i;
  }
  return idx;
}

// ── Agent role catalog (report §12.1) ────────────────────────────────────────
// Infer a human role from the agent name so the fleet popover reads as a role
// catalog (PM, Coder, CI Watcher, …) rather than an opaque agent list. This is a
// display hint only — dispatch still targets the real agentRef. Heuristic by
// design: agents are user-named, so we match common substrings and fall back to
// the raw name.
function roleForAgent(name: string): string {
  const n = name.toLowerCase();
  // Order matters — most specific first (e.g. release-mgr before generic
  // 'manager', ci-fixer before generic 'ci').
  if (n.includes('chart') || n.includes('helm')) return 'Chart Author';
  if (n.includes('flux') || n.includes('rollout') || n.includes('deploy')) return 'Flux / Rollout';
  if (n.includes('verif')) return 'Verifier';
  if (n.includes('release')) return 'Release Manager';
  if (n.includes('fix')) return 'CI Fixer';
  if (n.includes('test')) return 'Test Fixer';
  if (n.includes('review')) return 'Reviewer';
  if (n.includes('observ') || n.includes('trace') || n.includes('metric')) return 'Observability';
  if (n.includes('sre') || n.includes('cluster') || n.includes('health') || n.includes('incident')) return 'SRE / Cluster';
  if (n.includes('security') || n.includes('sec')) return 'Security';
  if (n.includes('docs') || n.includes('doc')) return 'Docs';
  if (n.includes('architect')) return 'Architect';
  if (n.includes('watch')) return 'CI Watcher';
  // 'ci' alone is ambiguous — only match as a word-ish boundary after specifics.
  if (/\bci\b/.test(n) || n.includes('-ci-') || n.endsWith('-ci')) return 'CI Watcher';
  if (n.includes('pm') || n.includes('manager') || n.includes('planner') || n.includes('lead')) return 'PM / Planner';
  if (n.includes('cod') || n.includes('dev') || n.includes('impl')) return 'Coder';
  return 'Agent';
}

// ── Drag & drop helpers ──────────────────────────────────────────────────────
// A card's identity on the board: the (project, iid) pair is globally unique.
function issueKey(i: { project_id: number; iid: number }): string {
  return `${i.project_id}#${i.iid}`;
}
// The card's current lane = its highest-state agent:: label (mirrors stateIndex).
function currentAgentLabel(labels?: string[]): string | null {
  let idx = -1;
  let found: string | null = null;
  for (const l of labels ?? []) {
    const i = COLUMNS.findIndex((c) => c.label === l);
    if (i > idx) { idx = i; found = l; }
  }
  return found;
}
// A shallow copy of the issue with exactly one agent:: label (the target),
// preserving any non-agent labels — used for the optimistic overlay.
function withAgentLabel(issue: GitGroupIssue, toLabel: string): GitGroupIssue {
  const kept = (issue.labels ?? []).filter((l) => !l.startsWith('agent::'));
  return { ...issue, labels: [...kept, toLabel] };
}
// One in-flight optimistic move: the dragged card + the lane it's headed to.
interface OptimisticMove { issue: GitGroupIssue; to: string }

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function MissionControl() {
  const navigate = useNavigate();

  // Board workspaces: a gitlab-group (many projects) OR a single gitlab-project.
  // Both are first-class — the BFF re-scopes the read routes by integration kind.
  // Deduplicate by group/project path (factory may create multiple Integrations
  // for the same scope with different token roles).
  const [allGroups] = createResource(() => integrations.gitlabWorkspaces());
  const groups = createMemo(() => {
    const all = allGroups() ?? [];
    const seen = new Set<string>();
    const deduped: typeof all = [];
    for (const g of all) {
      const key = g.spec.gitlabGroup?.group || g.spec.gitlab?.project || g.metadata.name;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(g);
      }
    }
    return deduped;
  });
  const [selected, setSelected] = createSignal<IntegrationResource | null>(null);

  // Auto-select the first Ready workspace so the deck is live on arrival.
  createEffect(() => {
    if (selected()) return;
    const list = groups();
    if (list.length === 0) return;
    setSelected(list.find((g) => g.status?.phase === 'Ready') ?? list[0]);
  });

  const ctx = createMemo<WsCtx | null>(() => {
    const i = selected();
    if (!i) return null;
    const isProject = i.spec.kind === 'gitlab-project';
    return {
      ns: i.metadata.namespace,
      intg: i.metadata.name,
      group: (isProject ? i.spec.gitlab?.project : i.spec.gitlabGroup?.group) ?? i.metadata.name,
      kind: isProject ? 'gitlab-project' : 'gitlab-group',
      projectPath: isProject ? i.spec.gitlab?.project : undefined,
    };
  });

  const [projects] = createResource(ctx, (c) => gitlabGroup.projects(c.ns, c.intg, { per_page: 100 }));
  const projectsById = createMemo(() => {
    const m = new Map<number, GitLabProject>();
    for (const p of projects() ?? []) m.set(p.id, p);
    return m;
  });

  // ── Observability data for the ported center views (Overview / MRs / Issues /
  // CI/CD). These hit the group-scoped read routes and feed the same WsCtx the
  // board already uses, so no API changes are needed. Pipelines/milestones power
  // the Overview + CI/CD dashboards; labels/members feed the list filters.
  const [labels] = createResource(ctx, (c) => gitlabGroup.labels(c.ns, c.intg));
  const [members] = createResource(ctx, (c) => gitlabGroup.members(c.ns, c.intg));
  const [pipelines, { refetch: refetchPipelines }] = createResource(ctx, (c) => gitlabGroup.pipelines(c.ns, c.intg));
  const [milestones] = createResource(ctx, (c) => gitlabGroup.milestones(c.ns, c.intg, { state: 'active' }));
  // project id → latest pipeline health (navigator dots + CI/CD dashboards).
  const pipelineByProject = createMemo(() => {
    const m = new Map<number, GroupProjectPipelineHealth>();
    for (const h of pipelines() ?? []) m.set(h.project_id, h);
    return m;
  });

  // Server-side run↔card join — the live nervous system of the board.
  const [joins, { refetch: refetchRuns }] = createResource(ctx, (c) => gitlabGroup.runs(c.ns, c.intg));
  const joinsByIID = createMemo(() => {
    const idx = new Map<string, GroupRunJoin[]>();
    for (const j of joins() ?? []) {
      const arr = idx.get(j.iid) ?? [];
      arr.push(j); idx.set(j.iid, arr);
    }
    return idx;
  });
  function resolveRun(projectId: number, iid: number): GroupRunJoin | undefined {
    const cands = joinsByIID().get(String(iid)) ?? [];
    const proj = projectsById().get(projectId);
    return cands
      .filter((j) => joinMatchesProject(j, proj, projectId))
      .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))[0];
  }

  // Fleet / role catalog: start from EVERY agent in the cluster (so idle
  // specialists like ci-watcher / pr-reviewer surface even with zero board
  // runs), then overlay live load from the run joins. This is the report's
  // role-catalog + capacity surface (§12.1).
  const fleet = createMemo<FleetMember[]>(() => {
    const m = new Map<string, FleetMember>();
    // Seed from the full agent list.
    for (const a of agentList() ?? []) {
      const key = `${a.namespace}/${a.name}`;
      m.set(key, {
        ns: a.namespace, name: a.name,
        mode: a.mode, model: a.model, role: roleForAgent(a.name),
        active: 0, total: 0,
        phase: a.phase || 'Idle', latest: '',
      });
    }
    // Overlay run workload from the joins.
    for (const j of joins() ?? []) {
      if (!j.agentRef) continue;
      const key = `${j.namespace}/${j.agentRef}`;
      const cur = m.get(key) ?? {
        ns: j.namespace, name: j.agentRef,
        mode: 'task', model: '', role: roleForAgent(j.agentRef),
        active: 0, total: 0, phase: 'Idle', latest: '',
      };
      cur.total++;
      if (joinActive(j)) cur.active++;
      if ((j.created ?? '') > cur.latest) { cur.latest = j.created ?? ''; cur.phase = j.phase || cur.phase; }
      m.set(key, cur);
    }
    // Active first, then busiest, then alphabetical.
    return [...m.values()].sort((a, b) =>
      b.active - a.active || b.total - a.total || a.name.localeCompare(b.name));
  });

  // ── Escalations are defined after pmDaemon (below), which they depend on. ──

  // ── Filters ──
  const [search, setSearch] = createSignal('');
  const [projectFilter, setProjectFilter] = createSignal<number | null>(null);
  // For a single-project workspace, auto-pin on initial load only (not on every
  // re-render) so the user can still clear the filter via the browser pill.
  let singleProjectPinned = false;
  createEffect(() => {
    if (ctx()?.kind !== 'gitlab-project') { singleProjectPinned = false; return; }
    if (singleProjectPinned) return;
    const only = (projects() ?? [])[0];
    if (only) { setProjectFilter(only.id); singleProjectPinned = true; }
  });
  // List-only filters (consumed by the ported MRs/Issues views, mirroring the
  // old workspace). The board ignores these — it filters by lane + search only.
  const [labelFilter, setLabelFilter] = createSignal('');
  const [authorFilter, setAuthorFilter] = createSignal('');

  // ── Center-view switcher ─────────────────────────────────────────────────
  // The center region hosts one of five views. "board" is the live drag-and-drop
  // kanban (the spine, default); the other four are ported from the old GitLab
  // workspace. Detail for every view is routed through the ONE docked Cockpit —
  // there is no second slide-over drawer.
  const [view, setView] = createSignal<CenterView>('board');

  // Channels in play. The gitlab-label bridge fires its agent the instant a
  // card lands on a trigger label — so we surface WHO will run when a card is
  // dropped on Todo / Changes (honest affordance, real agentRef).
  const [chans] = createResource(() => channels.list());
  const dispatchAgent = createMemo(() =>
    (chans() ?? []).find((c) => c.spec.type === 'gitlab-label')?.spec.agentRef ?? null);

  // The conversational PM for this board: the daemon agent that DRIVES card
  // execution. Card runs are executed by ephemeral TASK agents (e.g. lab-coder,
  // a Job that exits), whose /prompt endpoint is gone once finished — so a
  // follow-up conversation (incl. requesting changes) must target the long-lived
  // daemon that can re-delegate. We PREFER the gitlab-label board channel's
  // daemon (the orchestrator/implementer-PM, e.g. lab-pm) over the gitlab-comment
  // planner: the planner only authors plans and is barred from moving board
  // labels, so it can't re-engage the coder. Null when no daemon-backed channel
  // exists, in which case the cockpit falls back to the run's own agent.
  const pmDaemon = createMemo<{ ns: string; name: string } | null>(() => {
    const list = agentList() ?? [];
    const isDaemon = (ns: string, name: string) =>
      list.some((a) => a.namespace === ns && a.name === name && a.mode === 'daemon');
    const cs = chans() ?? [];
    // Priority: the board's work driver (gitlab-label) first, planner last.
    const byType = [
      ...cs.filter((c) => c.spec.type === 'gitlab-label'),
      ...cs.filter((c) => c.spec.type === 'gitlab-comment'),
    ];
    for (const c of byType) {
      const ref = c.spec.agentRef;
      const ns = c.metadata.namespace;
      if (ref && isDaemon(ns, ref)) return { ns, name: ref };
    }
    return null;
  });

  // ── Escalations: the dark-factory "needs human" signal ───────────────────
  // Agents run autonomously; the UI's job is to surface the few moments a human
  // is required. First escalation source: a work item whose MR pipeline is red
  // AND whose CI-fix retry budget is spent (ciFixAttempts >= budget) — the loop
  // gave up and the card needs attention. Attributed to the board's daemon PM
  // (the supervisor you'd command), so its fleet-rail entry flags red. Declared
  // after pmDaemon because it reads it. Future sources (drift, prod-gate, failed
  // rollout) append here as those agents come online.
  const escalations = createMemo<Escalation[]>(() => {
    const out: Escalation[] = [];
    const pm = pmDaemon();
    for (const j of joins() ?? []) {
      const mr = j.mr;
      if (!mr) continue;
      const ciRed = mr.pipelineStatus === 'failed' || mr.pipelineStatus === 'canceled';
      if (ciRed && (j.ciFixAttempts ?? 0) >= CI_FIX_BUDGET) {
        out.push({
          kind: 'ci-blocked',
          iid: j.iid,
          project: j.project,
          mrIID: mr.iid,
          agentNs: pm?.ns ?? j.namespace,
          agentName: pm?.name ?? j.agentRef,
          reason: `CI fix budget exhausted on MR !${mr.iid} (issue #${j.iid})`,
        });
      }
    }
    return out;
  });
  // agent "ns/name" → count of open escalations (drives the rail badge).
  const escalationsByAgent = createMemo(() => {
    const m = new Map<string, number>();
    for (const e of escalations()) {
      const k = `${e.agentNs}/${e.agentName}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  });

  // ── Cockpit ──
  const [cockpit, setCockpit] = createSignal<CockpitTarget | null>(null);
  const [tab, setTab] = createSignal<CockpitTab>('conversation');
  function openCard(issue: GitGroupIssue) {
    setCockpit({ kind: 'card', issue });
    // Open the lane-appropriate default tab based on the card's state.
    const idx = stateIndex(issue.labels);
    switch (idx) {
      case 0: setTab('plan'); break;           // Planning → Plan Refinement
      case 1: setTab('plan'); break;           // Todo → read-only plan
      case 2: setTab('conversation'); break;   // In Progress → live stream
      case 3: setTab('gate'); break;           // Needs Review → code review
      case 4: setTab('conversation'); break;   // Changes → feedback
      case 5: setTab('gate'); break;           // Approved → merge
      default: setTab('conversation');
    }
  }
  // Drop onto Approved lands the human at the merge gate (relabel already done).
  function openCardAtGate(issue: GitGroupIssue) { setCockpit({ kind: 'card', issue }); setTab('gate'); }
  // Open the Cockpit's Gate directly on a raw merge request (from the MRs view).
  // The card path derives its MR from an issue's run artifacts; this variant
  // pins (project, mrIID) explicitly so an MR with no linked issue still reviews.
  function openMR(projectId: number, mrIID: number, title: string, web_url?: string) {
    setCockpit({ kind: 'mr', projectId, mrIID, title, web_url });
    setTab('gate');
  }
  // Pick an agent from the fleet rail → dock its board-wide conversation. For a
  // daemon (a supervisor like lab-pm) this is the global command channel; task
  // agents open a direct chat (their pod may be ephemeral, so it's best-effort).
  function openAgentChat(ns: string, name: string) {
    selectAgent(ns, name);
    const a = (agentList() ?? []).find((x) => x.namespace === ns && x.name === name);
    const kicker = a?.mode === 'daemon' ? 'Supervisor · board-wide' : 'Direct chat';
    setCockpit({ kind: 'compose', ns, name, title: name, kicker });
    setTab('conversation');
  }
  function closeCockpit() { setCockpit(null); }
  // The agent currently docked (compose mode) → highlighted in the fleet rail.
  const selectedAgentKey = createMemo<string | null>(() => {
    const c = cockpit();
    return c?.kind === 'compose' ? `${c.ns}/${c.name}` : null;
  });

  // ── New Plan: seed the planner daemon + dock the cockpit in compose mode ──
  const [startingPlan, setStartingPlan] = createSignal(false);
  const [planErr, setPlanErr] = createSignal<string | null>(null);
  // ── New Plan: creates a GitLab issue with agent::planning label ──
  const [showNewPlan, setShowNewPlan] = createSignal(false);

  async function startNewPlan() {
    setShowNewPlan(true);
  }

  // Board refresh tick: GitLab label moves (a card going to in-progress, the
  // bridge promoting to needs-review, the operator/agent relabelling) fire NO
  // K8s SSE event, so onResourceChanged can't see them. Bumping this tick on a
  // visibility-gated poll + on focus forces every lane to re-pull GitLab so the
  // board reflects label changes that happen outside this tab.
  const [boardTick, setBoardTick] = createSignal(0);

  // Live: refetch the run join whenever K8s resources change. GitLab-side state
  // (issue labels, CI) has no K8s event, so:
  //   • board label moves arrive in real time via NATS->SSE (onBoardChanged),
  //     pushed by the gitlab-label bridge — this is the primary, instant path.
  //   • a slow visibility-gated poll + a focus refetch act only as a safety net
  //     (e.g. if NATS is down, or for CI/pipeline freshness which has no event).
  onMount(() => {
    const unsub = onResourceChanged(() => { if (ctx()) refetchRuns(); });
    // Primary: a board_changed event = a card moved column. Refresh runs + the
    // affected lanes immediately. (Bumping boardTick re-pulls every lane; cheap
    // and guarantees the moved-from and moved-to lanes both reconcile.)
    const unsubBoard = onBoardChanged(() => {
      if (!ctx()) return;
      refetchRuns();
      setBoardTick((t) => t + 1);
    });
    const refresh = () => {
      if (!ctx() || document.visibilityState !== 'visible') return;
      refetchRuns();
      refetchPipelines();
      setBoardTick((t) => t + 1);
    };
    // Safety net only — real-time updates come from onBoardChanged above.
    const poll = window.setInterval(refresh, 30_000);
    const onFocus = () => refresh();
    const onVis = () => { if (!document.hidden) refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    onCleanup(() => {
      unsub();
      unsubBoard();
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    });
  });

  const activeRuns = createMemo(() => (joins() ?? []).filter((j) => joinActive(j)).length);

  return (
    <div class="mc-shell h-dvh flex flex-col text-text overflow-hidden">
      <TopBar
        groups={groups}
        selected={selected}
        onSelectGroup={(g) => { setSelected(g); setProjectFilter(null); closeCockpit(); }}
        ctx={ctx}
        projects={projects}
        projectFilter={projectFilter}
        onProjectFilter={setProjectFilter}
        search={search}
        onSearch={setSearch}
        view={view}
        onView={setView}
        labels={labels}
        members={members}
        labelFilter={labelFilter}
        onLabelFilter={setLabelFilter}
        authorFilter={authorFilter}
        onAuthorFilter={setAuthorFilter}
        activeRuns={activeRuns}
        startingPlan={startingPlan}
        planErr={planErr}
        onNewPlan={startNewPlan}
        onSync={() => { refetchRuns(); refetchPipelines(); }}
      />

      {/* New Plan modal */}
      <Show when={ctx()}>
        <NewPlanModal
          open={showNewPlan}
          onClose={() => setShowNewPlan(false)}
          ctx={{ ns: ctx()!.ns, intg: ctx()!.intg }}
          projects={() => projects()}
          plannerAgent={pmDaemon()?.name ?? 'samyn92-lab-planner'}
          onCreated={() => { setShowNewPlan(false); setBoardTick(t => t + 1); }}
        />
      </Show>

      <Show
        when={ctx()}
        fallback={
          <div class="flex-1 grid place-items-center text-text-muted text-sm">
            <Show when={!groups.loading} fallback={<Spinner />}>
              <div class="text-center max-w-md">
                <p class="text-3xl mb-3">⬡</p>
                <p class="mb-1">No board <code class="text-accent">gitlab-group</code> or <code class="text-accent">gitlab-project</code> integration is ready yet.</p>
                <p class="text-xs">Create a Ready Integration of kind <code>gitlab-group</code> (a whole group) or <code>gitlab-project</code> (a single repo) to light up the deck.</p>
              </div>
            </Show>
          </div>
        }
      >
        <div class="flex-1 flex min-h-0">
          {/* Left fleet rail — the command column: supervisor agents (lab-pm and
              future cluster-bound observability/testing/flux agents) + the task
              workers they delegate to. Click an agent to dock its board-wide
              conversation; escalation badges flag when an autonomous agent needs
              a human. */}
          <FleetRail
            fleet={fleet}
            escalationsByAgent={escalationsByAgent}
            selectedAgentKey={selectedAgentKey}
            onPick={openAgentChat}
          />

          {/* Center region — the view switcher selects ONE of five center views.
              The board (default) keeps its full drag-and-drop behavior untouched;
              the ported observability views render in the same slot. Detail for
              every view is routed through the single docked Cockpit (right). */}
          <Show when={view() === 'board'}>
            <AppErrorBoundary name="Board">
              <Board
                ctx={ctx()!}
                search={search}
                projectFilter={projectFilter}
                resolveRun={resolveRun}
                projectsById={projectsById}
                selectedIssue={() => { const c = cockpit(); return c?.kind === 'card' ? c.issue : null; }}
                onOpen={openCard}
                onOpenGate={openCardAtGate}
                onMoved={() => refetchRuns()}
                dispatchAgent={dispatchAgent}
                refreshTick={boardTick}
              />
            </AppErrorBoundary>
          </Show>

          <Show when={view() === 'overview'}>
            <div class="flex-1 min-w-0 overflow-auto">
              <AppErrorBoundary name="Overview">
                <OverviewTabView
                  ctx={ctx()!}
                  projectFilter={projectFilter}
                  projects={projects}
                  milestones={milestones}
                  pipelines={pipelines}
                  joins={joins}
                  projectsById={projectsById}
                  onSelectProject={setProjectFilter}
                  onOpenView={setView}
                  onOpenTrace={(t) => { showTraceDetail(t); navigate('/'); }}
                />
              </AppErrorBoundary>
            </div>
          </Show>

          <Show when={view() === 'mrs'}>
            <div class="flex-1 min-w-0 overflow-auto">
              <AppErrorBoundary name="Merge Requests">
                <MergeRequestList
                  ctx={ctx()!}
                  projectFilter={projectFilter}
                  search={search}
                  author={authorFilter}
                  labelFilter={labelFilter}
                  projectsById={projectsById}
                  resolveRun={resolveRun}
                  onOpen={openMR}
                />
              </AppErrorBoundary>
            </div>
          </Show>

          <Show when={view() === 'issues'}>
            <div class="flex-1 min-w-0 overflow-auto">
              <AppErrorBoundary name="Issues">
                <IssueList
                  ctx={ctx()!}
                  projectFilter={projectFilter}
                  search={search}
                  author={authorFilter}
                  labelFilter={labelFilter}
                  projectsById={projectsById}
                  resolveRun={resolveRun}
                  onOpen={openCard}
                />
              </AppErrorBoundary>
            </div>
          </Show>

          <Show when={view() === 'cicd'}>
            <div class="flex-1 min-w-0 overflow-auto">
              <AppErrorBoundary name="CI/CD">
                <CICDTabView
                  ctx={ctx()!}
                  projectFilter={projectFilter}
                  pipelines={pipelines}
                  pipelinesLoading={() => pipelines.loading}
                  onBack={() => setProjectFilter(null)}
                />
              </AppErrorBoundary>
            </div>
          </Show>

          <Show when={cockpit()}>
            <Cockpit
              ctx={ctx()!}
              target={cockpit()!}
              tab={tab}
              onTab={setTab}
              resolveRun={resolveRun}
              projectsById={projectsById}
              pmDaemon={pmDaemon}
              defaultFixAgent={dispatchAgent()}
              onClose={closeCockpit}
              onMoved={() => refetchRuns()}
              onOpenTrace={(t) => { showTraceDetail(t); navigate('/'); }}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top bar
// ─────────────────────────────────────────────────────────────────────────────
function TopBar(props: {
  groups: () => IntegrationResource[] | undefined;
  selected: Accessor<IntegrationResource | null>;
  onSelectGroup: (g: IntegrationResource | null) => void;
  ctx: Accessor<WsCtx | null>;
  projects: () => GitLabProject[] | undefined;
  projectFilter: Accessor<number | null>;
  onProjectFilter: (id: number | null) => void;
  search: Accessor<string>;
  onSearch: (v: string) => void;
  view: Accessor<CenterView>;
  onView: (v: CenterView) => void;
  labels: Resource<GitLabel[]>;
  members: Resource<GitMember[]>;
  labelFilter: Accessor<string>;
  onLabelFilter: (v: string) => void;
  authorFilter: Accessor<string>;
  onAuthorFilter: (v: string) => void;
  activeRuns: Accessor<number>;
  startingPlan: Accessor<boolean>;
  planErr: Accessor<string | null>;
  onNewPlan: () => void;
  onSync: () => void;
}) {
  return (
    <>
    <header class="flex items-center gap-3 px-4 h-14 flex-shrink-0 border-b border-border bg-surface/70 backdrop-blur">
      <div class="flex items-center gap-2 font-semibold">
        <span class="w-7 h-7 rounded-lg grid place-items-center text-white bg-gradient-to-br from-indigo-500 to-purple-500 text-[13px] shadow">◆</span>
        <span class="tracking-tight">Mission Control</span>
      </div>

      <div class="h-5 w-px bg-border mx-1" />

      {/* Unified scope selector: workspace + project in one pill */}
      <WorkspaceBrowser
        workspaces={props.groups}
        selected={props.selected}
        onSelectWorkspace={props.onSelectGroup}
        projectFilter={props.projectFilter}
        onSelectProject={props.onProjectFilter}
        boardProjects={() => props.projects()}
      />

      <Show when={props.ctx()}>
        <input
          class="bg-surface-2 border border-border-subtle rounded-lg px-2.5 py-1.5 text-[12.5px] w-44"
          placeholder="Search cards…"
          value={props.search()}
          onInput={(e) => props.onSearch(e.currentTarget.value)}
        />
      </Show>

      <div class="grow" />

      <Show when={props.activeRuns() > 0}>
        <span class="flex items-center gap-1.5 text-[12px] text-text-secondary">
          <span class="mc-live-dot w-2 h-2 rounded-full bg-blue-500" style={{ '--mc-accent': '#3b82f6' }} />
          {props.activeRuns()} live
        </span>
      </Show>

      <Show when={props.planErr()}>
        <span class="text-[11px] text-red-400 max-w-[14rem] truncate" title={props.planErr()!}>plan: {props.planErr()}</span>
      </Show>

      <Show when={props.ctx()}>
        <button
          class="text-[12.5px] font-medium rounded-lg px-3 py-1.5 bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow hover:opacity-90 transition disabled:opacity-50"
          disabled={props.startingPlan()}
          onClick={props.onNewPlan}
          title="Start a new plan — docks a chat with the planner agent"
        >
          {props.startingPlan() ? '…' : '✎ New Plan'}
        </button>
        <button
          class="text-sm px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface-2 hover:bg-surface-hover transition-colors"
          onClick={props.onSync}
          title="Re-fetch agent runs"
        >
          ⤓
        </button>
      </Show>

      <A
        href="/"
        class="text-[12.5px] text-text-muted hover:text-text px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors"
        title="Open the classic chat workspace"
      >
        Chat ↗
      </A>

      {/* Identity: who is acting in the console (OIDC) */}
      <Show when={!isAuthDisabled()}>
        <div class="h-5 w-px bg-border mx-0.5" />
        <Show
          when={isAuthenticated()}
          fallback={
            <button
              class="text-[12px] px-2.5 py-1.5 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
              onClick={() => login()}
            >
              Sign in
            </button>
          }
        >
          <button
            class="flex items-center gap-2 text-[12px] rounded-lg px-2 py-1 hover:bg-surface-hover transition-colors"
            onClick={() => logout()}
            title={`Signed in as ${currentUser()?.username} — click to sign out`}
          >
            <Show when={currentUser()?.avatarUrl}>
              <img src={currentUser()!.avatarUrl!} class="w-5 h-5 rounded-full" alt="" />
            </Show>
            <span class="font-medium text-text-secondary">{currentUser()?.username}</span>
          </button>
        </Show>
      </Show>
    </header>

    {/* Slim center-view switcher sub-bar — sits directly under the spine. The
        accent-underlined segments match Mission Control's `mc-step` tabs; the
        board stays the visually dominant default. The label/author selects only
        surface for the list views (Merge Requests / Issues), as in the old
        workspace; search lives in the header above and is shared by all views. */}
    <Show when={props.ctx()}>
      <div class="flex items-center gap-1 px-4 h-10 flex-shrink-0 border-b border-border bg-surface/40">
        <div class="flex items-center gap-1">
          <ViewTab active={props.view() === 'board'} onClick={() => props.onView('board')}>▦ Board</ViewTab>
          <ViewTab active={props.view() === 'overview'} onClick={() => props.onView('overview')}>◈ Overview</ViewTab>
          <ViewTab active={props.view() === 'mrs'} onClick={() => props.onView('mrs')}>⎇ Merge Requests</ViewTab>
          <ViewTab active={props.view() === 'issues'} onClick={() => props.onView('issues')}>◷ Issues</ViewTab>
          <ViewTab active={props.view() === 'cicd'} onClick={() => props.onView('cicd')}>⚙ CI/CD</ViewTab>
        </div>

        <Show when={props.view() === 'mrs' || props.view() === 'issues'}>
          <div class="h-4 w-px bg-border mx-1.5" />
          <select
            class="bg-surface-2 border border-border-subtle rounded-lg px-2 py-1 text-[12px] max-w-[10rem]"
            value={props.labelFilter()}
            onChange={(e) => props.onLabelFilter(e.currentTarget.value)}
          >
            <option value="">All labels</option>
            <For each={(props.labels() ?? []).filter((l: GitLabel) => !l.name.startsWith('agent::'))}>
              {(l) => <option value={l.name}>{l.name}</option>}
            </For>
          </select>
          <select
            class="bg-surface-2 border border-border-subtle rounded-lg px-2 py-1 text-[12px] max-w-[10rem]"
            value={props.authorFilter()}
            onChange={(e) => props.onAuthorFilter(e.currentTarget.value)}
          >
            <option value="">All authors</option>
            <For each={props.members()}>
              {(m: GitMember) => <option value={m.username}>{m.name || m.username}</option>}
            </For>
          </select>
        </Show>

        <div class="grow" />
      </div>
    </Show>
    </>
  );
}

// Center-view switcher segment — accent-underline tab in Mission Control's
// visual language (mirrors the cockpit's `mc-step` tabs, kept compact).
function ViewTab(props: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      onClick={props.onClick}
      class="mc-step px-2.5 py-2 text-[12.5px] font-semibold border-b-2 whitespace-nowrap transition-colors"
      classList={{ 'text-text border-accent': props.active, 'text-text-muted border-transparent hover:text-text-secondary': !props.active }}
    >
      {props.children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fleet rail (persistent left command column) — the "masters you command".
//
// The fleet of long-lived supervisor agents (lab-pm = delivery; future:
// observability/testing/flux agents bound to clusters) plus the task workers
// they delegate to. This is the COMMAND surface: click an agent to dock its
// board-wide conversation in the right cockpit, and watch escalation badges
// light up when an autonomous agent needs a human (the dark-factory signal).
// Collapses to a thin icon strip to reclaim space.
// ─────────────────────────────────────────────────────────────────────────────
function FleetRail(props: {
  fleet: Accessor<FleetMember[]>;
  escalationsByAgent: Accessor<Map<number, number> | Map<string, number>>;
  selectedAgentKey: Accessor<string | null>;
  onPick: (ns: string, name: string) => void;
}) {
  const [collapsed, setCollapsed] = createSignal(false);
  const activeTotal = createMemo(() => props.fleet().reduce((n, a) => n + a.active, 0));
  const escTotal = createMemo(() => {
    let n = 0;
    (props.escalationsByAgent() as Map<string, number>).forEach((v) => (n += v));
    return n;
  });
  // Supervisors (daemons) lead — they own a domain and are who you command.
  // Workers (task agents) follow — they execute delegated work.
  const supervisors = createMemo(() => props.fleet().filter((a) => a.mode === 'daemon'));
  const workers = createMemo(() => props.fleet().filter((a) => a.mode !== 'daemon'));
  const escFor = (a: FleetMember) =>
    (props.escalationsByAgent() as Map<string, number>).get(`${a.ns}/${a.name}`) ?? 0;

  return (
    <aside
      class="mc-fleet flex flex-col flex-none border-r border-border bg-surface/40 min-h-0 transition-[width] duration-150"
      classList={{ 'w-60': !collapsed(), 'w-12': collapsed() }}
    >
      {/* Header */}
      <div class="flex items-center gap-2 px-3 h-10 flex-none border-b border-border">
        <Show when={!collapsed()}>
          <span class="text-[11px] uppercase tracking-wider text-text-muted font-bold">Fleet</span>
          <Show when={escTotal() > 0}>
            <span class="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5" title={`${escTotal()} escalation${escTotal() === 1 ? '' : 's'} need attention`}>
              {escTotal()} ⚠
            </span>
          </Show>
          <Show when={escTotal() === 0 && activeTotal() > 0}>
            <span class="flex items-center gap-1 text-[10.5px] text-text-secondary">
              <span class="mc-live-dot w-1.5 h-1.5 rounded-full bg-blue-500" style={{ '--mc-accent': '#3b82f6' }} />{activeTotal()} live
            </span>
          </Show>
          <span class="ml-auto" />
        </Show>
        <button
          class="text-text-muted hover:text-text text-sm rounded-lg px-1.5 py-1 hover:bg-surface-hover transition-colors"
          classList={{ 'mx-auto': collapsed() }}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed() ? 'Expand fleet' : 'Collapse fleet'}
        >
          {collapsed() ? '»' : '«'}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto py-1.5">
        <Show
          when={props.fleet().length > 0}
          fallback={<Show when={!collapsed()}><p class="text-[11.5px] text-text-muted px-3 py-4 text-center">No agents in the cluster.</p></Show>}
        >
          <FleetGroup label="Supervisors" agents={supervisors()} collapsed={collapsed()} selectedKey={props.selectedAgentKey()} escFor={escFor} onPick={props.onPick} />
          <FleetGroup label="Workers" agents={workers()} collapsed={collapsed()} selectedKey={props.selectedAgentKey()} escFor={escFor} onPick={props.onPick} />
        </Show>
      </div>
    </aside>
  );
}

function FleetGroup(props: {
  label: string;
  agents: FleetMember[];
  collapsed: boolean;
  selectedKey: string | null;
  escFor: (a: FleetMember) => number;
  onPick: (ns: string, name: string) => void;
}) {
  return (
    <Show when={props.agents.length > 0}>
      <Show when={!props.collapsed}>
        <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-text-muted/70 font-bold">{props.label}</div>
      </Show>
      <For each={props.agents}>
        {(a) => {
          const esc = () => props.escFor(a);
          const selected = () => props.selectedKey === `${a.ns}/${a.name}`;
          return (
            <button
              class="w-full text-left flex items-center gap-2.5 transition-colors"
              classList={{
                'px-3 py-2 hover:bg-surface-hover': !props.collapsed,
                'px-0 py-1.5 justify-center hover:bg-surface-hover': props.collapsed,
                'bg-surface-hover': selected(),
              }}
              onClick={() => props.onPick(a.ns, a.name)}
              title={`${a.name} · ${a.role} · ${a.mode}${a.model ? ' · ' + a.model : ''}${esc() > 0 ? ` · ${esc()} escalation(s)` : ''}`}
            >
              <span class="relative flex-none">
                <span
                  class="w-7 h-7 rounded-md grid place-items-center text-[10px] font-extrabold text-white"
                  classList={{ 'mc-live-dot': a.active > 0, 'ring-2 ring-accent': selected() }}
                  style={{ background: a.active > 0 ? '#3b82f6' : 'linear-gradient(135deg,#6366f1,#a855f7)', '--mc-accent': '#3b82f6' }}
                >
                  {a.name.slice(0, 2).toUpperCase()}
                </span>
                {/* Escalation badge — the dark-factory "needs you" flag. */}
                <Show when={esc() > 0}>
                  <span class="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center leading-none ring-2 ring-surface">
                    {esc()}
                  </span>
                </Show>
              </span>
              <Show when={!props.collapsed}>
                <span class="min-w-0 flex-1">
                  <span class="block text-[12.5px] font-semibold truncate" classList={{ 'text-red-300': esc() > 0 }}>{a.name}</span>
                  <span class="block text-[10.5px] text-text-muted truncate">
                    {a.role}
                    <Show when={a.total > 0}><span>{` · ${a.active > 0 ? `${a.active} active` : `${a.total} run${a.total === 1 ? '' : 's'}`}`}</span></Show>
                  </span>
                </span>
                <Show when={esc() > 0} fallback={<Badge variant={a.active > 0 ? phaseVariant(a.phase) : 'muted'} dot={a.active > 0}>{a.active > 0 ? 'live' : (a.mode === 'daemon' ? 'on' : 'idle')}</Badge>}>
                  <Badge variant="error" dot>needs you</Badge>
                </Show>
              </Show>
            </button>
          );
        }}
      </For>
    </Show>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository switcher — GitLab-style pill + "/" command palette over the repos
// in scope of the group token. Selecting a repo scopes the board to it.
// ─────────────────────────────────────────────────────────────────────────────
function RepoSwitcher(props: {
  projects: () => GitLabProject[] | undefined;
  projectFilter: Accessor<number | null>;
  onSelect: (id: number | null) => void;
  group: () => string | undefined;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [highlight, setHighlight] = createSignal(0);
  let listEl: HTMLDivElement | undefined;

  const active = createMemo(() => {
    const id = props.projectFilter();
    return id == null ? null : (props.projects() ?? []).find((p) => p.id === id) ?? null;
  });

  // Recent-activity-first, then text filter across name / path / topics.
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = (props.projects() ?? []).slice()
      .sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''));
    if (!q) return list;
    return list.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.path_with_namespace.toLowerCase().includes(q) ||
      (p.topics ?? []).some((t) => t.toLowerCase().includes(q)));
  });
  const showAll = createMemo(() => query().trim() === '');
  const rowCount = createMemo(() => filtered().length + (showAll() ? 1 : 0));

  function openPalette() { setQuery(''); setHighlight(0); setOpen(true); }
  function close() { setOpen(false); }
  function activate(i: number) {
    if (showAll() && i === 0) { props.onSelect(null); close(); return; }
    const p = filtered()[showAll() ? i - 1 : i];
    if (p) { props.onSelect(p.id); close(); }
  }

  // Reset highlight when the result set shifts, and keep it in view.
  createEffect(() => { query(); setHighlight(0); });
  createEffect(() => {
    highlight();
    if (!open() || !listEl) return;
    (listEl.querySelector('[data-active="true"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  });

  // Global "/" opens the palette (unless typing in a field).
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

  function onPaletteKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, rowCount() - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(highlight()); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  return (
    <>
      <button
        class="repo-pill flex items-center gap-2 rounded-lg px-2.5 py-1.5 border border-border-subtle bg-surface-2 max-w-[18rem]"
        onClick={openPalette}
        title="Browse repositories in scope ( / )"
      >
        <span class="text-text-muted text-[13px]">⬡</span>
        <Show when={props.group()}>
          <span class="hidden md:inline text-[12px] text-text-muted truncate max-w-[8rem]">{props.group()}</span>
          <span class="hidden md:inline text-text-muted">/</span>
        </Show>
        <span class="text-[12.5px] font-semibold truncate">{active() ? active()!.name : 'All repositories'}</span>
        <kbd class="ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-subtle bg-surface text-text-muted leading-none">/</kbd>
      </button>

      <Show when={open()}>
        <Portal>
        <div class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4" onClick={close}>
          <div
            class="mc-palette w-full max-w-xl rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search */}
            <div class="flex items-center gap-2 px-3.5 py-3 border-b border-border">
              <span class="text-text-muted">⌕</span>
              <input
                ref={(el) => queueMicrotask(() => el.focus())}
                class="flex-1 bg-transparent outline-none text-[14px] placeholder:text-text-muted"
                placeholder="Search repositories…"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={onPaletteKey}
              />
              <Show when={props.projects()}>
                <span class="text-[11px] text-text-muted bg-surface-2 px-1.5 py-0.5 rounded-full">{filtered().length}</span>
              </Show>
              <kbd class="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-text-muted">esc</kbd>
            </div>

            {/* Results */}
            <div ref={listEl} class="max-h-[52vh] overflow-y-auto p-1.5">
              <Show when={props.projects()} fallback={<div class="grid place-items-center py-10"><Spinner size="sm" /></div>}>
                <Show when={showAll()}>
                  <PaletteRow
                    active={highlight() === 0}
                    onHover={() => setHighlight(0)}
                    onPick={() => activate(0)}
                  >
                    <span class="w-8 h-8 rounded-lg grid place-items-center text-[13px] text-text-muted bg-surface-2 flex-none">⬡</span>
                    <div class="min-w-0 flex-1">
                      <div class="text-[13px] font-semibold">All repositories</div>
                      <div class="text-[11px] text-text-muted truncate">Show work from every repo in the group</div>
                    </div>
                    <Show when={props.projectFilter() == null}><span class="text-accent text-[12px]">✓</span></Show>
                  </PaletteRow>
                </Show>

                <For each={filtered()}>
                  {(p, i) => {
                    const rowIdx = () => (showAll() ? i() + 1 : i());
                    return (
                      <PaletteRow
                        active={highlight() === rowIdx()}
                        onHover={() => setHighlight(rowIdx())}
                        onPick={() => activate(rowIdx())}
                      >
                        <RepoAvatar project={p} />
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="text-[13px] font-semibold truncate">{p.name}</span>
                            <Show when={p.archived}><span class="text-[9px] uppercase tracking-wide text-text-muted border border-border-subtle rounded px-1 py-px">archived</span></Show>
                            <Show when={p.visibility && p.visibility !== 'public'}><span class="text-[10px] text-text-muted" title={p.visibility}>•{p.visibility}</span></Show>
                          </div>
                          <div class="text-[11px] text-text-muted truncate font-mono">{p.path_with_namespace}</div>
                        </div>
                        <div class="flex items-center gap-2.5 text-[10.5px] text-text-muted flex-none">
                          <Show when={(p.open_issues_count ?? 0) > 0}><span title="open issues">{p.open_issues_count} open</span></Show>
                          <Show when={(p.star_count ?? 0) > 0}><span title="stars">★ {p.star_count}</span></Show>
                          <Show when={p.last_activity_at}><span class="hidden sm:inline">{relativeTime(p.last_activity_at!)}</span></Show>
                          <Show when={p.web_url}>
                            <a
                              class="grid place-items-center w-6 h-6 rounded-md text-text-muted hover:text-[#FC6D26] hover:bg-surface-2 transition-colors"
                              href={p.web_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in GitLab"
                              aria-label="Open in GitLab"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <GitLabIcon class="w-4 h-4" />
                            </a>
                          </Show>
                          <Show when={props.projectFilter() === p.id}><span class="text-accent">✓</span></Show>
                        </div>
                      </PaletteRow>
                    );
                  }}
                </For>

                <Show when={!showAll() && filtered().length === 0}>
                  <p class="text-[12.5px] text-text-muted text-center py-8">No repositories match “{query()}”.</p>
                </Show>
              </Show>
            </div>

            {/* Footer hints */}
            <div class="flex items-center gap-3 px-3.5 py-2 border-t border-border text-[10.5px] text-text-muted">
              <span><kbd class="font-mono">↑</kbd> <kbd class="font-mono">↓</kbd> navigate</span>
              <span><kbd class="font-mono">↵</kbd> scope board</span>
              <span class="flex items-center gap-1"><GitLabIcon class="w-3.5 h-3.5 text-[#FC6D26]" /> open in GitLab</span>
              <span class="ml-auto"><kbd class="font-mono">esc</kbd> close</span>
            </div>
          </div>
        </div>
        </Portal>
      </Show>
    </>
  );
}

function PaletteRow(props: { active: boolean; onHover: () => void; onPick: () => void; children: any }) {
  return (
    <button
      type="button"
      data-active={props.active}
      class="w-full text-left flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors"
      classList={{ 'bg-accent/12 ring-1 ring-accent/40': props.active, 'hover:bg-surface-hover': !props.active }}
      onMouseEnter={props.onHover}
      onClick={props.onPick}
    >
      {props.children}
    </button>
  );
}

function RepoAvatar(props: { project: GitLabProject }) {
  return (
    <Show
      when={props.project.avatar_url}
      fallback={
        <span class="w-8 h-8 rounded-lg grid place-items-center text-[11px] font-extrabold text-white flex-none bg-gradient-to-br from-indigo-500 to-purple-500">
          {props.project.name.slice(0, 2).toUpperCase()}
        </span>
      }
    >
      <img src={props.project.avatar_url} alt="" class="w-8 h-8 rounded-lg object-cover flex-none" />
    </Show>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Board
// ─────────────────────────────────────────────────────────────────────────────
function Board(props: {
  ctx: WsCtx;
  search: Accessor<string>;
  projectFilter: Accessor<number | null>;
  resolveRun: (projectId: number, iid: number) => GroupRunJoin | undefined;
  projectsById: Accessor<Map<number, GitLabProject>>;
  selectedIssue: Accessor<GitGroupIssue | null>;
  onOpen: (issue: GitGroupIssue) => void;
  onOpenGate: (issue: GitGroupIssue) => void;
  onMoved: () => void;
  dispatchAgent: Accessor<string | null>;
  // Page-level refresh tick (visibility poll + focus). Folded into the lane
  // resource key so background GitLab label changes re-pull every lane.
  refreshTick: Accessor<number>;
}) {
  // ── Drag & drop + optimistic move state (board-scoped) ──
  // The card currently being dragged (null when idle). Drives lane expansion +
  // drop affordances; carries the object across the drop (dataTransfer is strings).
  const [draggingIssue, setDraggingIssue] = createSignal<GitGroupIssue | null>(null);
  // In-flight moves keyed by issueKey → the card jumps lanes instantly while the
  // GitLab relabel round-trips, and is reconciled away once the server agrees.
  const [optimistic, setOptimistic] = createSignal<Map<string, OptimisticMove>>(new Map());
  // Bumped on every committed move to force all lanes to re-fetch the truth.
  const [boardRev, setBoardRev] = createSignal(0);
  const [toast, setToast] = createSignal<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const dragging = () => draggingIssue() !== null;

  let toastTimer: number | undefined;
  function flash(t: { kind: 'ok' | 'err'; msg: string }) {
    setToast(t);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToast(null), t.kind === 'err' ? 6000 : 3200);
  }
  onCleanup(() => clearTimeout(toastTimer));

  // Commit a card to a new lane: optimistic relabel. The gitlab-label bridge —
  // not the console — dispatches the agent when the target is a trigger column.
  async function moveCard(issue: GitGroupIssue, toLabel: string) {
    if (currentAgentLabel(issue.labels) === toLabel) return; // dropped on its own lane
    const k = issueKey(issue);
    const col = COLUMNS.find((c) => c.label === toLabel);
    setOptimistic((prev) => new Map(prev).set(k, { issue: withAgentLabel(issue, toLabel), to: toLabel }));
    try {
      await gitlabGroup.updateIssueLabels(props.ctx.ns, props.ctx.intg, issue.project_id, issue.iid, {
        add_labels: toLabel,
        remove_labels: COLUMNS.map((c) => c.label).filter((l) => l !== toLabel).join(','),
      });
      // Pull the truth now, and once more shortly after to absorb GitLab's brief
      // read-after-write lag (so the overlay always reconciles even with no run).
      setBoardRev((r) => r + 1);
      window.setTimeout(() => setBoardRev((r) => r + 1), 1200);
      props.onMoved();
      if (toLabel === 'agent::approved') props.onOpenGate(withAgentLabel(issue, toLabel));
      if (col?.trigger) {
        const who = props.dispatchAgent() ?? 'the coder';
        flash({ kind: 'ok', msg: `#${issue.iid} → ${col.title} · dispatching ${who}…` });
      }
    } catch (e) {
      setOptimistic((prev) => { const m = new Map(prev); m.delete(k); return m; }); // revert
      flash({ kind: 'err', msg: `Couldn't move #${issue.iid}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // Once a lane's fresh server data reflects a pending move, drop its overlay —
  // this is what prevents the card from "snapping back" before GitLab agrees.
  function onLaneResolved(label: string, presentKeys: Set<string>) {
    setOptimistic((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const m = new Map(prev);
      for (const [k, mv] of prev) {
        if (mv.to === label && presentKeys.has(k)) { m.delete(k); changed = true; }
      }
      return changed ? m : prev;
    });
  }

  return (
    <div class="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
      <div class="h-full flex gap-3 p-4 items-stretch">
        <For each={COLUMNS}>
          {(col) => (
            <Lane
              col={col}
              ctx={props.ctx}
              search={props.search}
              projectFilter={props.projectFilter}
              resolveRun={props.resolveRun}
              projectsById={props.projectsById}
              selectedIssue={props.selectedIssue}
              onOpen={props.onOpen}
              optimistic={optimistic}
              boardRev={() => boardRev() + props.refreshTick()}
              dragging={dragging}
              draggingIssue={draggingIssue}
              dispatchAgent={props.dispatchAgent}
              onDragStartCard={setDraggingIssue}
              onDragEndCard={() => setDraggingIssue(null)}
              moveCard={moveCard}
              onLaneResolved={onLaneResolved}
            />
          )}
        </For>
      </div>

      <Show when={toast()}>
        {(t) => (
          <div
            class="mc-toast fixed bottom-5 left-1/2 z-[45] flex items-center gap-2 px-3.5 py-2 rounded-xl border shadow-2xl text-[12.5px] font-medium max-w-[90vw]"
            classList={{
              'bg-surface border-border-subtle text-text': t().kind === 'ok',
              'bg-red-500/15 border-red-500/40 text-red-200': t().kind === 'err',
            }}
          >
            <span class="flex-none">{t().kind === 'ok' ? '⚡' : '⚠'}</span>
            <span class="truncate">{t().msg}</span>
          </div>
        )}
      </Show>
    </div>
  );
}

function Lane(props: {
  col: ColumnDef;
  ctx: WsCtx;
  search: Accessor<string>;
  projectFilter: Accessor<number | null>;
  resolveRun: (projectId: number, iid: number) => GroupRunJoin | undefined;
  projectsById: Accessor<Map<number, GitLabProject>>;
  selectedIssue: Accessor<GitGroupIssue | null>;
  onOpen: (issue: GitGroupIssue) => void;
  // ── drag & drop wiring (board-owned) ──
  optimistic: Accessor<Map<string, OptimisticMove>>;
  boardRev: Accessor<number>;
  dragging: Accessor<boolean>;
  draggingIssue: Accessor<GitGroupIssue | null>;
  dispatchAgent: Accessor<string | null>;
  onDragStartCard: (issue: GitGroupIssue) => void;
  onDragEndCard: () => void;
  moveCard: (issue: GitGroupIssue, toLabel: string) => void;
  onLaneResolved: (label: string, keys: Set<string>) => void;
}) {
  const [issues, { refetch }] = createResource(
    () => ({ ctx: props.ctx, label: props.col.label, state: props.col.state ?? 'opened', search: props.search(), rev: props.boardRev() }),
    (k) => gitlabGroup.issues(k.ctx.ns, k.ctx.intg, {
      labels: k.label, state: k.state, search: k.search || undefined, per_page: 50,
    }),
  );
  // Background polls re-run this resource; `issues()` is undefined mid-fetch,
  // which would momentarily empty (and thus expand/collapse) the lane and flash
  // a spinner. `issues.latest` keeps the PRIOR value during a refetch, so we
  // render off that for a flicker-free refresh. Only the very first load (no
  // prior data) shows a spinner.
  const data = createMemo<GitGroupIssue[] | undefined>(() => issues() ?? issues.latest);
  const firstLoad = createMemo(() => issues.loading && issues.latest === undefined);
  // Live: refresh this lane on resource changes (agent label moves land here).
  onMount(() => {
    const unsub = onResourceChanged(() => refetch());
    onCleanup(unsub);
  });

  // Raw server truth for this lane (project-filtered) — the basis for both the
  // overlay and drop reconciliation. Uses `data` (prior value during refetch).
  const rawList = createMemo(() => {
    const pf = props.projectFilter();
    let list = data() ?? [];
    if (pf !== null) list = list.filter((i) => i.project_id === pf);
    return list;
  });

  // Overlay the board's in-flight moves: hide cards dragged OUT of this lane,
  // show cards dragged IN — so a drop feels instant before GitLab + refetch agree.
  const visible = createMemo(() => {
    const ov = props.optimistic();
    const base = rawList();
    if (ov.size === 0) return base;
    const kept = base.filter((i) => {
      const mv = ov.get(issueKey(i));
      return !mv || mv.to === props.col.label;
    });
    const present = new Set(kept.map(issueKey));
    const pf = props.projectFilter();
    const incoming: GitGroupIssue[] = [];
    for (const mv of ov.values()) {
      if (mv.to !== props.col.label) continue;
      if (pf !== null && mv.issue.project_id !== pf) continue;
      if (present.has(issueKey(mv.issue))) continue;
      incoming.push(mv.issue);
    }
    return incoming.length ? [...incoming, ...kept] : kept;
  });

  // Identity-stable view of `visible()`. Each background refetch returns brand-
  // new JSON objects; Solid's <For> keys by reference, so without this every
  // card would be disposed + re-mounted on each poll — replaying the .mc-card
  // mount animation (the ~30s "blink"). We cache one object per issueKey and
  // only swap the reference when the card's content actually changed, so
  // unchanged rows keep identity (no re-mount) and the enter animation plays
  // only for genuinely new cards.
  let identityCache = new Map<string, { sig: string; issue: GitGroupIssue }>();
  const stableVisible = createMemo(() => {
    const next = new Map<string, { sig: string; issue: GitGroupIssue }>();
    const out = visible().map((issue) => {
      const k = issueKey(issue);
      const sig = JSON.stringify(issue);
      const prev = identityCache.get(k);
      const entry = prev && prev.sig === sig ? prev : { sig, issue };
      next.set(k, entry);
      return entry.issue;
    });
    identityCache = next; // drop entries for cards no longer present
    return out;
  });

  // Report this lane's true contents up so the board can retire satisfied
  // overlays (no snap-back: only once the server reflects the move).
  createEffect(() => {
    if (issues.loading) return;
    props.onLaneResolved(props.col.label, new Set(rawList().map(issueKey)));
  });

  const activeCount = createMemo(() => visible().filter((i) => joinActive(props.resolveRun(i.project_id, i.iid))).length);

  // Empty lanes auto-collapse to a thin rail to reclaim horizontal space; the
  // remaining lanes flex to fill the board. While a drag is in flight every lane
  // expands so it can serve as a drop target. Keyed off `data` (which holds the
  // prior value during a refetch) NOT `issues.loading`, so a background poll
  // never expands/collapses a lane — only a real change in contents does.
  const [peek, setPeek] = createSignal(false);
  const empty = createMemo(() => data() !== undefined && visible().length === 0);
  const collapsed = createMemo(() => empty() && !peek() && !props.dragging());

  // ── drop target ──
  const [dropActive, setDropActive] = createSignal(false);
  function onDragOver(e: DragEvent) {
    if (!props.draggingIssue()) return;
    e.preventDefault(); // required to allow a drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (!dropActive()) setDropActive(true);
  }
  function onDragLeave(e: DragEvent) {
    const ct = e.currentTarget as HTMLElement;
    if (e.relatedTarget instanceof Node && ct.contains(e.relatedTarget)) return; // moving over a child
    setDropActive(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDropActive(false);
    const issue = props.draggingIssue();
    props.onDragEndCard();
    if (issue) props.moveCard(issue, props.col.label);
  }

  return (
    <Show
      when={!collapsed()}
      fallback={
        <button
          class="mc-rail flex flex-col items-center gap-2 w-12 flex-none rounded-2xl border border-border-subtle bg-surface/30 py-3"
          style={{ '--mc-accent': props.col.accent }}
          title={`${props.col.title} — empty · click to expand`}
          onClick={() => setPeek(true)}
        >
          <span class="w-6 h-6 rounded-lg grid place-items-center text-[12px] flex-none" style={{ color: props.col.accent, background: `${props.col.accent}1f` }}>{props.col.glyph}</span>
          <span class="grow text-[11px] font-semibold text-text-muted tracking-wide [writing-mode:vertical-rl] rotate-180">{props.col.title}</span>
          <span class="text-[10px] text-text-muted">0</span>
        </button>
      }
    >
      <section
        class="mc-lane flex flex-col flex-1 min-w-[272px] max-w-[420px] rounded-2xl border border-border-subtle bg-surface/60"
        data-active={activeCount() > 0}
        data-drop={dropActive()}
        style={{ '--mc-accent': props.col.accent }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border-subtle">
          <span class="w-6 h-6 rounded-lg grid place-items-center text-[12px] flex-none" style={{ color: props.col.accent, background: `${props.col.accent}1f` }}>{props.col.glyph}</span>
          <b class="text-[13px]">{props.col.title}</b>
          <Show when={props.col.trigger}>
            <span
              class="text-[9px] uppercase tracking-wide font-bold px-1 py-px rounded leading-none"
              style={{ color: props.col.accent, background: `${props.col.accent}1f` }}
              title={`Dropping a card here dispatches ${props.dispatchAgent() ?? 'the coder'}`}
            >⚡ auto</span>
          </Show>
          <Show when={activeCount() > 0}>
            <span class="mc-live-dot w-1.5 h-1.5 rounded-full" style={{ background: props.col.accent, '--mc-accent': props.col.accent }} />
          </Show>
          <span class="ml-auto text-xs text-text-muted bg-surface-2 px-1.5 py-0.5 rounded-full">{visible().length}</span>
          <Show when={empty() && !props.dragging()}>
            <button class="text-text-muted hover:text-text text-sm leading-none px-1" title="Collapse empty lane" onClick={() => setPeek(false)}>«</button>
          </Show>
        </div>

        <div class="flex-1 flex flex-col gap-2 p-2 overflow-y-auto">
          <Show when={props.dragging()}>
            <div class="mc-drop-hint text-[10.5px] text-center py-1.5 rounded-lg border border-dashed" style={{ 'border-color': `${props.col.accent}66`, color: props.col.accent }}>
              <Show when={props.col.trigger} fallback={<>Drop to move here</>}>
                ⚡ Drop → {props.dispatchAgent() ?? 'coder'} runs
              </Show>
            </div>
          </Show>
          <Show when={firstLoad()}><div class="grid place-items-center py-6"><Spinner size="sm" /></div></Show>
          <Show when={issues.error && data() === undefined}><p class="text-xs text-error px-2 py-3">Failed: {String(issues.error)}</p></Show>
          <For each={stableVisible()}>
            {(issue) => (
              <Card
                issue={issue}
                col={props.col}
                run={props.resolveRun(issue.project_id, issue.iid)}
                project={props.projectsById().get(issue.project_id)}
                selected={props.selectedIssue()?.project_id === issue.project_id && props.selectedIssue()?.iid === issue.iid}
                onOpen={props.onOpen}
                onDragStart={props.onDragStartCard}
                onDragEnd={props.onDragEndCard}
              />
            )}
          </For>
          <Show when={empty() && !props.dragging()}>
            <p class="text-[11.5px] text-text-muted px-2 py-6 text-center">Empty</p>
          </Show>
        </div>
      </section>
    </Show>
  );
}

function Card(props: {
  issue: GitGroupIssue;
  col: ColumnDef;
  run?: GroupRunJoin;
  project?: GitLabProject;
  selected?: boolean;
  onOpen: (issue: GitGroupIssue) => void;
  onDragStart: (issue: GitGroupIssue) => void;
  onDragEnd: () => void;
}) {
  const active = createMemo(() => joinActive(props.run));
  const idx = createMemo(() => Math.max(0, COLUMNS.findIndex((c) => c.label === props.col.label)));
  const pct = createMemo(() => Math.round(((idx() + 1) / COLUMNS.length) * 100));
  const [dragging, setDragging] = createSignal(false);

  function onDragStart(e: DragEvent) {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Payload is advisory only — the board carries the live object via signal.
      e.dataTransfer.setData('text/plain', `#${props.issue.iid} ${props.issue.title}`);
    }
    setDragging(true);
    props.onDragStart(props.issue);
  }
  function onDragEnd() {
    setDragging(false);
    props.onDragEnd();
  }

  return (
    <button
      type="button"
      class="mc-card group/card relative text-left rounded-xl border bg-surface p-2.5"
      classList={{ 'border-border-subtle': !props.selected, 'border-accent': props.selected, 'mc-dragging': dragging() }}
      draggable={true}
      data-selected={!!props.selected}
      style={{ '--mc-accent': props.col.accent }}
      onClick={() => props.onOpen(props.issue)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span class="mc-grip absolute top-1.5 right-1.5 text-text-muted opacity-0 group-hover/card:opacity-60 transition-opacity text-[12px] leading-none select-none" title="Drag to move">⠿</span>
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-[11px] font-semibold text-text-muted">#{props.issue.iid}</span>
        <Show when={props.project}>
          <span class="text-[10px] font-mono text-text-muted truncate max-w-[10rem]" title={props.project!.path_with_namespace}>{props.project!.name}</span>
        </Show>
        <Show when={active()}>
          <span class="ml-auto mc-live-dot w-1.5 h-1.5 rounded-full" style={{ background: props.col.accent, '--mc-accent': props.col.accent }} />
        </Show>
      </div>

      <p class="text-[13px] font-semibold leading-snug mb-2 line-clamp-3">{props.issue.title}</p>

      <Show when={(props.issue.labels?.filter((l) => !l.startsWith('agent::')).length ?? 0) > 0}>
        <div class="flex flex-wrap gap-1 mb-2">
          <For each={props.issue.labels!.filter((l) => !l.startsWith('agent::')).slice(0, 4)}>{(l) => <LabelChip label={l} />}</For>
        </div>
      </Show>

      {/* Agent strip */}
      <Show when={props.run}>
        {(run) => (
          <div class="flex items-center gap-2 mb-2 text-[11px]">
            <span class="w-5 h-5 rounded-md grid place-items-center text-[9px] font-extrabold text-white bg-gradient-to-br from-indigo-500 to-purple-500 flex-none">{run().agentRef.slice(0, 2).toUpperCase()}</span>
            <span class="font-semibold truncate">{run().agentRef}</span>
            <span class="ml-auto"><Badge variant={phaseVariant(run().phase)} dot={active()}>{run().phase ?? 'Pending'}</Badge></span>
          </div>
        )}
      </Show>

      {/* Progress along the state machine */}
      <div class="mc-progress h-1.5 rounded-full" data-active={active()}>
        <i style={{ width: `${pct()}%` }} />
      </div>

      {/* Delivery edge: MR + CI status (joined server-side on branch) */}
      <Show when={props.run?.mr}>
        {(mr) => (
          <div class="flex items-center gap-1.5 mt-1.5 flex-wrap text-[10px]">
            <span class="font-mono text-text-muted" title={mr().title}>!{mr().iid}</span>
            <Show when={mr().pipelineStatus}>
              <Badge variant={pipelineVariant(mr().pipelineStatus!)}>CI {mr().pipelineStatus}</Badge>
            </Show>
            <Show when={mr().draft}><span class="text-text-muted">draft</span></Show>
            <Show when={mr().hasConflicts}><span class="text-red-400" title="merge conflicts">⚠ conflicts</span></Show>
            <Show when={(props.run?.ciFixAttempts ?? 0) > 0}>
              <span class="ml-auto text-amber-400" title="CI fix runs dispatched">↻ fix ×{props.run!.ciFixAttempts}</span>
            </Show>
          </div>
        )}
      </Show>

      <div class="flex items-center gap-2 mt-1.5 text-[10.5px] text-text-muted">
        <Show when={props.run?.toolCalls}><span title="tool calls">⚒ {props.run!.toolCalls}</span></Show>
        <Show when={props.run?.tokensUsed}><span title="tokens">▦ {formatTokens(props.run!.tokensUsed!)}</span></Show>
        <Show when={props.run?.traceID}><span title="trace available">⌁</span></Show>
        <span class="ml-auto">{relativeTime(props.issue.updated_at)}</span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cockpit (docked right / fullscreen on small screens)
// ─────────────────────────────────────────────────────────────────────────────
function Cockpit(props: {
  ctx: WsCtx;
  target: CockpitTarget;
  tab: Accessor<CockpitTab>;
  onTab: (t: CockpitTab) => void;
  resolveRun: (projectId: number, iid: number) => GroupRunJoin | undefined;
  projectsById: Accessor<Map<number, GitLabProject>>;
  pmDaemon: Accessor<{ ns: string; name: string } | null>;
  defaultFixAgent?: string | null;
  onClose: () => void;
  onMoved: () => void;
  onOpenTrace: (traceID: string) => void;
}) {
  const isCard = () => props.target.kind === 'card';
  const isMR = () => props.target.kind === 'mr';
  const issue = () => (props.target.kind === 'card' ? props.target.issue : null);
  const run = createMemo(() => { const i = issue(); return i ? props.resolveRun(i.project_id, i.iid) : undefined; });
  // The agent that EXECUTED the work — used for the run-describing tabs
  // (Trace/Plan/Gate) and the header identity.
  const agent = createMemo<{ ns: string; name: string } | null>(() => {
    if (props.target.kind === 'compose') return { ns: props.target.ns, name: props.target.name };
    const r = run(); return r?.agentRef ? { ns: r.namespace, name: r.agentRef } : null;
  });
  // The agent the CONVERSATION binds to. Card runs are executed by ephemeral
  // task agents whose pod is gone once finished, so a follow-up chat must reach
  // the board's long-lived daemon PM (which can re-delegate). Fall back to the
  // executing agent only when there's no daemon PM (e.g. compose/direct chat,
  // or a board whose channel fires a task agent directly).
  const convAgent = createMemo<{ ns: string; name: string } | null>(() => {
    if (props.target.kind === 'compose') return { ns: props.target.ns, name: props.target.name };
    return props.pmDaemon() ?? agent();
  });
  const project = () => {
    if (props.target.kind === 'card') return props.projectsById().get(props.target.issue.project_id);
    if (props.target.kind === 'mr') return props.projectsById().get(props.target.projectId);
    return undefined;
  };
  const curState = createMemo(() => stateIndex(issue()?.labels));
  // A raw MR opened from the MRs view has no issue/run context, so it routes
  // straight to the gate. We pin the explicit (project, mrIID) here and pass it
  // to GatePanel as an override (the card path keeps deriving the MR from the
  // executing run's artifacts).
  const mrOverride = createMemo<{ projectId: number; mrIID: number } | null>(() =>
    props.target.kind === 'mr' ? { projectId: props.target.projectId, mrIID: props.target.mrIID } : null);
  const headerLink = () => {
    if (props.target.kind === 'card') return props.target.issue.web_url;
    if (props.target.kind === 'mr') return props.target.web_url;
    return undefined;
  };

  // For a raw MR only the Diff & Gate tab is meaningful; keep the issue/compose
  // path on the full four-tab cockpit. Force gate when an MR is shown.
  createEffect(() => { if (isMR() && props.tab() !== 'gate') props.onTab('gate'); });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const ALL_TABS: { id: CockpitTab; label: string }[] = [
    { id: 'conversation', label: '◇ Conversation' },
    { id: 'plan', label: '✎ Plan' },
    { id: 'trace', label: '⌁ Trace' },
    { id: 'gate', label: '⎇ Diff & Gate' },
  ];

  // ── Lane-aware tab system ──
  // Each lane shows purpose-built tabs for that stage of the workflow:
  //   Planning:     Plan Refinement (discuss, refine, approve)
  //   Todo:         Plan (read-only) + Trace (if queued)
  //   In Progress:  Conversation (live agent stream) + Trace (live spans)
  //   Needs Review: Diff & Gate (review MR) + Trace
  //   Changes:      Conversation (feedback) + Trace + Diff & Gate
  //   Approved:     Diff & Gate (merge) only
  const isCompose = () => props.target.kind === 'compose';
  const state = () => curState();

  const TABS = createMemo(() => {
    if (isMR()) return ALL_TABS.filter((t) => t.id === 'gate');
    if (isCompose()) return ALL_TABS.filter((t) => t.id === 'conversation');
    if (!isCard()) return ALL_TABS;

    switch (state()) {
      case 0: // Planning — Plan Refinement is the whole experience
        return ALL_TABS.filter((t) => t.id === 'plan');
      case 1: // Todo — waiting for dispatch, show plan (read-only) + trace
        return ALL_TABS.filter((t) => t.id === 'plan' || t.id === 'trace');
      case 2: // In Progress — agent is working, show live stream + trace
        return ALL_TABS.filter((t) => t.id === 'conversation' || t.id === 'trace');
      case 3: // Needs Review — MR is open, review it
        return ALL_TABS.filter((t) => t.id === 'gate' || t.id === 'trace');
      case 4: // Changes Requested — feedback loop, re-dispatch
        return ALL_TABS.filter((t) => t.id === 'conversation' || t.id === 'trace' || t.id === 'gate');
      case 5: // Approved — merge and ship
        return ALL_TABS.filter((t) => t.id === 'gate');
      default:
        return ALL_TABS;
    }
  });

  // Default tab per lane (what opens first when you click a card)
  const defaultTab = (): CockpitTab => {
    if (isMR()) return 'gate';
    if (isCompose()) return 'conversation';
    switch (state()) {
      case 0: return 'plan';           // Planning → Plan Refinement
      case 1: return 'plan';           // Todo → read-only plan
      case 2: return 'conversation';   // In Progress → live agent stream
      case 3: return 'gate';           // Needs Review → code review
      case 4: return 'conversation';   // Changes → feedback context
      case 5: return 'gate';           // Approved → merge
      default: return 'conversation';
    }
  };

  // If the docked target loses the active tab (lane changed, or card switched),
  // fall back to the lane-appropriate default.
  createEffect(() => {
    if (!TABS().some((t) => t.id === props.tab())) props.onTab(defaultTab());
  });

  return (
    <>
      {/* Mobile/tablet backdrop */}
      <div class="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={props.onClose} />

      <aside class="mc-dock fixed inset-0 z-50 bg-surface flex flex-col
                    lg:static lg:inset-auto lg:z-auto lg:w-[40rem] lg:max-w-[44vw] lg:flex-none
                    border-l border-border shadow-2xl lg:shadow-none">
        {/* Header */}
        <div class="flex items-start gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-[11px] text-text-muted font-semibold">
              <Show when={props.target.kind === 'card'}>
                <span>#{issue()!.iid}</span>
                <Show when={project()}><span class="font-mono truncate">· {project()!.name}</span></Show>
                <Show when={agent()}>
                  <span class="ml-1 flex items-center gap-1 text-text-secondary">
                    <span class="w-3.5 h-3.5 rounded grid place-items-center text-[8px] font-extrabold text-white bg-gradient-to-br from-indigo-500 to-purple-500">{agent()!.name.slice(0, 2).toUpperCase()}</span>
                    {agent()!.name}
                  </span>
                </Show>
              </Show>
              <Show when={props.target.kind === 'mr'}>
                <span class="uppercase tracking-wider">Merge Request</span>
                <span class="font-mono">!{mrOverride()!.mrIID}</span>
                <Show when={project()}><span class="font-mono truncate">· {project()!.name}</span></Show>
              </Show>
              <Show when={props.target.kind === 'compose'}>
                <span class="uppercase tracking-wider">{props.target.kind === 'compose' ? props.target.kicker : 'Compose'}</span>
                <Show when={agent()}>
                  <span class="ml-1 flex items-center gap-1 text-text-secondary">
                    <span class="w-3.5 h-3.5 rounded grid place-items-center text-[8px] font-extrabold text-white bg-gradient-to-br from-indigo-500 to-purple-500">{agent()!.name.slice(0, 2).toUpperCase()}</span>
                    {agent()!.name}
                  </span>
                </Show>
              </Show>
            </div>
            <h3 class="text-sm font-semibold mt-0.5 break-words line-clamp-2">{props.target.kind === 'card' ? issue()!.title : props.target.kind === 'mr' ? props.target.title : props.target.kind === 'compose' ? props.target.title : ''}</h3>
          </div>
          <Show when={headerLink()}>
            <a class="grid place-items-center w-7 h-7 rounded-md text-text-muted hover:text-[#FC6D26] hover:bg-surface-2 transition-colors mt-0.5" href={headerLink()!} target="_blank" rel="noreferrer" title="Open in GitLab" aria-label="Open in GitLab"><GitLabIcon class="w-4 h-4" /></a>
          </Show>
          <button class="text-text-muted hover:text-text text-xl leading-none" onClick={props.onClose} title="Close (Esc)">×</button>
        </div>

        {/* Stepper (card only) */}
        <Show when={isCard()}>
          <Stepper current={curState()} />
        </Show>

        {/* Tabs — hidden when there's only one (e.g. a supervisor's lone
            Conversation, or a raw MR's lone gate): a single-tab bar is noise. */}
        <Show when={TABS().length > 1}>
          <div class="flex gap-1 px-3 border-b border-border flex-shrink-0 overflow-x-auto">
            <For each={TABS()}>
              {(t) => (
                <button
                  class="mc-step px-2.5 py-2.5 text-[12.5px] font-semibold border-b-2 whitespace-nowrap"
                  classList={{ 'text-text border-accent': props.tab() === t.id, 'text-text-muted border-transparent hover:text-text-secondary': props.tab() !== t.id }}
                  onClick={() => props.onTab(t.id)}
                >
                  {t.label}
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Body */}
        <div class="flex-1 min-h-0 flex flex-col">
          <Show when={props.tab() === 'conversation'}>
            <ConversationPanel ctx={props.ctx} issue={issue()} agent={convAgent()} />
          </Show>
          <Show when={props.tab() === 'plan'}>
            <Show when={curState() === 0 && issue()} fallback={
              <div class="flex-1 overflow-auto p-4">
                <AppErrorBoundary name="Plan">
                  <PlanPanel ctx={props.ctx} issue={issue()} run={run()} onMoved={props.onMoved} />
                </AppErrorBoundary>
              </div>
            }>
              <AppErrorBoundary name="Plan Refinement">
                <PlanRefinement ctx={props.ctx} issue={issue()!} pmDaemon={props.pmDaemon} onMoved={props.onMoved} />
              </AppErrorBoundary>
            </Show>
          </Show>
          <Show when={props.tab() === 'trace'}>
            <div class="flex-1 min-h-0 flex flex-col p-4">
              <TracePanel run={run()} onOpenTrace={props.onOpenTrace} />
            </div>
          </Show>
          <Show when={props.tab() === 'gate'}>
            <div class="flex-1 overflow-auto p-4">
              <AppErrorBoundary name="Diff & Gate">
                <GatePanel ctx={props.ctx} issue={issue()} run={run()} mrOverride={mrOverride()} onMerged={props.onMoved} defaultFixAgent={props.defaultFixAgent} projectsById={props.projectsById} onDispatched={props.onMoved} />
              </AppErrorBoundary>
            </div>
          </Show>
        </div>
      </aside>
    </>
  );
}

function Stepper(props: { current: number }) {
  return (
    <div class="flex items-center gap-1 px-4 py-2.5 border-b border-border-subtle flex-shrink-0 overflow-x-auto">
      <For each={COLUMNS}>
        {(c, i) => {
          const done = () => i() < props.current;
          const here = () => i() === props.current;
          return (
            <>
              <Show when={i() > 0}>
                <span class="h-px w-3 flex-none" style={{ background: i() <= props.current ? c.accent : 'var(--border-main)' }} />
              </Show>
              <span
                class="mc-step flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-[10.5px] font-semibold whitespace-nowrap border"
                style={{
                  color: here() || done() ? c.accent : 'var(--text-muted)',
                  'border-color': here() ? c.accent : 'transparent',
                  background: here() ? `${c.accent}1a` : 'transparent',
                }}
                title={c.title}
              >
                <span class="w-4 h-4 rounded-full grid place-items-center text-[9px]" style={{ background: done() ? c.accent : here() ? `${c.accent}33` : 'var(--bg-hover)', color: done() ? '#fff' : 'inherit' }}>
                  {done() ? '✓' : c.glyph}
                </span>
                <span class="hidden xl:inline">{c.title}</span>
              </span>
            </>
          );
        }}
      </For>
    </div>
  );
}

// ── Conversation: the embedded live agent chat (or the issue thread) ─────────
function ConversationPanel(props: { ctx: WsCtx; issue: GitGroupIssue | null; agent: { ns: string; name: string } | null }) {
  // Bind the global chat to this card's agent so <ChatView/> streams it.
  createEffect(() => {
    const a = props.agent;
    if (!a) return;
    const cur = selectedAgent();
    if (!cur || cur.namespace !== a.ns || cur.name !== a.name) selectAgent(a.ns, a.name);
  });

  return (
    <Show
      when={props.agent}
      fallback={
        <div class="flex-1 overflow-auto p-4">
          <Show when={props.issue} fallback={<p class="text-[12.5px] text-text-muted">Select a card to open its conversation.</p>}>
            <p class="text-[12px] text-text-muted mb-3">
              No agent is executing this card yet. Use <b>New Plan</b> or move it to <b>Todo</b> to dispatch one. Meanwhile, here's the issue thread:
            </p>
            <IssueThread ctx={props.ctx} issue={props.issue!} />
          </Show>
        </div>
      }
    >
      <div class="flex items-center gap-2 px-4 py-2 border-b border-border-subtle flex-shrink-0 bg-surface-2/40">
        <span class="w-2 h-2 rounded-full" classList={{ 'mc-live-dot bg-blue-500': streaming(), 'bg-success': !streaming() }} style={{ '--mc-accent': '#3b82f6' }} />
        <span class="text-[12px] font-semibold">{props.agent!.name}</span>
        <span class="text-[11px] text-text-muted">{streaming() ? 'streaming…' : 'live'}</span>
        <span class="ml-auto text-[10.5px] text-text-muted">steer or reply below</span>
      </div>
      <div class="flex-1 min-h-0">
        <ChatView class="h-full" />
      </div>
    </Show>
  );
}

function IssueThread(props: { ctx: WsCtx; issue: GitGroupIssue }) {
  const key = () => ({ ...props.ctx, project: props.issue.project_id, iid: props.issue.iid });
  const [notes] = createResource(key, (k) => gitlabGroup.projectIssueNotes(k.ns, k.intg, k.project, k.iid));
  return (
    <div class="flex flex-col gap-2">
      <Show when={props.issue.description}>
        <div class="text-[12.5px] bg-surface-2 border border-border-subtle rounded-lg p-2.5">
          <Markdown content={props.issue.description!} />
        </div>
      </Show>
      <For each={(notes() ?? []).filter((n) => !n.system)}>
        {(n) => (
          <div class="flex gap-2.5 py-1.5 border-b border-border-subtle">
            <span class="w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold text-white bg-accent flex-none">{(n.author?.username ?? '?').slice(0, 2).toUpperCase()}</span>
            <div class="min-w-0">
              <div class="text-[11.5px] font-semibold">{n.author?.username ?? 'unknown'} <span class="text-text-muted font-normal">· {relativeTime(n.created_at)}</span></div>
              <div class="text-[12.5px] text-text-secondary"><Markdown content={n.body} /></div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

// ── Plan: issue body, metadata, state moves, discussion ──────────────────────
function PlanPanel(props: { ctx: WsCtx; issue: GitGroupIssue | null; run?: GroupRunJoin; onMoved: () => void }) {
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const key = () => (props.issue ? { ...props.ctx, project: props.issue.project_id, iid: props.issue.iid } : null);
  const [detail] = createResource(key, (k) => gitlabGroup.projectIssue(k.ns, k.intg, k.project, k.iid));

  async function move(toLabel: string) {
    if (!props.issue) return;
    setBusy(true); setErr(null);
    try {
      await gitlabGroup.updateIssueLabels(props.ctx.ns, props.ctx.intg, props.issue.project_id, props.issue.iid, {
        add_labels: toLabel,
        remove_labels: COLUMNS.map((c) => c.label).filter((l) => l !== toLabel).join(','),
      });
      props.onMoved();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  return (
    <Show when={props.issue} fallback={<p class="text-[12.5px] text-text-muted">No work item.</p>}>
      <SectionLabel>Work Item</SectionLabel>
      <KV k="IID">#{props.issue!.iid}</KV>
      <Show when={detail()?.milestone}><KV k="Milestone">{detail()!.milestone!.title}</KV></Show>
      <Show when={(detail()?.assignees?.length ?? 0) > 0}><KV k="Assignees">{detail()!.assignees!.map((a) => a.username).join(', ')}</KV></Show>
      <Show when={props.issue!.author}><KV k="Author">{props.issue!.author!.username}</KV></Show>

      <Show when={detail()?.description}>
        <SectionLabel>Plan</SectionLabel>
        <div class="text-[12.5px] bg-surface-2 border border-border-subtle rounded-lg p-2.5 max-h-72 overflow-auto">
          <Markdown content={detail()!.description!} />
        </div>
      </Show>

      <Show when={props.run?.intent || props.run?.summary || (props.run?.artifacts?.length ?? 0) > 0}>
        <SectionLabel>Latest Outcome</SectionLabel>
        <RunOutcome outcome={joinOutcome(props.run!)} intentHint={props.run!.intent} />
      </Show>

      <SectionLabel>Move</SectionLabel>
      <div class="flex flex-wrap gap-1.5">
        <For each={COLUMNS}>
          {(c) => (
            <button
              disabled={busy()}
              class="text-[11px] px-2.5 py-1.5 rounded-lg border bg-surface-2 hover:bg-surface-hover disabled:opacity-50 transition-colors"
              style={{ 'border-color': `${c.accent}55`, color: c.accent }}
              onClick={() => move(c.label)}
            >
              {c.glyph} {c.title}
            </button>
          )}
        </For>
      </div>
      <Show when={err()}><p class="text-xs text-error mt-2">{err()}</p></Show>

      <SectionLabel>Discussion</SectionLabel>
      <IssueThread ctx={props.ctx} issue={props.issue!} />
    </Show>
  );
}

// ── Trace: card run vitals + waterfall, OR a supervisor's latest live trace ──
// ── Trace: card run vitals + embedded full waterfall ─────────────────────────
// Only used for CARD targets. Supervisors (compose mode) have no Trace tab —
// their live activity streams into the Conversation tab via <ChatView/>.
function TracePanel(props: { run?: GroupRunJoin; onOpenTrace: (traceID: string) => void }) {
  // Drive the embedded TraceDetailView via the global selectedTraceForDetail.
  // Persist on navigate-to-full-page (otherwise cleanup wipes it mid-mount).
  let navigatingToFull = false;
  createEffect(() => {
    if (props.run?.traceID) showTraceDetail(props.run.traceID);
  });
  onCleanup(() => { if (!navigatingToFull) clearCenterOverlay(); });
  const openFull = (traceID: string) => { navigatingToFull = true; props.onOpenTrace(traceID); };

  return (
    <Show when={props.run} fallback={<p class="text-[12.5px] text-text-muted">No agent run is joined to this card yet.</p>}>
      {(run) => (
        <div class="flex flex-col h-full min-h-0">
          <SectionLabel>Run Vitals</SectionLabel>
          <div class="grid grid-cols-2 gap-2 mb-3">
            <Vital label="Phase" value={run().phase ?? 'Pending'} accent={joinActive(run()) ? '#3b82f6' : undefined} />
            <Vital label="Model" value={run().model ?? '—'} />
            <Vital label="Tool calls" value={String(run().toolCalls ?? 0)} />
            <Vital label="Tokens" value={formatTokens(run().tokensUsed ?? 0)} />
          </div>
          <KV k="Run"><span class="font-mono text-[11.5px]">{run().run}</span></KV>
          <Show when={run().created}><KV k="Started">{relativeTime(run().created)}</KV></Show>

          {/* Full trace waterfall — always shown. Same component as the
              full-page view; handles a missing trace gracefully (shows "Trace
              not available", never crashes). Span clicks don't open the side
              drawer here (that lives in MainApp), but the full tree + timings
              render in place. */}
          <Show
            when={run().traceID}
            fallback={<p class="text-[12px] text-text-muted mt-3">No trace recorded for this run yet.</p>}
          >
            <div class="flex items-center gap-2 mt-3 mb-2">
              <SectionLabel>Trace</SectionLabel>
              <button
                class="ml-auto text-[11px] px-2 py-1 rounded-lg text-text-muted hover:text-text transition-colors"
                title="Open in full-page trace view"
                onClick={() => openFull(run().traceID!)}
              >
                ↗ full page
              </button>
            </div>
            <div class="flex-1 min-h-0 rounded-xl border border-border-subtle bg-surface-2 overflow-hidden">
              <AppErrorBoundary name="Trace">
                <TraceDetailView class="h-full" />
              </AppErrorBoundary>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

function Vital(props: { label: string; value: string; accent?: string }) {
  return (
    <div class="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2">
      <div class="text-[10px] uppercase tracking-wider text-text-muted font-bold">{props.label}</div>
      <div class="text-[15px] font-semibold mt-0.5 truncate" style={props.accent ? { color: props.accent } : undefined}>{props.value}</div>
    </div>
  );
}

// ── Diff & Gate: merge review (human-only gate) ──────────────────────────────
// Two ways in: (1) an issue card — derive the MR from the executing run's
// outcome artifacts (and approve that issue on merge); (2) a raw MR opened from
// the Merge Requests view — `mrOverride` pins (project, mrIID) directly, with no
// linked issue to approve (best-effort, mirrors the old GroupMergeReview).
function GatePanel(props: {
  ctx: WsCtx;
  issue: GitGroupIssue | null;
  run?: GroupRunJoin;
  mrOverride?: { projectId: number; mrIID: number } | null;
  onMerged: () => void;
  // CI repair loop: the implementer agent to default the fix dispatch to (the
  // gitlab-label channel's agentRef), the owning project's full path (so the fix
  // run clones the right repo from the group), and a refetch hook.
  defaultFixAgent?: string | null;
  projectsById: Accessor<Map<number, GitLabProject>>;
  onDispatched?: () => void;
}) {
  // The MR to review: the explicit override when present, else the MR the run
  // opened (from its outcome artifacts).
  const projectId = () => props.mrOverride?.projectId ?? props.issue?.project_id ?? -1;
  // A raw-MR gate has no issue to approve; the issue path keeps its own iid.
  const issueIID = () => (props.mrOverride ? null : props.issue?.iid ?? null);

  const artifactMrIID = createMemo<number | null>(() => {
    if (props.mrOverride) return props.mrOverride.mrIID;
    const art = props.run?.artifacts?.find((a) => a.kind === 'mr' || a.kind === 'pr');
    const m = art?.url?.match(/merge_requests\/(\d+)/);
    return m ? Number(m[1]) : null;
  });

  // Fallback: many runs open an MR without recording it as an outcome artifact
  // (the agent skipped run_finish, the MR was opened by the bridge, or on a
  // branch other than the one assigned). For an issue card, GitLab's closed_by
  // is the authoritative issue→MR link — prefer a live (open/merged) MR. This is
  // the same signal the bridge uses to auto-promote, so it's always consistent.
  const closedByKey = () => {
    if (props.mrOverride || artifactMrIID() !== null || issueIID() === null || projectId() < 0) return null;
    return { ...props.ctx, project: projectId(), iid: issueIID()! };
  };
  const [closingMRs] = createResource(closedByKey, (k) =>
    gitlabGroup.projectIssueClosedBy(k.ns, k.intg, k.project, k.iid));
  const fallbackMR = createMemo(() => {
    const mrs = closingMRs() ?? [];
    // Prefer a still-viable MR (open, then merged) over an abandoned one.
    return mrs.find((m) => m.state === 'opened')
      ?? mrs.find((m) => m.state === 'merged')
      ?? mrs[0]
      ?? null;
  });

  const mrIID = createMemo<number | null>(() => artifactMrIID() ?? fallbackMR()?.iid ?? null);

  const key = () => (mrIID() !== null && projectId() >= 0 ? { ...props.ctx, project: projectId(), iid: mrIID()! } : null);
  const [mr] = createResource(key, (c) => gitlabGroup.mergeRequestChanges(c.ns, c.intg, c.project, c.iid));
  const [pipelines] = createResource(key, (c) => gitlabGroup.mergeRequestPipelines(c.ns, c.intg, c.project, c.iid));
  const [notes, { refetch: refetchNotes }] = createResource(key, (c) => gitlabGroup.mergeRequestNotes(c.ns, c.intg, c.project, c.iid));

  const [comment, setComment] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [merged, setMerged] = createSignal(false);

  // ── CI repair loop ──
  // The newest pipeline's status drives whether we offer "Dispatch fix". The
  // fix run is pinned to the MR's source branch so the implementer reworks the
  // SAME branch (not a fresh agent/issue-N), and carries the gitlab-* join keys
  // so it overlays back on this card.
  const latestPipeline = createMemo(() => (pipelines() ?? [])[0] ?? null);
  const ciFailed = createMemo(() => {
    const s = latestPipeline()?.status;
    return s === 'failed' || s === 'canceled';
  });
  const [showFix, setShowFix] = createSignal(false);
  const [fixResult, setFixResult] = createSignal<DispatchResponse | null>(null);
  const fixAttempts = createMemo(() => props.run?.ciFixAttempts ?? 0);

  async function postComment() {
    if (!comment().trim() || mrIID() === null) return;
    setBusy(true); setErr(null);
    try {
      await gitlabGroup.addMergeRequestNote(props.ctx.ns, props.ctx.intg, projectId(), mrIID()!, comment());
      setComment(''); refetchNotes();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function doMerge() {
    if (mrIID() === null) return;
    setBusy(true); setErr(null);
    try {
      if (issueIID() !== null) {
        await gitlabGroup.updateIssueLabels(props.ctx.ns, props.ctx.intg, projectId(), issueIID()!, {
          add_labels: 'agent::approved',
          remove_labels: 'agent::needs-review,agent::in-progress,agent::changes-requested',
        });
      }
      await gitlabGroup.merge(props.ctx.ns, props.ctx.intg, projectId(), mrIID()!, { should_remove_source_branch: true });
      setMerged(true); props.onMerged();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function doRequestChanges() {
    if (mrIID() === null) return;
    setBusy(true); setErr(null);
    try {
      const feedback = comment().trim();
      if (feedback) {
        // Record the feedback on the MR (for the human review thread)…
        await gitlabGroup.addMergeRequestNote(props.ctx.ns, props.ctx.intg, projectId(), mrIID()!, feedback);
        // …and on the ISSUE, because the re-fired PM/coder reads the issue notes
        // to learn what to change (the bridge re-fires off the issue label).
        if (issueIID() !== null) {
          await gitlabGroup.addProjectIssueNote(props.ctx.ns, props.ctx.intg, projectId(), issueIID()!,
            `**Changes requested** (human review):\n\n${feedback}`);
        }
        setComment(''); refetchNotes();
      }
      // The label move IS the event: agent::changes-requested is a board trigger,
      // so the bridge re-fires the PM to rework the existing MR on the next poll.
      if (issueIID() !== null) {
        await gitlabGroup.updateIssueLabels(props.ctx.ns, props.ctx.intg, projectId(), issueIID()!, {
          add_labels: 'agent::changes-requested', remove_labels: 'agent::needs-review',
        });
      }
      props.onMerged();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  return (
    <Show
      when={mrIID() !== null}
      fallback={<p class="text-[12.5px] text-text-muted">No merge request linked yet. The agent opens an MR when the card reaches <b>Needs Review</b>.</p>}
    >
      <Show when={mr.loading}><div class="grid place-items-center py-6"><Spinner size="sm" /></div></Show>
      <Show when={mr()}>
        {(data) => (
          <>
            <SectionLabel>Merge Request !{data().iid}</SectionLabel>
            <KV k="Title">{data().title}</KV>
            <KV k="Source">{data().source_branch} → {data().target_branch}</KV>
            <KV k="Status">{data().detailed_merge_status ?? data().merge_status ?? '—'}</KV>
            <Show when={data().web_url}><KV k="Link"><a class="text-accent hover:underline" href={data().web_url} target="_blank" rel="noreferrer">Open in GitLab ↗</a></KV></Show>

            <Show when={(pipelines()?.length ?? 0) > 0}>
              <SectionLabel>CI</SectionLabel>
              <div class="flex flex-wrap items-center gap-2">
                <For each={pipelines()!.slice(0, 4)}>{(p: GitPipeline) => <Badge variant={pipelineVariant(p.status)}>{p.status}</Badge>}</For>
                <Show when={fixAttempts() > 0}>
                  <span class="text-[10.5px] text-amber-400" title="console-dispatched fix runs">↻ fix ×{fixAttempts()}</span>
                </Show>
              </div>
              {/* Repair loop: offer a fix dispatch the moment CI is red. */}
              <Show when={ciFailed()}>
                <div class="mt-2 border border-red-500/30 bg-red-500/5 rounded-lg p-2.5">
                  <p class="text-[12px] text-text-secondary mb-2">
                    Pipeline {latestPipeline()!.status}. Dispatch an agent to read the failed jobs and rework
                    branch <span class="font-mono text-text">{data().source_branch}</span> in place.
                  </p>
                  <Show
                    when={!fixResult()?.blocked}
                    fallback={<p class="text-[12px] text-amber-300">{fixResult()!.reason}</p>}
                  >
                    <Show when={fixResult() && !fixResult()!.blocked}>
                      <p class="text-[12px] text-green-400 mb-2">✓ Dispatched {fixResult()!.run} (attempt {fixResult()!.attempt}/{fixResult()!.budget}).</p>
                    </Show>
                    <button
                      class="text-[12px] px-3 py-1.5 rounded-lg font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
                      disabled={busy()}
                      onClick={() => { setFixResult(null); setShowFix(true); }}
                    >
                      ↻ Dispatch fix agent
                    </button>
                  </Show>
                </div>
                <Show when={showFix()}>
                  <FixDispatchDialog
                    ctx={props.ctx}
                    defaultAgent={props.defaultFixAgent ?? null}
                    projectId={projectId()}
                    projectPath={props.projectsById().get(projectId())?.path_with_namespace}
                    mrIID={mrIID()!}
                    issueIID={issueIID()}
                    branch={data().source_branch}
                    targetBranch={data().target_branch}
                    failedPipelineStatus={latestPipeline()?.status}
                    attempts={fixAttempts()}
                    onClose={() => setShowFix(false)}
                    onDispatched={(res) => { setFixResult(res); setShowFix(false); props.onDispatched?.(); }}
                  />
                </Show>
              </Show>
            </Show>

            <SectionLabel>Changes</SectionLabel>
            <Show when={(data().changes?.length ?? 0) > 0} fallback={<p class="text-[12px] text-text-muted">No file changes.</p>}>
              <div class="flex flex-col gap-2">
                <For each={data().changes!.slice(0, 20)}>
                  {(ch) => <DiffCard toolName="diff" input={JSON.stringify({ filePath: ch.new_path })} output={ch.diff} isError={false} />}
                </For>
              </div>
            </Show>

            <SectionLabel>Review</SectionLabel>
            <div class="flex flex-col gap-2 mb-3">
              <For each={(notes() ?? []).filter((n: GitNote) => !n.system)}>
                {(n: GitNote) => (
                  <div class="flex gap-2.5 py-2 border-b border-border-subtle">
                    <span class="w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold text-white bg-accent flex-none">{(n.author?.username ?? '?').slice(0, 2).toUpperCase()}</span>
                    <div class="min-w-0">
                      <div class="text-[11.5px] font-semibold">{n.author?.username ?? 'unknown'} <span class="text-text-muted font-normal">· {relativeTime(n.created_at)}</span></div>
                      <p class="text-[12.5px] text-text-secondary whitespace-pre-wrap">{n.body}</p>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <textarea
              class="w-full bg-surface-2 border border-border-subtle rounded-lg p-2 text-[12.5px]"
              rows={2}
              placeholder="Leave a review comment…"
              value={comment()}
              onInput={(e) => setComment(e.currentTarget.value)}
            />
            <button disabled={busy() || !comment().trim()} class="mt-2 text-[12px] px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-2 hover:bg-surface-hover disabled:opacity-50" onClick={postComment}>
              Comment
            </button>

            <div class="mt-4 border border-yellow-500/40 bg-yellow-500/5 rounded-xl p-3">
              <h4 class="text-[13px] font-semibold flex items-center gap-2 mb-1">⎇ Human Merge Gate</h4>
              <Show
                when={isAuthDisabled() || isAuthenticated()}
                fallback={
                  <div>
                    <p class="text-[12px] text-text-secondary mb-2">Sign in with GitLab to merge as your identity.</p>
                    <button class="text-sm px-4 py-2 rounded-lg font-semibold text-accent border border-accent/40 hover:bg-accent/10" onClick={() => login()}>
                      Sign in to merge
                    </button>
                  </div>
                }
              >
                <p class="text-[12px] text-text-secondary mb-3">
                  {isAuthenticated() ? `Merging as ${currentUser()?.username}. ` : ''}Merging is human-only. The agent cannot merge its own MR.
                </p>
                <div class="flex flex-wrap gap-2">
                  <button disabled={busy() || merged()} class="text-sm px-4 py-2 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-500 disabled:opacity-50" onClick={doMerge}>
                    {merged() ? '✓ Merged' : 'Merge & Approve'}
                  </button>
                  <button disabled={busy() || merged()} class="text-sm px-4 py-2 rounded-lg font-semibold text-text border border-red-500/50 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50" onClick={doRequestChanges}>
                    Request Changes
                  </button>
                </div>
              </Show>
            </div>
            <Show when={err()}><p class="text-xs text-error mt-2">{err()}</p></Show>
          </>
        )}
      </Show>
    </Show>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix-dispatch dialog — the CI repair loop's action surface (report §9.2, §25).
// Creates a NEW AgentRun (the spec is immutable, so re-running = a new run)
// pinned to the MR's source branch, targeting the implementer agent by default
// with an override. The BFF enforces the retry budget and returns a blocked
// response once it's spent.
// ─────────────────────────────────────────────────────────────────────────────
function FixDispatchDialog(props: {
  ctx: WsCtx;
  defaultAgent: string | null;
  projectId: number;
  projectPath?: string;
  mrIID: number;
  issueIID: number | null;
  branch?: string;
  targetBranch?: string;
  failedPipelineStatus?: string;
  attempts: number;
  onClose: () => void;
  onDispatched: (res: DispatchResponse) => void;
}) {
  // Task agents only — daemons can't be dispatched via AgentRun. Default to the
  // board implementer (so the fix lands on the same branch), but allow override.
  const taskAgents = createMemo(() => (agentList() ?? []).filter((a) => a.mode === 'task'));
  const [agent, setAgent] = createSignal(props.defaultAgent ?? taskAgents()[0]?.name ?? '');
  const [brief, setBrief] = createSignal(
    `The pipeline on branch ${props.branch ?? '(this MR)'} is ${props.failedPipelineStatus ?? 'failing'}.\n\n` +
    `Read the failed CI jobs for MR !${props.mrIID}, find the root cause, and fix it on the SAME branch ` +
    `(${props.branch ?? 'the MR source branch'}). Push the fix so the pipeline re-runs. Do not open a new MR.`,
  );
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  async function dispatch() {
    if (!agent() || !brief().trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await agentRuns.dispatch({
        agentRef: agent(),
        prompt: brief(),
        ciFix: true,
        // Pin the run to the MR branch so the implementer reworks it in place.
        integrationRef: props.ctx.intg,
        branch: props.branch,
        baseBranch: props.targetBranch,
        project: props.projectPath,
        // Join keys → the run overlays back on this card.
        projectRef: props.projectPath ?? String(props.projectId),
        issueIID: props.issueIID != null ? String(props.issueIID) : undefined,
        mrIID: String(props.mrIID),
        intent: 'change',
      });
      props.onDispatched(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Portal>
      <div class="fixed inset-0 z-[60] bg-black/50 grid place-items-center p-4" onClick={props.onClose}>
        <div class="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-[14px] font-semibold">↻ Dispatch CI fix</h3>
            <span class="text-[11px] text-text-muted">MR !{props.mrIID}</span>
            <button class="ml-auto text-text-muted hover:text-text text-lg leading-none" onClick={props.onClose}>×</button>
          </div>

          <label class="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">Fix agent</label>
          <select
            class="w-full bg-surface-2 border border-border-subtle rounded-lg px-2 py-1.5 text-[12.5px] mb-3"
            value={agent()}
            onChange={(e) => setAgent(e.currentTarget.value)}
          >
            <Show when={taskAgents().length === 0}>
              <option value="">No task agents available</option>
            </Show>
            <For each={taskAgents()}>{(a) => <option value={a.name}>{a.name}{a.name === props.defaultAgent ? ' (implementer)' : ''}</option>}</For>
          </select>

          <label class="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">Task brief</label>
          <textarea
            class="w-full bg-surface-2 border border-border-subtle rounded-lg p-2 text-[12.5px] font-mono"
            rows={6}
            value={brief()}
            onInput={(e) => setBrief(e.currentTarget.value)}
          />

          <div class="flex items-center gap-2 mt-2 text-[11px] text-text-muted">
            <span>Branch <span class="font-mono text-text-secondary">{props.branch ?? '—'}</span></span>
            <Show when={props.attempts > 0}><span class="text-amber-400">· {props.attempts} prior fix run{props.attempts === 1 ? '' : 's'}</span></Show>
          </div>

          <Show when={err()}><p class="text-xs text-error mt-2">{err()}</p></Show>

          <div class="flex justify-end gap-2 mt-4">
            <button class="text-[12px] px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-2 hover:bg-surface-hover" onClick={props.onClose}>Cancel</button>
            <button
              class="text-[12px] px-4 py-1.5 rounded-lg font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
              disabled={busy() || !agent() || !brief().trim()}
              onClick={dispatch}
            >
              {busy() ? 'Dispatching…' : 'Dispatch fix'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────
function KV(props: { k: string; children: any }) {
  return (
    <div class="flex gap-2.5 py-1.5 text-[12.5px] border-b border-border-subtle">
      <span class="text-text-muted w-24 flex-none">{props.k}</span>
      <span class="min-w-0 break-words">{props.children}</span>
    </div>
  );
}
function SectionLabel(props: { children: any }) {
  return <div class="text-[11px] uppercase tracking-wider text-text-muted font-bold mt-4 mb-2">{props.children}</div>;
}
// Color-coded per agent:: state (carried over from the GitLab workspace — more
// legible than a monochrome chip). Non-agent labels fall back to the muted look.
function LabelChip(props: { label: string }) {
  const cls = createMemo(() => {
    switch (props.label) {
      case 'agent::planning': return 'bg-purple-500/15 text-purple-300 border-purple-500/40';
      case 'agent::todo': return 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40';
      case 'agent::in-progress': return 'bg-blue-500/15 text-blue-300 border-blue-500/40';
      case 'agent::needs-review': return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40';
      case 'agent::changes-requested': return 'bg-red-500/15 text-red-300 border-red-500/40';
      case 'agent::approved': return 'bg-green-500/15 text-green-300 border-green-500/40';
      default: return 'bg-surface-2 text-text-muted border-border-subtle';
    }
  });
  return <span class={`text-[10px] font-semibold rounded px-1.5 py-0.5 border ${cls()}`}>{props.label}</span>;
}
function pipelineVariant(status: string): 'success' | 'warning' | 'error' | 'muted' {
  switch (status) {
    case 'success': return 'success';
    case 'running':
    case 'pending':
    case 'created': return 'warning';
    case 'failed': return 'error';
    default: return 'muted';
  }
}

// CI pipeline status → traffic-light color (ported from the GitLab workspace).
function pipelineColor(status?: string): string {
  switch (status) {
    case 'success': return '#22c55e';
    case 'running': return '#3b82f6';
    case 'pending':
    case 'created':
    case 'scheduled':
    case 'waiting_for_resource':
    case 'preparing': return '#eab308';
    case 'failed': return '#ef4444';
    case 'canceled':
    case 'skipped': return '#71717a';
    case 'manual': return '#a855f7';
    default: return '#52525b';
  }
}

// Deterministic color from a string (language/contributor swatches).
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 65% 55%)`;
}

function formatBytes(n?: number): string {
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function StatCard(props: { label: string; value: string; hint?: string; accent?: boolean; onClick?: () => void }) {
  return (
    <Dynamic
      component={props.onClick ? 'button' : 'div'}
      onClick={props.onClick}
      class="text-left bg-surface-2 border border-border-subtle rounded-xl px-3 py-2.5 transition-colors"
      classList={{ 'hover:border-border cursor-pointer': !!props.onClick, 'border-accent/40': !!props.accent }}
    >
      <div class="text-[10px] uppercase tracking-wider text-text-muted font-bold">{props.label}</div>
      <div class="text-xl font-semibold mt-0.5" classList={{ 'text-accent': !!props.accent }}>{props.value}</div>
      <Show when={props.hint}><div class="text-[10.5px] text-text-muted">{props.hint}</div></Show>
    </Dynamic>
  );
}

function Panel(props: { title: string; action?: any; children: any }) {
  return (
    <div class="bg-surface-2 border border-border-subtle rounded-xl p-3">
      <div class="flex items-center gap-2 mb-2.5">
        <h3 class="text-[12.5px] font-semibold">{props.title}</h3>
        <Show when={props.action}><span class="ml-auto">{props.action}</span></Show>
      </div>
      {props.children}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Ported center views (from the retired GitLab workspace)
//
// These consume the SAME WsCtx + gitlabGroup.* read routes the board already
// uses, so no API changes were needed. Detail clicks route through Mission
// Control's single docked Cockpit — issues open the Conversation tab (openCard),
// merge requests open the Gate directly (openMR) — NOT a second slide-over.
// ═════════════════════════════════════════════════════════════════════════════

// ── Merge Requests view (paginated, state tabs, pipeline + run badges) ───────
function MergeRequestList(props: {
  ctx: WsCtx;
  projectFilter: Accessor<number | null>;
  search: Accessor<string>;
  author: Accessor<string>;
  labelFilter: Accessor<string>;
  projectsById: Accessor<Map<number, GitLabProject>>;
  resolveRun: (projectId: number, iid: number) => GroupRunJoin | undefined;
  onOpen: (projectId: number, mrIID: number, title: string, web_url?: string) => void;
}) {
  const [state, setState] = createSignal('opened');
  const [perPage, setPerPage] = createSignal(50);
  createEffect(() => { state(); props.search(); props.author(); props.labelFilter(); setPerPage(50); });
  const [mrs] = createResource(
    () => ({ ctx: props.ctx, state: state(), search: props.search(), author: props.author(), labels: props.labelFilter(), perPage: perPage() }),
    (k) =>
      gitlabGroup.mergeRequests(k.ctx.ns, k.ctx.intg, {
        state: k.state,
        search: k.search || undefined,
        author_username: k.author || undefined,
        labels: k.labels || undefined,
        per_page: k.perPage,
      }),
  );
  const visible = createMemo(() => {
    const pf = props.projectFilter();
    const list = mrs() ?? [];
    return pf === null ? list : list.filter((m) => m.project_id === pf);
  });
  const canLoadMore = createMemo(() => (mrs() ?? []).length >= perPage());

  return (
    <div class="p-4">
      <div class="flex items-center gap-2 mb-3">
        <For each={['opened', 'merged', 'closed', 'all']}>
          {(s) => (
            <button
              class="text-[12px] px-2.5 py-1 rounded-lg border transition-colors"
              classList={{ 'bg-accent/15 text-accent border-accent/40': state() === s, 'border-border-subtle bg-surface-2 hover:bg-surface-hover': state() !== s }}
              onClick={() => setState(s)}
            >
              {s}
            </button>
          )}
        </For>
        <span class="ml-auto text-xs text-text-muted">{visible().length} MRs</span>
      </div>

      <Show when={mrs.loading}><div class="grid place-items-center py-10"><Spinner /></div></Show>
      <Show when={mrs.error}><p class="text-xs text-error">Failed to load: {String(mrs.error)}</p></Show>

      <div class="flex flex-col gap-2">
        <For each={visible()}>
          {(mr) => {
            const run = props.resolveRun(mr.project_id, mr.iid!);
            const proj = props.projectsById().get(mr.project_id);
            return (
              <button
                class="text-left bg-surface-2 border border-border-subtle rounded-lg p-3 hover:border-border transition-colors"
                onClick={() => props.onOpen(mr.project_id, mr.iid!, mr.title, mr.web_url)}
              >
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-[11px] font-mono text-text-muted">!{mr.iid}</span>
                  <Show when={proj}><span class="text-[10px] font-mono text-text-muted">{proj!.name}</span></Show>
                  <Show when={mr.draft}><span class="text-[9px] uppercase font-bold text-yellow-400 bg-yellow-500/10 px-1 rounded">draft</span></Show>
                  <div class="ml-auto flex items-center gap-2">
                    <Show when={mr.pipeline?.status || mr.head_pipeline?.status}>
                      <Badge variant={pipelineVariant(mr.pipeline?.status || mr.head_pipeline?.status || '')}>
                        {mr.pipeline?.status || mr.head_pipeline?.status}
                      </Badge>
                    </Show>
                    <Show when={run}>
                      <Badge variant={phaseVariant(run!.phase)} dot={run!.phase === 'Running'}>{run!.phase ?? 'Pending'}</Badge>
                    </Show>
                  </div>
                </div>
                <p class="text-[13px] font-semibold mb-1">{mr.title}</p>
                <div class="flex items-center gap-2 text-[11px] text-text-muted">
                  <span class="font-mono">{mr.source_branch} → {mr.target_branch}</span>
                  <Show when={mr.has_conflicts}><span class="text-error">conflicts</span></Show>
                  <span class="ml-auto">{relativeTime(mr.updated_at)}</span>
                </div>
                <Show when={(mr.labels?.length ?? 0) > 0}>
                  <div class="flex flex-wrap gap-1 mt-2">
                    <For each={mr.labels!.slice(0, 6)}>{(l) => <LabelChip label={l} />}</For>
                  </div>
                </Show>
              </button>
            );
          }}
        </For>
        <Show when={!mrs.loading && visible().length === 0}>
          <p class="text-sm text-text-muted text-center py-10">No merge requests.</p>
        </Show>
        <Show when={canLoadMore()}>
          <button
            class="self-center mt-1 text-[12px] px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-2 hover:bg-surface-hover transition-colors disabled:opacity-50"
            disabled={mrs.loading}
            onClick={() => setPerPage((n) => n + 50)}
          >
            {mrs.loading ? 'Loading…' : 'Load more'}
          </button>
        </Show>
      </div>
    </div>
  );
}

// ── Issues view (paginated, state tabs, run badge). Detail → Cockpit (openCard).
function IssueList(props: {
  ctx: WsCtx;
  projectFilter: Accessor<number | null>;
  search: Accessor<string>;
  author: Accessor<string>;
  labelFilter: Accessor<string>;
  projectsById: Accessor<Map<number, GitLabProject>>;
  resolveRun: (projectId: number, iid: number) => GroupRunJoin | undefined;
  onOpen: (issue: GitGroupIssue) => void;
}) {
  const [state, setState] = createSignal('opened');
  const [perPage, setPerPage] = createSignal(50);
  createEffect(() => { state(); props.search(); props.author(); props.labelFilter(); setPerPage(50); });
  const [issues] = createResource(
    () => ({ ctx: props.ctx, state: state(), search: props.search(), author: props.author(), labels: props.labelFilter(), perPage: perPage() }),
    (k) =>
      gitlabGroup.issues(k.ctx.ns, k.ctx.intg, {
        state: k.state,
        search: k.search || undefined,
        author_username: k.author || undefined,
        labels: k.labels || undefined,
        per_page: k.perPage,
      }),
  );
  const visible = createMemo(() => {
    const pf = props.projectFilter();
    const list = issues() ?? [];
    return pf === null ? list : list.filter((i) => i.project_id === pf);
  });
  const canLoadMore = createMemo(() => (issues() ?? []).length >= perPage());

  return (
    <div class="p-4">
      <div class="flex items-center gap-2 mb-3">
        <For each={['opened', 'closed', 'all']}>
          {(s) => (
            <button
              class="text-[12px] px-2.5 py-1 rounded-lg border transition-colors"
              classList={{ 'bg-accent/15 text-accent border-accent/40': state() === s, 'border-border-subtle bg-surface-2 hover:bg-surface-hover': state() !== s }}
              onClick={() => setState(s)}
            >
              {s}
            </button>
          )}
        </For>
        <span class="ml-auto text-xs text-text-muted">{visible().length} issues</span>
      </div>

      <Show when={issues.loading}><div class="grid place-items-center py-10"><Spinner /></div></Show>
      <Show when={issues.error}><p class="text-xs text-error">Failed to load: {String(issues.error)}</p></Show>

      <div class="flex flex-col gap-2">
        <For each={visible()}>
          {(issue) => {
            const run = props.resolveRun(issue.project_id, issue.iid);
            const proj = props.projectsById().get(issue.project_id);
            return (
              <button
                class="text-left bg-surface-2 border border-border-subtle rounded-lg p-3 hover:border-border transition-colors"
                onClick={() => props.onOpen(issue)}
              >
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-[11px] font-mono text-text-muted">#{issue.iid}</span>
                  <Show when={proj}><span class="text-[10px] font-mono text-text-muted">{proj!.name}</span></Show>
                  <span class="text-[10px] px-1.5 py-0.5 rounded" classList={{ 'bg-success/15 text-success': issue.state === 'opened', 'bg-surface text-text-muted': issue.state !== 'opened' }}>{issue.state}</span>
                  <div class="ml-auto">
                    <Show when={run}>
                      <Badge variant={phaseVariant(run!.phase)} dot={run!.phase === 'Running'}>{run!.phase ?? 'Pending'}</Badge>
                    </Show>
                  </div>
                </div>
                <p class="text-[13px] font-semibold mb-1">{issue.title}</p>
                <div class="flex items-center gap-2 text-[11px] text-text-muted">
                  <Show when={issue.author}><span>{issue.author!.username}</span></Show>
                  <span class="ml-auto">{relativeTime(issue.updated_at)}</span>
                </div>
                <Show when={(issue.labels?.length ?? 0) > 0}>
                  <div class="flex flex-wrap gap-1 mt-2">
                    <For each={issue.labels!.slice(0, 6)}>{(l) => <LabelChip label={l} />}</For>
                  </div>
                </Show>
              </button>
            );
          }}
        </For>
        <Show when={!issues.loading && visible().length === 0}>
          <p class="text-sm text-text-muted text-center py-10">No issues.</p>
        </Show>
        <Show when={canLoadMore()}>
          <button
            class="self-center mt-1 text-[12px] px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-2 hover:bg-surface-hover transition-colors disabled:opacity-50"
            disabled={issues.loading}
            onClick={() => setPerPage((n) => n + 50)}
          >
            {issues.loading ? 'Loading…' : 'Load more'}
          </button>
        </Show>
      </div>
    </div>
  );
}

// ── Overview view (group dashboard ‖ per-project drill-down) ─────────────────
function OverviewTabView(props: {
  ctx: WsCtx;
  projectFilter: Accessor<number | null>;
  projects: Resource<GitLabProject[]>;
  milestones: Resource<GitMilestone[]>;
  pipelines: Resource<GroupProjectPipelineHealth[]>;
  joins: Resource<GroupRunJoin[]>;
  projectsById: Accessor<Map<number, GitLabProject>>;
  onSelectProject: (id: number | null) => void;
  onOpenView: (v: CenterView) => void;
  onOpenTrace: (traceID: string) => void;
}) {
  return (
    <Show
      when={props.projectFilter() === null}
      fallback={
        <ProjectDetailPanel
          ctx={props.ctx}
          projectId={props.projectFilter()!}
          project={props.projectsById().get(props.projectFilter()!)}
          joins={props.joins}
          onBack={() => props.onSelectProject(null)}
          onOpenTrace={props.onOpenTrace}
        />
      }
    >
      <GroupDashboard
        projects={props.projects}
        milestones={props.milestones}
        pipelines={props.pipelines}
        joins={props.joins}
        onSelectProject={props.onSelectProject}
        onOpenView={props.onOpenView}
        onOpenTrace={props.onOpenTrace}
      />
    </Show>
  );
}

function GroupDashboard(props: {
  projects: Resource<GitLabProject[]>;
  milestones: Resource<GitMilestone[]>;
  pipelines: Resource<GroupProjectPipelineHealth[]>;
  joins: Resource<GroupRunJoin[]>;
  onSelectProject: (id: number | null) => void;
  onOpenView: (v: CenterView) => void;
  onOpenTrace: (traceID: string) => void;
}) {
  const projectCount = () => props.projects()?.length ?? 0;
  const openIssues = () => (props.projects() ?? []).reduce((a, p) => a + (p.open_issues_count ?? 0), 0);
  const totalStars = () => (props.projects() ?? []).reduce((a, p) => a + (p.star_count ?? 0), 0);

  const ciHealth = createMemo(() => {
    const h = { success: 0, failed: 0, running: 0, other: 0, none: 0 };
    for (const p of props.pipelines() ?? []) {
      const s = p.pipeline?.status;
      if (!s) h.none++;
      else if (s === 'success') h.success++;
      else if (s === 'failed') h.failed++;
      else if (s === 'running' || s === 'pending') h.running++;
      else h.other++;
    }
    return h;
  });

  const runStats = createMemo(() => {
    const j = props.joins() ?? [];
    const byPhase = new Map<string, number>();
    let active = 0;
    for (const r of j) {
      byPhase.set(r.phase || 'Pending', (byPhase.get(r.phase || 'Pending') ?? 0) + 1);
      if (joinActive(r)) active++;
    }
    const max = Math.max(1, ...[...byPhase.values()]);
    return { total: j.length, active, max, byPhase: [...byPhase.entries()].sort((a, b) => b[1] - a[1]) };
  });

  const recentProjects = createMemo(() =>
    [...(props.projects() ?? [])]
      .sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''))
      .slice(0, 8),
  );
  const recentRuns = createMemo(() =>
    [...(props.joins() ?? [])]
      .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
      .slice(0, 6),
  );

  return (
    <div class="p-4 flex flex-col gap-4">
      {/* Stat row */}
      <div class="grid gap-3" style={{ 'grid-template-columns': 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <StatCard label="Projects" value={String(projectCount())} hint="in group" onClick={() => props.onSelectProject(null)} />
        <StatCard label="Open Issues" value={String(openIssues())} hint="across projects" onClick={() => props.onOpenView('issues')} />
        <StatCard label="Active Runs" value={String(runStats().active)} hint={`${runStats().total} total`} accent={runStats().active > 0} onClick={() => props.onOpenView('board')} />
        <StatCard label="CI Passing" value={`${ciHealth().success}/${(props.pipelines() ?? []).length}`} hint="latest pipelines" onClick={() => props.onOpenView('cicd')} />
        <StatCard label="Stars" value={String(totalStars())} hint="total" />
      </div>

      <div class="grid gap-4" style={{ 'grid-template-columns': 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {/* CI health */}
        <Panel title="CI/CD Health" action={<button class="text-[11px] text-accent hover:underline" onClick={() => props.onOpenView('cicd')}>View all →</button>}>
          <Show when={(props.pipelines() ?? []).length > 0} fallback={<p class="text-[12px] text-text-muted">No pipelines yet.</p>}>
            <div class="flex flex-col gap-2">
              <For each={props.pipelines()}>
                {(h) => (
                  <button
                    class="flex items-center gap-2 text-left hover:bg-surface-hover rounded-md px-1.5 py-1 transition-colors"
                    onClick={() => props.onSelectProject(h.project_id)}
                  >
                    <span class="w-2 h-2 rounded-full flex-none" style={{ 'background-color': pipelineColor(h.pipeline?.status) }} />
                    <span class="text-[12.5px] font-semibold truncate">{h.project_name}</span>
                    <span class="ml-auto text-[11px] text-text-muted">{h.pipeline?.status ?? 'none'}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Panel>

        {/* Agent work distribution */}
        <Panel title="Agent Run Distribution">
          <Show when={runStats().total > 0} fallback={<p class="text-[12px] text-text-muted">No agent runs joined to this group yet.</p>}>
            <div class="flex flex-col gap-2">
              <For each={runStats().byPhase}>
                {([phase, n]) => (
                  <div class="flex items-center gap-2">
                    <span class="text-[11.5px] w-24 flex-none truncate">{phase}</span>
                    <div class="flex-1 h-3 rounded bg-surface overflow-hidden">
                      <div class="h-full rounded" style={{ width: `${(n / runStats().max) * 100}%`, 'background-color': phaseVariant(phase) === 'success' ? '#22c55e' : phaseVariant(phase) === 'error' ? '#ef4444' : '#3b82f6' }} />
                    </div>
                    <span class="text-[11px] text-text-muted w-6 text-right">{n}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Panel>

        {/* Milestones */}
        <Panel title="Milestones">
          <Show when={(props.milestones() ?? []).length > 0} fallback={<p class="text-[12px] text-text-muted">No active milestones.</p>}>
            <div class="flex flex-col gap-2">
              <For each={props.milestones()}>
                {(m) => (
                  <a
                    class="flex items-center gap-2 hover:bg-surface-hover rounded-md px-1.5 py-1 transition-colors"
                    href={m.web_url} target="_blank" rel="noreferrer"
                  >
                    <span class="text-[12.5px] font-semibold truncate">{m.title}</span>
                    <Show when={m.expired}><span class="text-[10px] text-error font-bold">overdue</span></Show>
                    <span class="ml-auto text-[11px] text-text-muted">{m.due_date ? `due ${m.due_date}` : m.state}</span>
                  </a>
                )}
              </For>
            </div>
          </Show>
        </Panel>

        {/* Recent activity */}
        <Panel title="Recent Activity">
          <div class="flex flex-col gap-1.5">
            <For each={recentProjects()}>
              {(p) => (
                <button class="flex items-center gap-2 text-left hover:bg-surface-hover rounded-md px-1.5 py-1 transition-colors" onClick={() => props.onSelectProject(p.id)}>
                  <span class="text-[12.5px] font-semibold truncate">{p.name}</span>
                  <span class="ml-auto text-[11px] text-text-muted">{relativeTime(p.last_activity_at)}</span>
                </button>
              )}
            </For>
          </div>
          <Show when={recentRuns().length > 0}>
            <div class="mt-3 pt-3 border-t border-border-subtle">
              <div class="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1.5">Latest agent runs</div>
              <For each={recentRuns()}>
                {(r) => (
                  <div class="flex items-center gap-2 px-1.5 py-1">
                    <Badge variant={phaseVariant(r.phase)} dot={joinActive(r)}>{r.phase ?? 'Pending'}</Badge>
                    <span class="text-[11.5px] truncate">#{r.iid} · {r.agentRef}</span>
                    <Show when={r.traceID}>
                      <button class="ml-auto text-[11px] text-accent hover:underline" onClick={() => props.onOpenTrace(r.traceID!)} title="Open trace waterfall">⌁ trace</button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Panel>
      </div>
    </div>
  );
}

// Per-project drill-down (Overview, a project selected via the dashboard).
function ProjectDetailPanel(props: {
  ctx: WsCtx;
  projectId: number;
  project?: GitLabProject;
  joins: Resource<GroupRunJoin[]>;
  onBack: () => void;
  onOpenTrace: (traceID: string) => void;
}) {
  const key = () => ({ ...props.ctx, project: props.projectId });
  const [detail] = createResource(key, (k) => gitlabGroup.projectDetail(k.ns, k.intg, k.project));
  const [languages] = createResource(key, (k) => gitlabGroup.projectLanguages(k.ns, k.intg, k.project));
  const [pipelines] = createResource(key, (k) => gitlabGroup.projectPipelines(k.ns, k.intg, k.project, { per_page: 8 }));
  const [commits] = createResource(key, (k) => gitlabGroup.projectCommits(k.ns, k.intg, k.project, { per_page: 8 }));
  const [contributors] = createResource(key, (k) => gitlabGroup.projectContributors(k.ns, k.intg, k.project));
  const [releases] = createResource(key, (k) => gitlabGroup.projectReleases(k.ns, k.intg, k.project));
  const [branches] = createResource(key, (k) => gitlabGroup.projectBranches(k.ns, k.intg, k.project));

  const langEntries = createMemo(() =>
    Object.entries(languages() ?? {}).sort((a, b) => b[1] - a[1]),
  );
  const head = () => detail() ?? props.project;

  return (
    <div class="p-4 flex flex-col gap-4">
      {/* Header */}
      <div class="flex items-start gap-3">
        <button class="text-[12px] text-accent hover:underline flex-none mt-0.5" onClick={props.onBack}>← All projects</button>
        <div class="min-w-0">
          <h2 class="text-base font-semibold truncate">{head()?.name ?? `project ${props.projectId}`}</h2>
          <Show when={head()?.description}><p class="text-[12.5px] text-text-muted mt-0.5">{head()!.description}</p></Show>
          <div class="flex items-center gap-2 mt-1 text-[11px] text-text-muted">
            <Show when={head()?.path_with_namespace}><span class="font-mono">{head()!.path_with_namespace}</span></Show>
            <Show when={head()?.web_url}><a class="text-accent hover:underline" href={head()!.web_url} target="_blank" rel="noreferrer">Open in GitLab ↗</a></Show>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div class="grid gap-3" style={{ 'grid-template-columns': 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <StatCard label="Open Issues" value={String(head()?.open_issues_count ?? 0)} />
        <StatCard label="Stars" value={String(head()?.star_count ?? 0)} />
        <StatCard label="Forks" value={String(head()?.forks_count ?? 0)} />
        <StatCard label="Commits" value={String(head()?.statistics?.commit_count ?? '—')} />
        <StatCard label="Repo Size" value={formatBytes(head()?.statistics?.repository_size)} />
      </div>

      {/* Languages */}
      <Show when={langEntries().length > 0}>
        <Panel title="Languages">
          <div class="flex h-3 rounded overflow-hidden mb-2">
            <For each={langEntries()}>
              {([lang, pct]) => <div class="h-full" style={{ width: `${pct}%`, 'background-color': hashColor(lang) }} title={`${lang} ${pct.toFixed(1)}%`} />}
            </For>
          </div>
          <div class="flex flex-wrap gap-2.5">
            <For each={langEntries()}>
              {([lang, pct]) => (
                <span class="flex items-center gap-1.5 text-[11.5px]">
                  <span class="w-2.5 h-2.5 rounded-sm" style={{ 'background-color': hashColor(lang) }} />
                  {lang} <span class="text-text-muted">{pct.toFixed(1)}%</span>
                </span>
              )}
            </For>
          </div>
        </Panel>
      </Show>

      <div class="grid gap-4" style={{ 'grid-template-columns': 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {/* Pipelines */}
        <Panel title="Recent Pipelines">
          <Show when={(pipelines() ?? []).length > 0} fallback={<p class="text-[12px] text-text-muted">No pipelines.</p>}>
            <div class="flex flex-col gap-1.5">
              <For each={pipelines()}>
                {(p) => (
                  <a class="flex items-center gap-2 hover:bg-surface-hover rounded-md px-1.5 py-1 transition-colors" href={p.web_url} target="_blank" rel="noreferrer">
                    <span class="w-2 h-2 rounded-full flex-none" style={{ 'background-color': pipelineColor(p.status) }} />
                    <span class="text-[12px] font-mono truncate">{p.ref ?? p.sha?.slice(0, 8)}</span>
                    <span class="ml-auto text-[11px] text-text-muted">{p.status}</span>
                    <span class="text-[11px] text-text-muted">{relativeTime(p.updated_at ?? p.created_at)}</span>
                  </a>
                )}
              </For>
            </div>
          </Show>
        </Panel>

        {/* Commits */}
        <Panel title="Recent Commits">
          <Show when={(commits() ?? []).length > 0} fallback={<p class="text-[12px] text-text-muted">No commits.</p>}>
            <div class="flex flex-col gap-1.5">
              <For each={commits()}>
                {(c) => (
                  <div class="flex items-center gap-2 px-1.5 py-1">
                    <span class="text-[11px] font-mono text-text-muted flex-none">{c.short_id ?? c.id?.slice(0, 8) ?? c.sha?.slice(0, 8)}</span>
                    <span class="text-[12px] truncate">{c.title ?? c.message}</span>
                    <span class="ml-auto text-[11px] text-text-muted flex-none">{relativeTime(c.committed_date ?? c.authored_date)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Panel>

        {/* Contributors */}
        <Panel title="Contributors">
          <Show when={(contributors() ?? []).length > 0} fallback={<p class="text-[12px] text-text-muted">No contributors.</p>}>
            <div class="flex flex-col gap-1.5">
              <For each={(contributors() ?? []).slice(0, 8)}>
                {(c) => (
                  <div class="flex items-center gap-2 px-1.5 py-1">
                    <span class="w-5 h-5 rounded-full grid place-items-center text-[9px] font-bold text-white flex-none" style={{ 'background-color': hashColor(c.name) }}>{c.name.slice(0, 2).toUpperCase()}</span>
                    <span class="text-[12px] truncate">{c.name}</span>
                    <span class="ml-auto text-[11px] text-text-muted">{c.commits} commits</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Panel>

        {/* Releases + branches */}
        <Panel title="Releases & Branches">
          <Show when={(releases() ?? []).length > 0} fallback={<p class="text-[12px] text-text-muted">No releases.</p>}>
            <div class="flex flex-col gap-1.5 mb-3">
              <For each={(releases() ?? []).slice(0, 5)}>
                {(r) => (
                  <div class="flex items-center gap-2 px-1.5 py-1">
                    <span class="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface text-text-muted flex-none">{r.tag_name}</span>
                    <span class="text-[12px] truncate">{r.name ?? r.tag_name}</span>
                    <span class="ml-auto text-[11px] text-text-muted">{relativeTime(r.released_at ?? r.created_at)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={(branches() ?? []).length > 0}>
            <div class="flex flex-wrap gap-1.5">
              <For each={(branches() ?? []).slice(0, 12)}>
                {(b) => (
                  <span class="text-[10.5px] font-mono px-1.5 py-0.5 rounded border border-border-subtle bg-surface" classList={{ 'text-accent border-accent/40': b.default }}>
                    {b.name}{b.default ? ' ●' : ''}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </Panel>
      </div>
    </div>
  );
}

// ── CI/CD view (group-wide health grid ‖ per-project pipeline history) ───────
function CICDTabView(props: {
  ctx: WsCtx;
  projectFilter: Accessor<number | null>;
  pipelines: Resource<GroupProjectPipelineHealth[]>;
  pipelinesLoading: Accessor<boolean>;
  onBack: () => void;
}) {
  const [filter, setFilter] = createSignal('');
  const visible = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const list = props.pipelines() ?? [];
    return q ? list.filter((h) => (h.project_name ?? '').toLowerCase().includes(q)) : list;
  });
  return (
    <Show
      when={props.projectFilter() === null}
      fallback={<ProjectPipelineHistory ctx={props.ctx} projectId={props.projectFilter()!} onBack={props.onBack} />}
    >
      <div class="p-4">
        <div class="mb-3">
          <input
            class="w-full max-w-xs bg-surface-2 border border-border-subtle rounded-lg px-2.5 py-1.5 text-[12px]"
            placeholder="Filter pipelines by project…"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
        </div>
        <Show when={props.pipelinesLoading()}><div class="grid place-items-center py-10"><Spinner /></div></Show>
        <Show when={!props.pipelinesLoading() && (props.pipelines() ?? []).length === 0}>
          <p class="text-sm text-text-muted text-center py-10">No pipelines across the group yet.</p>
        </Show>
        <div class="grid gap-3" style={{ 'grid-template-columns': 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          <For each={visible()}>
            {(h) => (
              <a
                class="bg-surface-2 border border-border-subtle rounded-xl p-3 hover:border-border transition-colors block"
                href={h.pipeline?.web_url || h.web_url} target="_blank" rel="noreferrer"
              >
                <div class="flex items-center gap-2 mb-2">
                  <span class="w-2.5 h-2.5 rounded-full flex-none" style={{ 'background-color': pipelineColor(h.pipeline?.status) }} />
                  <span class="text-[13px] font-semibold truncate">{h.project_name}</span>
                  <Show when={h.pipeline}>
                    <Badge variant={pipelineVariant(h.pipeline!.status)}>{h.pipeline!.status}</Badge>
                  </Show>
                </div>
                <Show when={h.pipeline} fallback={<p class="text-[11.5px] text-text-muted">No pipeline on {h.default_branch ?? 'default branch'}.</p>}>
                  <div class="flex items-center gap-2 text-[11px] text-text-muted">
                    <span class="font-mono">{h.pipeline!.ref ?? h.default_branch}</span>
                    <span class="ml-auto">{relativeTime(h.pipeline!.updated_at ?? h.pipeline!.created_at)}</span>
                  </div>
                </Show>
              </a>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

function ProjectPipelineHistory(props: { ctx: WsCtx; projectId: number; onBack: () => void }) {
  const key = () => ({ ...props.ctx, project: props.projectId });
  const [pipelines] = createResource(key, (k) => gitlabGroup.projectPipelines(k.ns, k.intg, k.project, { per_page: 30 }));
  const [logJob, setLogJob] = createSignal<GitJob | null>(null);

  return (
    <div class="p-4">
      <button class="text-[12px] text-accent hover:underline mb-3" onClick={props.onBack}>← All pipelines</button>
      <Show when={pipelines.loading}><div class="grid place-items-center py-10"><Spinner /></div></Show>
      <Show when={!pipelines.loading && (pipelines() ?? []).length === 0}>
        <p class="text-sm text-text-muted text-center py-10">No pipelines for this project.</p>
      </Show>
      <div class="flex flex-col gap-1.5">
        <For each={pipelines()}>
          {(p) => (
            <PipelineRow ctx={props.ctx} projectId={props.projectId} pipeline={p} onOpenLog={setLogJob} />
          )}
        </For>
      </div>
      <Show when={logJob()}>
        <JobLogModal ctx={props.ctx} projectId={props.projectId} job={logJob()!} onClose={() => setLogJob(null)} />
      </Show>
    </div>
  );
}

function PipelineRow(props: {
  ctx: WsCtx;
  projectId: number;
  pipeline: GitPipeline;
  onOpenLog: (j: GitJob) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const jobKey = () => (open() ? { ...props.ctx, project: props.projectId, pipeline: props.pipeline.id } : null);
  const [jobs] = createResource(jobKey, (k) => gitlabGroup.projectPipelineJobs(k.ns, k.intg, k.project, k.pipeline));
  const stages = createMemo(() => {
    const map = new Map<string, GitJob[]>();
    for (const j of jobs() ?? []) {
      const s = j.stage || 'default';
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(j);
    }
    return [...map.entries()];
  });

  return (
    <div class="bg-surface-2 border border-border-subtle rounded-lg overflow-hidden">
      <div class="flex items-center gap-3 px-3 py-2">
        <button class="text-text-muted hover:text-text text-[11px] w-4 flex-none" onClick={() => setOpen(!open())} title="Toggle jobs">
          {open() ? '▾' : '▸'}
        </button>
        <span class="w-2.5 h-2.5 rounded-full flex-none" style={{ 'background-color': pipelineColor(props.pipeline.status) }} />
        <Badge variant={pipelineVariant(props.pipeline.status)}>{props.pipeline.status}</Badge>
        <span class="text-[12px] font-mono truncate">{props.pipeline.ref ?? props.pipeline.sha?.slice(0, 12)}</span>
        <Show when={props.pipeline.source}><span class="text-[10.5px] text-text-muted">{props.pipeline.source}</span></Show>
        <a class="ml-auto text-[11px] text-text-muted hover:text-text" href={props.pipeline.web_url} target="_blank" rel="noreferrer">#{props.pipeline.id} ↗</a>
        <span class="text-[11px] text-text-muted">{relativeTime(props.pipeline.updated_at ?? props.pipeline.created_at)}</span>
      </div>
      <Show when={open()}>
        <div class="border-t border-border-subtle px-3 py-2.5 bg-surface/40">
          <Show when={jobs.loading}><div class="grid place-items-center py-4"><Spinner size="sm" /></div></Show>
          <Show when={!jobs.loading && (jobs() ?? []).length === 0}>
            <p class="text-[11.5px] text-text-muted py-2">No jobs for this pipeline.</p>
          </Show>
          <div class="flex flex-col gap-2.5">
            <For each={stages()}>
              {([stage, stageJobs]) => (
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">{stage}</div>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={stageJobs}>
                      {(j) => (
                        <button
                          class="flex items-center gap-1.5 bg-surface-2 border border-border-subtle rounded-md px-2 py-1 text-[11.5px] hover:border-border transition-colors"
                          onClick={() => props.onOpenLog(j)}
                          title={`${j.name} — ${j.status}${j.allow_failure ? ' (allowed to fail)' : ''}`}
                        >
                          <span class="w-2 h-2 rounded-full flex-none" style={{ 'background-color': pipelineColor(j.status) }} />
                          <span class="truncate max-w-[160px]">{j.name}</span>
                          <Show when={j.duration}><span class="text-text-muted text-[10px]">{Math.round(j.duration!)}s</span></Show>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

function JobLogModal(props: { ctx: WsCtx; projectId: number; job: GitJob; onClose: () => void }) {
  const [trace] = createResource(
    () => ({ ...props.ctx, project: props.projectId, job: props.job.id }),
    (k) => gitlabGroup.projectJobTrace(k.ns, k.intg, k.project, k.job),
  );
  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });
  return (
    <Portal>
    <div class="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-6" onClick={props.onClose}>
      <div class="bg-surface border border-border rounded-xl w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle">
          <span class="w-2.5 h-2.5 rounded-full flex-none" style={{ 'background-color': pipelineColor(props.job.status) }} />
          <b class="text-[13px]">{props.job.name}</b>
          <Badge variant={pipelineVariant(props.job.status)}>{props.job.status}</Badge>
          <Show when={props.job.stage}><span class="text-[11px] text-text-muted">{props.job.stage}</span></Show>
          <div class="ml-auto flex items-center gap-2">
            <Show when={props.job.web_url}>
              <a class="text-[11px] text-text-muted hover:text-text" href={props.job.web_url} target="_blank" rel="noreferrer">Open in GitLab ↗</a>
            </Show>
            <button class="text-text-muted hover:text-text px-1" onClick={props.onClose} title="Close (Esc)">✕</button>
          </div>
        </div>
        <div class="flex-1 overflow-auto p-3">
          <Show when={trace.loading}><div class="grid place-items-center py-10"><Spinner /></div></Show>
          <Show when={!trace.loading}>
            <pre class="text-[11px] font-mono whitespace-pre-wrap leading-relaxed text-text-secondary">{trace() || 'No log output.'}</pre>
          </Show>
        </div>
      </div>
    </div>
    </Portal>
  );
}
