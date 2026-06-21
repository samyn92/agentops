// AgentDetail — agent info panel (model, tools, system prompt)
// Mode-aware: task agents get a runs-centric view, daemon agents show sessions/config.
import { createResource, Show, For, onMount } from 'solid-js';
import { agents as agentsAPI } from '../../lib/api';
import { selectedAgent, agentList } from '../../stores/agents';
import { rightPanelState, setRightPanelState } from '../../stores/view';
import Badge from '../shared/Badge';
import Spinner from '../shared/Spinner';
import Markdown from '../shared/Markdown';
import { formatDateTime } from '../../lib/format';

interface AgentDetailProps {
  class?: string;
}

export default function AgentDetail(props: AgentDetailProps) {
  const agent = selectedAgent;

  const [crd] = createResource(
    () => {
      const a = agent();
      return a ? { ns: a.namespace, name: a.name } : null;
    },
    async (key) => {
      if (!key) return null;
      return agentsAPI.get(key.ns, key.name);
    },
  );

  // Check if the selected agent is a task agent
  const isTaskAgent = () => {
    const a = agent();
    if (!a) return false;
    const list = agentList();
    const found = list?.find((ag) => ag.namespace === a.namespace && ag.name === a.name);
    return found?.mode === 'task';
  };

  // Auto-expand runs panel for task agents (runs are their primary view)
  onMount(() => {
    if (isTaskAgent() && rightPanelState() === 'collapsed') {
      setRightPanelState('expanded');
    }
  });

  return (
    <div class={`space-y-4 ${props.class || ''}`}>
      <Show when={crd.loading}>
        <div class="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </Show>

      <Show when={crd.error}>
        <div class="text-sm text-error px-4 py-2">Failed to load agent details</div>
      </Show>

      <Show when={crd()}>
        {(data) => {
          const spec = () => data().spec;
          const status = () => data().status;
          const meta = () => data().metadata;

          return (
            <>
              {/* Header */}
              <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
                <div class="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
                  <span class="text-accent text-sm font-bold">
                    {meta().name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div class="flex-1 min-w-0">
                  <h2 class="text-sm font-semibold text-text truncate">{meta().name}</h2>
                  <p class="text-xs text-text-muted">{meta().namespace}</p>
                </div>
                <Show when={status()?.phase}>
                  <Badge variant={status()?.phase === 'Running' ? 'success' : 'muted'}>
                    {status()!.phase}
                  </Badge>
                </Show>
              </div>

              {/* Task agent hint */}
              <Show when={isTaskAgent()}>
                <div class="mx-4 mt-3 p-3 rounded-lg bg-info/5 border border-info/15">
                  <div class="flex items-center gap-2 mb-1">
                    <svg class="w-4 h-4 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
                    </svg>
                    <span class="text-xs font-medium text-info">Task Agent</span>
                  </div>
                  <p class="text-xs text-text-secondary">
                    This agent runs as one-shot jobs. Runs are triggered by channels, schedules, or other agents.
                    View activity in the runs panel on the right.
                  </p>
                </div>
              </Show>

              {/* Properties */}
              <div class="px-4 space-y-3">
                <Section title="Configuration">
                  <Property label="Mode" value={spec().mode} />
                  <Property label="Model" value={spec().model} />
                  <Show when={spec().image}>
                    <Property label="Image" value={spec().image!} />
                  </Show>
                  <Show when={spec().temperature !== undefined}>
                    <Property label="Temperature" value={String(spec().temperature)} />
                  </Show>
                  <Show when={spec().maxOutputTokens !== undefined}>
                    <Property label="Max Tokens" value={String(spec().maxOutputTokens)} />
                  </Show>
                  <Show when={spec().maxSteps !== undefined}>
                    <Property label="Max Steps" value={String(spec().maxSteps)} />
                  </Show>
                  <Show when={spec().timeout}>
                    <Property label="Timeout" value={spec().timeout!} />
                  </Show>
                </Section>

                {/* Providers */}
                <Show when={spec().providers?.length}>
                  <Section title="Providers">
                    <div class="flex flex-wrap gap-1.5">
                      <For each={spec().providers}>
                        {(p) => (
                          <Badge variant="info">{p.name}</Badge>
                        )}
                      </For>
                    </div>
                  </Section>
                </Show>

                {/* Built-in Tools */}
                <Show when={spec().builtinTools?.length}>
                  <Section title="Built-in Tools">
                    <div class="flex flex-wrap gap-1.5">
                      <For each={spec().builtinTools}>
                        {(tool) => (
                          <Badge variant="muted">{tool}</Badge>
                        )}
                      </For>
                    </div>
                  </Section>
                </Show>

                {/* Agent Tools */}
                <Show when={spec().tools?.length}>
                  <Section title="Tools">
                    <div class="flex flex-wrap gap-1.5">
                      <For each={spec().tools}>
                        {(tool) => (
                          <Badge variant="info">{tool.name}</Badge>
                        )}
                      </For>
                    </div>
                  </Section>
                </Show>

                {/* Fallback Models */}
                <Show when={spec().fallbackModels?.length}>
                  <Section title="Fallback Models">
                    <div class="flex flex-wrap gap-1.5">
                      <For each={spec().fallbackModels}>
                        {(model) => (
                          <Badge variant="muted">{model}</Badge>
                        )}
                      </For>
                    </div>
                  </Section>
                </Show>

                {/* System Prompt */}
                <Show when={spec().systemPrompt}>
                  <Section title="System Prompt">
                    <div class="bg-surface-2 rounded-md p-2 border border-border-subtle">
                      <Markdown content={spec().systemPrompt!} />
                    </div>
                  </Section>
                </Show>

                {/* Tool Hooks */}
                <Show when={spec().toolHooks}>
                  <Section title="Tool Hooks">
                    <Show when={spec().toolHooks!.blockedCommands?.length}>
                      <div class="text-xs text-text-muted mb-1">Blocked commands:</div>
                      <div class="flex flex-wrap gap-1.5">
                        <For each={spec().toolHooks!.blockedCommands}>
                          {(cmd) => <Badge variant="muted">{cmd}</Badge>}
                        </For>
                      </div>
                    </Show>
                    <Show when={spec().toolHooks!.allowedPaths?.length}>
                      <div class="text-xs text-text-muted mb-1 mt-1">Allowed paths:</div>
                      <div class="flex flex-wrap gap-1.5">
                        <For each={spec().toolHooks!.allowedPaths}>
                          {(p) => <Badge variant="muted">{p}</Badge>}
                        </For>
                      </div>
                    </Show>
                  </Section>
                </Show>

                {/* Conditions */}
                <Show when={status()?.conditions?.length}>
                  <Section title="Conditions">
                    <For each={status()!.conditions}>
                      {(c) => (
                        <div class="flex items-center gap-2 text-xs py-0.5">
                          <Badge variant={c.status === 'True' ? 'success' : 'muted'} class="text-[10px]">
                            {c.type}
                          </Badge>
                          <Show when={c.message}>
                            <span class="text-text-muted truncate">{c.message}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Section>
                </Show>

                {/* Created timestamp */}
                <div class="pt-2 border-t border-border-subtle">
                  <p class="text-xs text-text-muted">
                    Created {formatDateTime(meta().creationTimestamp)}
                  </p>
                </div>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <div class="space-y-1.5">
      <h3 class="text-xs font-medium text-text-muted uppercase tracking-wide">{props.title}</h3>
      {props.children}
    </div>
  );
}

function Property(props: { label: string; value: string }) {
  return (
    <div class="flex items-center gap-2 text-xs">
      <span class="text-text-muted w-24 flex-shrink-0">{props.label}</span>
      <span class="text-text font-mono">{props.value}</span>
    </div>
  );
}
