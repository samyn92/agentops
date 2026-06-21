// NewPlanModal — create a new plan (GitLab issue with agent::planning label).
//
// Flow:
//   1. Pick target repo (from workspace scope)
//   2. Write title + description (the plan)
//   3. Create → GitLab issue with agent::planning label
//   4. Card appears in Planning column
import {
  createSignal,
  Show,
  For,
  type Accessor,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { gitlabGroup } from '../../lib/api';
import { GitLabIcon } from '../shared/Icons';

export interface NewPlanModalProps {
  open: Accessor<boolean>;
  onClose: () => void;
  /** Workspace context. */
  ctx: { ns: string; intg: string };
  /** Available projects in the workspace. */
  projects: Accessor<Array<{ id: number; name: string; path_with_namespace: string }> | undefined>;
  /** Called after issue is created (refetch board). */
  onCreated: () => void;
}

export default function NewPlanModal(props: NewPlanModalProps) {
  const [selectedProject, setSelectedProject] = createSignal<number | null>(null);
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  function reset() {
    setTitle('');
    setDescription('');
    setErr(null);
    setSelectedProject(null);
  }

  function close() {
    reset();
    props.onClose();
  }

  async function create() {
    if (!title().trim()) { setErr('Title is required'); return; }
    if (selectedProject() == null) { setErr('Select a target repository'); return; }

    setBusy(true); setErr(null);
    try {
      const projectId = selectedProject()!;
      const body: Record<string, string> = {
        title: title().trim(),
        labels: 'agent::planning',
      };
      if (description().trim()) {
        body.description = description().trim();
      }

      // POST to GitLab via the BFF proxy
      const res = await fetch(`/api/v1/integrations/${props.ctx.ns}/${props.ctx.intg}/group/projects/${projectId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      close();
      props.onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.open()}>
      <Portal>
        <div class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[8vh] px-4" onClick={close}>
          <div
            class="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div class="flex items-center gap-2 px-5 py-4 border-b border-border">
              <span class="text-[15px]">&#9998;</span>
              <h2 class="text-[14px] font-semibold">New Plan</h2>
              <span class="ml-auto text-[11px] text-text-muted">Creates an issue with agent::planning label</span>
            </div>

            {/* Body */}
            <div class="px-5 py-4 flex flex-col gap-4">
              {/* Target repo */}
              <div>
                <label class="text-[11.5px] font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                  Target Repository
                </label>
                <div class="grid grid-cols-1 gap-1.5 max-h-32 overflow-y-auto">
                  <For each={props.projects() ?? []}>
                    {(p) => (
                      <button
                        class="flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-[12.5px] transition-colors"
                        classList={{
                          'border-accent bg-accent/5': selectedProject() === p.id,
                          'border-border-subtle hover:border-border hover:bg-surface-2': selectedProject() !== p.id,
                        }}
                        onClick={() => setSelectedProject(p.id)}
                      >
                        <GitLabIcon class="w-3.5 h-3.5 text-[#FC6D26] flex-none" />
                        <span class="font-semibold">{p.name}</span>
                        <span class="text-text-muted font-mono text-[10.5px] ml-auto">{p.path_with_namespace}</span>
                      </button>
                    )}
                  </For>
                </div>
                <Show when={(props.projects() ?? []).length === 0}>
                  <p class="text-[12px] text-text-muted italic">No projects loaded yet.</p>
                </Show>
              </div>

              {/* Title */}
              <div>
                <label class="text-[11.5px] font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                  Title
                </label>
                <input
                  class="w-full bg-surface-2 border border-border-subtle rounded-lg px-3 py-2 text-[13px] outline-none focus:border-accent"
                  placeholder="e.g. Add health check endpoint to billing service"
                  value={title()}
                  onInput={e => setTitle(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) create(); }}
                />
              </div>

              {/* Description */}
              <div>
                <label class="text-[11.5px] font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                  Plan Description
                  <span class="font-normal normal-case tracking-normal text-text-muted ml-1">(markdown)</span>
                </label>
                <textarea
                  class="w-full bg-surface-2 border border-border-subtle rounded-lg px-3 py-2 text-[12.5px] font-mono min-h-[120px] max-h-[250px] resize-y outline-none focus:border-accent"
                  placeholder={"## Objective\n\nDescribe what needs to be done...\n\n## Requirements\n\n- Requirement 1\n- Requirement 2\n\n## Acceptance Criteria\n\n- [ ] Criterion 1\n- [ ] Criterion 2"}
                  value={description()}
                  onInput={e => setDescription(e.currentTarget.value)}
                />
              </div>

              {/* Error */}
              <Show when={err()}>
                <p class="text-[11.5px] text-red-400">{err()}</p>
              </Show>
            </div>

            {/* Footer */}
            <div class="flex items-center gap-2 px-5 py-3 border-t border-border bg-surface-2/50">
              <button
                class="text-[12px] px-4 py-2 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white font-medium shadow hover:opacity-90 disabled:opacity-50 transition"
                disabled={busy() || !title().trim() || selectedProject() == null}
                onClick={create}
              >
                Create Plan
              </button>
              <button
                class="text-[12px] px-4 py-2 rounded-lg border border-border text-text-muted hover:text-text-secondary transition"
                onClick={close}
              >
                Cancel
              </button>
              <span class="ml-auto text-[10px] text-text-muted">Cmd+Enter to submit</span>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
