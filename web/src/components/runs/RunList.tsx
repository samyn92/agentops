// RunList — AgentRun list with filters
import { createResource, For, Show } from 'solid-js';
import { agentRuns } from '../../lib/api';
import type { AgentRunResponse } from '../../types';
import Badge from '../shared/Badge';
import Spinner from '../shared/Spinner';
import EmptyState from '../shared/EmptyState';
import { relativeTime, phaseVariant } from '../../lib/format';

interface RunListProps {
  onSelect?: (ns: string, name: string) => void;
  class?: string;
}

export default function RunList(props: RunListProps) {
  const [runs, { refetch }] = createResource(() => agentRuns.list());

  return (
    <div class={props.class || ''}>
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 class="text-sm font-semibold text-text">Agent Runs</h2>
        <button
          class="text-xs text-accent hover:text-accent/80 transition-colors"
          onClick={() => refetch()}
        >
          Refresh
        </button>
      </div>

      <Show when={runs.loading}>
        <div class="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </Show>

      <Show when={runs.error}>
        <div class="text-sm text-error px-4 py-4">Failed to load runs</div>
      </Show>

      <Show when={runs()}>
        {(data) => (
          <Show
            when={data().length > 0}
            fallback={
              <EmptyState
                title="No Agent Runs"
                description="Agent runs will appear here when agents execute tasks."
              />
            }
          >
            <div class="divide-y divide-border-subtle">
              <For each={data()}>
                {(run) => (
                  <button
                    class="w-full text-left px-4 py-3 hover:bg-surface-hover transition-colors"
                    onClick={() => props.onSelect?.(run.metadata.namespace, run.metadata.name)}
                  >
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-sm font-mono text-text truncate flex-1">
                        {run.metadata.name}
                      </span>
                      <Badge variant={phaseVariant(run.status?.phase)}>
                        {run.status?.phase || 'Unknown'}
                      </Badge>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-text-muted">
                      <span>Agent: {run.spec.agentRef}</span>
                      <Show when={run.status?.model}>
                        <span>{run.status!.model}</span>
                      </Show>
                      <span class="ml-auto">{relativeTime(run.metadata.creationTimestamp)}</span>
                    </div>
                    <Show when={run.spec.prompt}>
                      <p class="text-xs text-text-secondary mt-1 truncate">{run.spec.prompt}</p>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
