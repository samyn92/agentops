// KubernetesCard — Kubernetes tool result renderer.
// Dispatches between:
//   1. JsonTreeViewer — for structured JSON responses (kube_find, kube_health, etc.)
//   2. Monospace pre — for plain text output (kube_exec, kube_apply)
//   3. Legacy kubectl table parser — for old kubernetes MCP tool (kubectl get output)
import { createSignal, createMemo, Show } from 'solid-js';
import Badge from '../shared/Badge';
import JsonTreeViewer from './JsonTreeViewer';
import type { ToolMetadata } from '../../types';

interface KubernetesCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

/** Detect the output type from the tool result */
type OutputKind = 'json' | 'text';

function detectOutputKind(output: string): OutputKind {
  const trimmed = output.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(output);
      return 'json';
    } catch {
      return 'text';
    }
  }
  return 'text';
}

/** Extract the MCP tool name from the full tool name (mcp_kube-explore_kube_health -> kube_health) */
function extractToolIntent(toolName: string, metadata?: ToolMetadata): string {
  // Prefer metadata.tool if available (set by runtime)
  if (metadata?.tool) return metadata.tool as string;
  // Parse from mcp_{server}_{tool} naming
  const match = toolName.match(/^mcp_[^_]+_(.+)$/);
  return match ? match[1] : toolName;
}

/** Human-readable label for the tool intent */
function intentLabel(intent: string): string {
  switch (intent) {
    case 'kube_find':     return 'Find Resources';
    case 'kube_health':   return 'Cluster Health';
    case 'kube_inspect':  return 'Inspect';
    case 'kube_topology': return 'Topology';
    case 'kube_diff':     return 'Drift Diff';
    case 'kube_logs':     return 'Logs';
    case 'kube_exec':     return 'Exec';
    case 'kube_apply':    return 'Apply';
    default:              return intent.replace(/_/g, ' ');
  }
}

/** Status color for health overview */
function overallColor(overall: string | undefined): string {
  switch (overall?.toUpperCase()) {
    case 'HEALTHY':   return 'text-success';
    case 'DEGRADED':  return 'text-warning';
    case 'CRITICAL':  return 'text-error';
    default:          return 'text-text-secondary';
  }
}

export default function KubernetesCard(props: KubernetesCardProps) {
  const outputKind = createMemo(() => detectOutputKind(props.output));
  const intent = createMemo(() => extractToolIntent(props.toolName, props.metadata));

  // For JSON output, try to extract a top-level summary
  const jsonSummary = createMemo(() => {
    if (outputKind() !== 'json') return null;
    try {
      const data = JSON.parse(props.output);
      // kube_health: show overall status
      if (data.overall) return { label: data.overall as string, color: overallColor(data.overall) };
      // kube_find: show match count
      if (data.total_matches !== undefined) return { label: `${data.total_matches} matches`, color: 'text-text-secondary' };
      // kube_diff: show drift status
      if (data.drifted !== undefined) return {
        label: data.drifted ? 'Drifted' : 'In Sync',
        color: data.drifted ? 'text-warning' : 'text-success',
      };
      // kube_logs: show crash status
      if (data.crash_looping !== undefined) return {
        label: data.crash_looping ? 'Crash Looping' : `${data.total_lines || 0} lines`,
        color: data.crash_looping ? 'text-error' : 'text-text-secondary',
      };
      // kube_inspect: show phase
      if (data.status?.phase) return { label: data.status.phase as string, color: 'text-text-secondary' };
      // kube_topology: show root
      if (data.root?.kind) return { label: `${data.root.kind}/${data.root.name}`, color: 'text-text-secondary' };
      return null;
    } catch {
      return null;
    }
  });

  // Content body — shared between headerless and full modes
  const Body = () => (
    <Show
      when={outputKind() === 'json'}
      fallback={
        // Plain text output (kube_exec, kube_apply)
        <div class="px-3 py-2 max-h-[500px] overflow-y-auto">
          <pre class="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
            {props.output}
          </pre>
        </div>
      }
    >
      <JsonTreeViewer
        data={props.output}
        initialDepth={2}
        maxHeight={500}
      />
    </Show>
  );

  if (props.headerless) {
    return <div class={props.class || ''}><Body /></div>;
  }

  return (
    <div class={`border border-border rounded-lg overflow-hidden my-1 ${props.class || ''}`}>
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-border-subtle">
        <span class="text-xs font-medium text-[#326CE5]">Kubernetes</span>
        <span class="text-xs text-text-secondary">{intentLabel(intent())}</span>

        <Show when={jsonSummary()}>
          <span class={`text-xs font-medium ${jsonSummary()!.color}`}>
            {jsonSummary()!.label}
          </span>
        </Show>

        <div class="flex items-center gap-1.5 ml-auto">
          <Badge variant={props.isError ? 'error' : 'success'}>
            {props.isError ? 'error' : 'done'}
          </Badge>
        </div>
      </div>

      <Body />
    </div>
  );
}
