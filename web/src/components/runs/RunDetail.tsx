// RunDetail — single run detail view (output, cost, duration)
import { createResource, Show } from 'solid-js';
import { agentRuns } from '../../lib/api';
import type { AgentRunResponse } from '../../types';
import Badge from '../shared/Badge';
import Spinner from '../shared/Spinner';
import Markdown from '../shared/Markdown';
import { formatTokens, formatDateTime, formatCost, phaseVariant } from '../../lib/format';
import { showTraceDetail } from '../../stores/view';

interface RunDetailProps {
  namespace: string;
  name: string;
  class?: string;
}

export default function RunDetail(props: RunDetailProps) {
  const [run] = createResource(
    () => ({ ns: props.namespace, name: props.name }),
    (key) => agentRuns.get(key.ns, key.name),
  );

  return (
    <div class={props.class || ''}>
      <Show when={run.loading}>
        <div class="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </Show>

      <Show when={run.error}>
        <div class="text-sm text-error px-4 py-4">Failed to load run details</div>
      </Show>

      <Show when={run()}>
        {(data) => {
          const meta = () => data().metadata;
          const spec = () => data().spec;
          const status = () => data().status;

          return (
            <div class="space-y-4">
              {/* Header */}
              <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
                <div class="flex-1 min-w-0">
                  <h2 class="text-sm font-semibold text-text font-mono truncate">{meta().name}</h2>
                  <p class="text-xs text-text-muted">{meta().namespace}</p>
                </div>
                <Badge variant={phaseVariant(status()?.phase)}>
                  {status()?.phase || 'Unknown'}
                </Badge>
              </div>

              {/* Properties */}
              <div class="px-4 space-y-3">
                <Property label="Agent" value={spec().agentRef} />
                <Show when={spec().source}>
                  <Property label="Source" value={`${spec().source}${spec().sourceRef ? ' / ' + spec().sourceRef : ''}`} />
                </Show>
                <Show when={status()?.model}>
                  <Property label="Model" value={status()!.model!} />
                </Show>
                <Show when={status()?.tokensUsed}>
                  <Property label="Tokens" value={formatTokens(status()!.tokensUsed!)} />
                </Show>
                <Show when={status()?.toolCalls}>
                  <Property label="Tool Calls" value={String(status()!.toolCalls)} />
                </Show>
                <Show when={status()?.cost}>
                  <Property label="Cost" value={formatCost(status()!.cost!)} />
                </Show>
                <Show when={status()?.traceID}>
                  <div class="flex items-center gap-2 text-xs">
                    <span class="text-text-muted w-20 flex-shrink-0">Trace</span>
                    <button
                      class="text-accent font-mono text-[10px] truncate hover:underline cursor-pointer"
                      title={`View trace ${status()!.traceID!}`}
                      onClick={() => showTraceDetail(status()!.traceID!)}
                    >
                      {status()!.traceID!.slice(0, 24)}...
                    </button>
                  </div>
                </Show>
                <Show when={status()?.startTime}>
                  <Property label="Started" value={formatDateTime(status()!.startTime!)} />
                </Show>
                <Show when={status()?.completionTime}>
                  <Property label="Completed" value={formatDateTime(status()!.completionTime!)} />
                </Show>

                {/* Prompt */}
                <div class="space-y-1">
                  <span class="text-xs text-text-muted">Prompt</span>
                    <div class="text-xs bg-surface-2 rounded-md p-2 border border-border-subtle">
                      <Markdown content={spec().prompt} />
                    </div>
                </div>

                {/* Output */}
                <Show when={status()?.output}>
                  <div class="space-y-1">
                    <span class="text-xs text-text-muted">Output</span>
                    <div class="text-xs bg-surface-2 rounded-md p-2 border border-border-subtle max-h-[400px] overflow-y-auto">
                      <Markdown content={status()!.output!} />
                    </div>
                  </div>
                </Show>

                {/* Error */}
                <Show when={status()?.error}>
                  <div class="space-y-1">
                    <span class="text-xs text-error">Error</span>
                    <pre class="text-xs text-error font-mono whitespace-pre-wrap bg-error/5 rounded-md p-2 border border-error/20">
                      {status()!.error}
                    </pre>
                  </div>
                </Show>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
}

function Property(props: { label: string; value: string }) {
  return (
    <div class="flex items-center gap-2 text-xs">
      <span class="text-text-muted w-20 flex-shrink-0">{props.label}</span>
      <span class="text-text font-mono">{props.value}</span>
    </div>
  );
}
