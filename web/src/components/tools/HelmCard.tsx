// HelmCard — helm release status / history
import { Show, For, createMemo } from 'solid-js';
import Badge from '../shared/Badge';
import type { ToolMetadata } from '../../types';

interface HelmCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

function statusVariant(status: string | undefined): 'success' | 'warning' | 'error' | 'info' | 'muted' {
  switch (status?.toLowerCase()) {
    case 'deployed': return 'success';
    case 'superseded': return 'muted';
    case 'failed': return 'error';
    case 'pending-install': case 'pending-upgrade': case 'pending-rollback': return 'warning';
    case 'uninstalling': return 'warning';
    default: return 'info';
  }
}

interface HelmRelease {
  name?: string;
  revision?: string | number;
  updated?: string;
  status?: string;
  chart?: string;
  app_version?: string;
  namespace?: string;
}

function parseHelmTable(output: string): HelmRelease[] {
  const lines = output.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.split('\t').map((c) => c.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] || '';
    });
    return obj as unknown as HelmRelease;
  });
}

export default function HelmCard(props: HelmCardProps) {
  const releaseName = () => (props.metadata?.releaseName || props.metadata?.name || '') as string;
  const chart = () => (props.metadata?.chart || '') as string;
  const version = () => (props.metadata?.version || props.metadata?.app_version || '') as string;
  const status = () => (props.metadata?.status || '') as string;
  const namespace = () => (props.metadata?.namespace || '') as string;

  const releases = createMemo(() => {
    if (props.metadata?.releases && Array.isArray(props.metadata.releases)) {
      return props.metadata.releases as HelmRelease[];
    }
    // Try parsing tab-separated helm output
    return parseHelmTable(props.output);
  });

  const hasTable = () => releases().length > 0;

  // Content body — shared between headerless and full modes
  const Body = () => (
    <>
      {/* Release info summary */}
      <Show when={releaseName() || namespace()}>
        <div class="px-3 py-2 bg-surface border-b border-border-subtle space-y-1">
          <Show when={releaseName()}>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-text-muted w-20">Release</span>
              <span class="text-text font-mono">{releaseName()}</span>
            </div>
          </Show>
          <Show when={namespace()}>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-text-muted w-20">Namespace</span>
              <span class="text-text-secondary font-mono">{namespace()}</span>
            </div>
          </Show>
          <Show when={chart()}>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-text-muted w-20">Chart</span>
              <span class="text-text-secondary font-mono">{chart()}</span>
            </div>
          </Show>
        </div>
      </Show>

      {/* Table view for helm list / history output */}
      <Show when={hasTable()}>
        <div class="bg-surface overflow-x-auto max-h-[300px] overflow-y-auto">
          <table class="w-full text-xs font-mono">
            <thead>
              <tr class="border-b border-border-subtle">
                <th class="text-left px-3 py-1.5 text-text-muted font-medium">NAME</th>
                <th class="text-left px-3 py-1.5 text-text-muted font-medium">REVISION</th>
                <th class="text-left px-3 py-1.5 text-text-muted font-medium">STATUS</th>
                <th class="text-left px-3 py-1.5 text-text-muted font-medium">CHART</th>
                <th class="text-left px-3 py-1.5 text-text-muted font-medium">APP VERSION</th>
              </tr>
            </thead>
            <tbody>
              <For each={releases()}>
                {(rel) => (
                  <tr class="border-b border-border-subtle last:border-b-0 hover:bg-surface-hover">
                    <td class="px-3 py-1 text-text whitespace-nowrap">{rel.name || ''}</td>
                    <td class="px-3 py-1 text-text-secondary whitespace-nowrap">{rel.revision || ''}</td>
                    <td class="px-3 py-1 whitespace-nowrap">
                      <Badge variant={statusVariant(rel.status)} class="text-[10px]">
                        {rel.status || ''}
                      </Badge>
                    </td>
                    <td class="px-3 py-1 text-text-secondary whitespace-nowrap">{rel.chart || ''}</td>
                    <td class="px-3 py-1 text-text-muted whitespace-nowrap">{rel.app_version || ''}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* Raw fallback when no table data */}
      <Show when={!hasTable() && props.output}>
        <div class="px-3 py-2 bg-surface max-h-[300px] overflow-y-auto">
          <pre class="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
            {props.output}
          </pre>
        </div>
      </Show>
    </>
  );

  if (props.headerless) {
    return <div class={props.class || ''}><Body /></div>;
  }

  return (
    <div class={`border border-border rounded-lg overflow-hidden my-1 ${props.class || ''}`}>
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-border-subtle">
        <span class="text-xs font-medium text-[#0F1689]">Helm</span>
        <Show when={releaseName()}>
          <span class="text-xs text-text-secondary font-mono">{releaseName()}</span>
        </Show>
        <Show when={chart()}>
          <span class="text-xs text-text-muted">{chart()}</span>
        </Show>
        <div class="flex items-center gap-1.5 ml-auto">
          <Show when={version()}>
            <span class="text-xs text-text-muted">v{version()}</span>
          </Show>
          <Show when={status()}>
            <Badge variant={statusVariant(status())}>{status()}</Badge>
          </Show>
          <Show when={!status()}>
            <Badge variant={props.isError ? 'error' : 'success'}>
              {props.isError ? 'error' : 'done'}
            </Badge>
          </Show>
        </div>
      </div>

      <Body />
    </div>
  );
}
