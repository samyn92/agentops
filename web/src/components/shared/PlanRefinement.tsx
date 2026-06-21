// PlanRefinement — the unified plan refinement cockpit view.
//
// Replaces the Conversation tab for cards in "Planning". Combines:
//  - Plan body (issue description) with inline edit
//  - GitLab discussion thread (issue notes — human + bot interleaved)
//  - Comment box (posts to GitLab as the OIDC user)
//  - "Revise" button (posts comment + steers the PM daemon to re-plan)
//  - "Approve → Todo" button (moves the card forward, triggers agent dispatch)
//
// The key insight: the GitLab issue thread IS the refinement conversation.
// The agent is just another participant. No parallel chat needed.
import {
  createSignal,
  createResource,
  Show,
  For,
  type Accessor,
} from 'solid-js';
import { gitlabGroup } from '../../lib/api';
import type { GitGroupIssue, GitNote } from '../../types';
import { relativeTime } from '../../lib/format';
import Markdown from '../shared/Markdown';
import Spinner from '../shared/Spinner';
import { GitLabIcon } from '../shared/Icons';

export interface PlanRefinementProps {
  /** Workspace context for API calls. */
  ctx: { ns: string; intg: string };
  /** The issue being refined. */
  issue: GitGroupIssue;
  /** PM daemon agent (for steer). */
  pmDaemon: Accessor<{ ns: string; name: string } | null>;
  /** Called after the card is moved (e.g. approved → refetch board). */
  onMoved: () => void;
}

export default function PlanRefinement(props: PlanRefinementProps) {
  // ── State ──
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal('');
  const [comment, setComment] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [streaming, setStreaming] = createSignal(false);

  // ── Data fetching ──
  const issueKey = () => ({ ns: props.ctx.ns, intg: props.ctx.intg, project: props.issue.project_id, iid: props.issue.iid });

  const [detail, { refetch: refetchDetail }] = createResource(issueKey, (k) =>
    gitlabGroup.projectIssue(k.ns, k.intg, k.project, k.iid)
  );

  const [notes, { refetch: refetchNotes }] = createResource(issueKey, (k) =>
    gitlabGroup.projectIssueNotes(k.ns, k.intg, k.project, k.iid)
  );

  // Filter out system notes.
  const discussion = () => (notes() ?? []).filter(n => !n.system);

  const pm = () => props.pmDaemon();

  // ── Actions ──

  async function saveDescription() {
    setBusy(true); setErr(null);
    try {
      await gitlabGroup.updateProjectIssue(
        props.ctx.ns, props.ctx.intg, props.issue.project_id, props.issue.iid,
        { description: editText() }
      );
      setEditing(false);
      refetchDetail();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  async function revise() {
    const feedback = comment().trim();
    if (!feedback) {
      setErr('Type your feedback first');
      return;
    }
    setBusy(true); setErr(null);
    try {
      // 1. Post the feedback as a GitLab note (visible in GitLab too).
      await gitlabGroup.addProjectIssueNote(
        props.ctx.ns, props.ctx.intg, props.issue.project_id, props.issue.iid,
        `**Refinement request:**\n\n${feedback}`
      );
      setComment('');
      refetchNotes();

      // 2. Prompt the PM agent with full context — BFF orchestrates:
      //    fetch issue → prompt agent → update description → return.
      const daemon = pm();
      const agentName = daemon?.name ?? 'svc-pm';
      setStreaming(true);

      await gitlabGroup.refineIssue(
        props.ctx.ns, props.ctx.intg, props.issue.project_id, props.issue.iid,
        feedback, agentName
      );

      // Agent responded and BFF updated the description — refetch.
      setStreaming(false);
      refetchNotes();
      refetchDetail();
    } catch (e) { setErr(String(e)); setStreaming(false); }
    finally { setBusy(false); }
  }

  function startEdit() {
    setEditText(detail()?.description ?? props.issue.description ?? '');
    setEditing(true);
  }

  // ── Render ──
  return (
    <div class="flex flex-col h-full">
      {/* Plan body — scrollable, max 60% height */}
      <div class="flex-shrink-0 px-4 pt-4 pb-2 max-h-[60%] flex flex-col">
        <div class="flex items-center justify-between mb-2 flex-shrink-0">
          <h3 class="text-[12px] font-semibold uppercase tracking-wider text-text-muted">Plan</h3>
          <Show when={!editing()}>
            <button
              class="text-[11px] text-accent hover:text-accent/80 font-medium"
              onClick={startEdit}
            >
              Edit plan
            </button>
          </Show>
        </div>

        <Show when={editing()} fallback={
          <div class="text-[12.5px] bg-surface-2 border border-border-subtle rounded-lg p-3 overflow-auto flex-1 min-h-0">
            <Show when={detail()?.description ?? props.issue.description} fallback={
              <p class="text-text-muted italic">No plan description yet. Click "Edit plan" to add one.</p>
            }>
              <Markdown content={(detail()?.description ?? props.issue.description)!} />
            </Show>
          </div>
        }>
          <div class="flex flex-col gap-2">
            <textarea
              class="w-full bg-surface-2 border border-border rounded-lg p-3 text-[12.5px] font-mono resize-y min-h-[120px] max-h-[300px] outline-none focus:border-accent"
              value={editText()}
              onInput={e => setEditText(e.currentTarget.value)}
              placeholder="Write the plan in markdown..."
            />
            <div class="flex items-center gap-2">
              <button
                class="text-[11.5px] px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50"
                disabled={busy()}
                onClick={saveDescription}
              >
                Save
              </button>
              <button
                class="text-[11.5px] px-3 py-1.5 rounded-lg border border-border text-text-muted hover:text-text-secondary"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* Divider */}
      <div class="flex items-center gap-2 px-4 py-2">
        <div class="h-px flex-1 bg-border-subtle" />
        <span class="text-[10.5px] font-medium text-text-muted uppercase tracking-wider">Discussion</span>
        <div class="h-px flex-1 bg-border-subtle" />
      </div>

      {/* Discussion thread */}
      <div class="flex-1 min-h-0 overflow-auto px-4 pb-2">
        <Show when={notes()} fallback={<div class="py-4 grid place-items-center"><Spinner size="sm" /></div>}>
          <Show when={discussion().length === 0}>
            <p class="text-[12px] text-text-muted text-center py-6 italic">
              No discussion yet. Add feedback below to refine the plan.
            </p>
          </Show>
          <For each={discussion()}>
            {n => <NoteItem note={n} />}
          </For>

          {/* Live streaming indicator */}
          <Show when={streaming()}>
            <div class="flex gap-2.5 py-2 animate-in fade-in">
              <span class="w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold bg-blue-500/15 text-blue-400 flex-none uppercase">
                {pm()?.name?.slice(0, 2) ?? 'AI'}
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 mb-0.5">
                  <span class="text-[11.5px] font-medium text-blue-400">{pm()?.name ?? 'agent'}</span>
                  <span class="mc-live-dot w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span class="text-[10.5px] text-text-muted">revising plan...</span>
                </div>
                <div class="text-[12px] text-text-secondary bg-surface-2 border border-border-subtle rounded-lg p-2.5">
                  <span class="text-text-muted">Agent is processing your feedback. Response will appear here shortly...</span>
                </div>
              </div>
            </div>
          </Show>
        </Show>
      </div>

      {/* Comment box — every comment triggers agent revision */}
      <div class="flex-shrink-0 border-t border-border px-4 py-3">
        <Show when={err()}>
          <p class="text-[11px] text-red-400 mb-2">{err()}</p>
        </Show>

        <div class="flex gap-2 items-end">
          <textarea
            class="flex-1 bg-surface-2 border border-border-subtle rounded-lg px-3 py-2 text-[12.5px] resize-none min-h-[44px] max-h-[120px] outline-none focus:border-accent placeholder:text-text-muted"
            placeholder="Request changes to the plan..."
            value={comment()}
            onInput={e => setComment(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                revise();
              }
            }}
          />
          <button
            class="text-[11.5px] px-3 py-2 rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 transition-colors flex-none"
            disabled={busy() || !comment().trim()}
            onClick={revise}
          >
            {busy() ? 'Revising...' : 'Send'}
          </button>
        </div>
        <div class="flex items-center mt-1.5">
          <span class="text-[10px] text-text-muted">Cmd+Enter to send. Agent will revise the plan based on your feedback.</span>
          <Show when={props.issue.web_url}>
            <a
              class="ml-auto flex items-center gap-1 text-[10.5px] text-text-muted hover:text-[#FC6D26] transition-colors"
              href={props.issue.web_url}
              target="_blank"
              rel="noreferrer"
            >
              <GitLabIcon class="w-3.5 h-3.5" />
              <span>View in GitLab</span>
            </a>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ── Note item ──

function NoteItem(props: { note: GitNote }) {
  const isBot = () => {
    const author = props.note.author?.username ?? '';
    return author.includes('bot') || author.includes('agentops') || author.startsWith('project_');
  };

  return (
    <div class="flex gap-2.5 py-2">
      <span
        class="w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold flex-none uppercase"
        classList={{
          'bg-blue-500/15 text-blue-400': isBot(),
          'bg-purple-500/15 text-purple-400': !isBot(),
        }}
      >
        {(props.note.author?.username ?? '?').slice(0, 2)}
      </span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 mb-0.5">
          <span class="text-[11.5px] font-medium" classList={{ 'text-blue-400': isBot(), 'text-purple-400': !isBot() }}>
            {props.note.author?.username ?? 'unknown'}
          </span>
          <Show when={isBot()}>
            <span class="text-[9px] px-1 py-px rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">bot</span>
          </Show>
          <span class="text-[10.5px] text-text-muted">
            {props.note.created_at ? relativeTime(props.note.created_at) : ''}
          </span>
        </div>
        <div class="text-[12px] text-text-secondary">
          <Markdown content={props.note.body} />
        </div>
      </div>
    </div>
  );
}
