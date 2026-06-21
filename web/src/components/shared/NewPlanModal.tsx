// NewPlanModal — create a new plan from a natural language prompt.
//
// The user just describes what they want. The agent:
//   1. Generates a title
//   2. Generates a full structured plan (the issue description)
//   3. Creates the GitLab issue with agent::planning label
//
// All the user provides is: which repos + what they want.
import {
  createSignal,
  Show,
  For,
  type Accessor,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { GitLabIcon } from '../shared/Icons';
import Spinner from '../shared/Spinner';

export interface NewPlanModalProps {
  open: Accessor<boolean>;
  onClose: () => void;
  ctx: { ns: string; intg: string };
  projects: Accessor<Array<{ id: number; name: string; path_with_namespace: string }> | undefined>;
  /** Available domain experts (daemon agents) to assign planning to. */
  experts: Accessor<Array<{ name: string; namespace: string; role?: string }> | undefined>;
  /** Default planner agent name. */
  plannerAgent?: string;
  onCreated: () => void;
}

export default function NewPlanModal(props: NewPlanModalProps) {
  const [selectedProjects, setSelectedProjects] = createSignal<Set<number>>(new Set());
  const [prompt, setPrompt] = createSignal('');
  const [selectedExpert, setSelectedExpert] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal('');

  function toggleProject(id: number) {
    setSelectedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setPrompt('');
    setErr(null);
    setStatus('');
    setSelectedProjects(new Set());
    setSelectedExpert(null);
  }

  function close() {
    reset();
    props.onClose();
  }

  async function create() {
    if (!prompt().trim()) { setErr('Describe what you want'); return; }
    if (selectedProjects().size === 0) { setErr('Select at least one target repository'); return; }

    setBusy(true); setErr(null);
    setStatus('Creating plan...');

    try {
      const selected = selectedProjects();
      const allProjects = props.projects() ?? [];
      const targetProjects = allProjects.filter(p => selected.has(p.id));
      const primaryProject = targetProjects[0];

      // Build scope context for multi-repo
      let scopeContext = '';
      if (targetProjects.length > 1) {
        scopeContext = `\n\nScope (multi-repo):\n${targetProjects.map(p => `- ${p.path_with_namespace}`).join('\n')}`;
      }

      // Create a placeholder issue with the user's prompt as description
      const placeholderDesc = `> ${prompt().trim()}${scopeContext}\n\n_Plan generation in progress..._`;
      const createBody = {
        title: prompt().trim().slice(0, 80) + (prompt().trim().length > 80 ? '...' : ''),
        description: placeholderDesc,
        labels: 'agent::planning',
      };

      setStatus('Creating issue...');
      const res = await fetch(`/api/v1/integrations/${props.ctx.ns}/${props.ctx.intg}/group/projects/${primaryProject.id}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const createdIssue = await res.json().catch(() => null);
      if (!createdIssue?.iid) throw new Error('Issue creation failed');

      // Trigger the planner agent to generate the full plan + title
      setStatus('Agent is generating the plan...');
      // Trigger the selected domain expert (or default planner) to generate the plan
      const agentName = selectedExpert() || props.plannerAgent;
      if (agentName) {
        const refineFeedback = targetProjects.length > 1
          ? `Create a detailed implementation plan for: ${prompt().trim()}\n\nThis work spans multiple repositories:\n${targetProjects.map(p => `- ${p.path_with_namespace}`).join('\n')}`
          : `Create a detailed implementation plan for: ${prompt().trim()}`;

        fetch(`/api/v1/integrations/${props.ctx.ns}/${props.ctx.intg}/group/projects/${primaryProject.id}/issues/${createdIssue.iid}/refine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedback: refineFeedback,
            agent: agentName,
          }),
        }).catch(() => {}); // Fire and forget
      }

      close();
      props.onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus('');
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
              <span class="ml-auto text-[11px] text-text-muted">Agent generates title + full plan</span>
            </div>

            {/* Body */}
            <div class="px-5 py-4 flex flex-col gap-4">
              {/* Prompt */}
              <div>
                <label class="text-[11.5px] font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                  What do you want?
                </label>
                <textarea
                  class="w-full bg-surface-2 border border-border-subtle rounded-lg px-3 py-2.5 text-[13px] min-h-[80px] max-h-[200px] resize-y outline-none focus:border-accent placeholder:text-text-muted"
                  placeholder="e.g. Add rate limiting to the checkout API with token bucket algorithm and per-endpoint config"
                  value={prompt()}
                  onInput={e => setPrompt(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) create(); }}
                  ref={el => props.open() && queueMicrotask(() => el?.focus())}
                />
              </div>

              {/* Domain expert picker */}
              <Show when={(props.experts?.() ?? []).length > 1}>
                <div>
                  <label class="text-[11.5px] font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                    Domain Expert
                    <span class="font-normal normal-case tracking-normal text-text-muted ml-1">(who should plan this?)</span>
                  </label>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={props.experts?.() ?? []}>
                      {(expert) => {
                        const isActive = () => selectedExpert() === expert.name || (!selectedExpert() && expert.name.includes('planner'));
                        return (
                          <button
                            class="px-2.5 py-1.5 rounded-lg border text-[11.5px] font-medium transition-all"
                            classList={{
                              'border-accent bg-accent/8 text-text': isActive(),
                              'border-border-subtle text-text-muted hover:border-border hover:text-text-secondary': !isActive(),
                            }}
                            onClick={() => setSelectedExpert(expert.name)}
                          >
                            <span class="mr-1">●</span>
                            {expert.role || expert.name.replace(/^.*-/, '')}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Target repos */}
              <div>
                <label class="text-[11.5px] font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                  Target Repos
                  <span class="font-normal normal-case tracking-normal text-text-muted ml-1">(where should this work happen?)</span>
                </label>
                <div class="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto">
                  <For each={props.projects() ?? []}>
                    {(p) => {
                      const isSelected = () => selectedProjects().has(p.id);
                      return (
                        <button
                          class="flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-[12.5px] transition-colors"
                          classList={{
                            'border-accent bg-accent/5': isSelected(),
                            'border-border-subtle hover:border-border hover:bg-surface-2': !isSelected(),
                          }}
                          onClick={() => toggleProject(p.id)}
                        >
                          <span class="w-4 h-4 rounded border flex-none grid place-items-center text-[10px]"
                            classList={{
                              'border-accent bg-accent text-white': isSelected(),
                              'border-border-subtle': !isSelected(),
                            }}>
                            <Show when={isSelected()}>&#10003;</Show>
                          </span>
                          <GitLabIcon class="w-3.5 h-3.5 text-[#FC6D26] flex-none" />
                          <span class="font-semibold">{p.name}</span>
                          <span class="text-text-muted font-mono text-[10.5px] ml-auto">{p.path_with_namespace}</span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>

              {/* Status / Error */}
              <Show when={status()}>
                <div class="flex items-center gap-2 text-[12px] text-text-muted">
                  <Spinner size="sm" />
                  <span>{status()}</span>
                </div>
              </Show>
              <Show when={err()}>
                <p class="text-[11.5px] text-red-400">{err()}</p>
              </Show>
            </div>

            {/* Footer */}
            <div class="flex items-center gap-2 px-5 py-3 border-t border-border bg-surface-2/50">
              <button
                class="text-[12px] px-4 py-2 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white font-medium shadow hover:opacity-90 disabled:opacity-50 transition"
                disabled={busy() || !prompt().trim() || selectedProjects().size === 0}
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
              <span class="ml-auto text-[10px] text-text-muted">Cmd+Enter</span>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
