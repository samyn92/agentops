// WebFetchCard — fetch results (URL, status, content preview)
import { createSignal, Show } from 'solid-js';
import Badge from '../shared/Badge';
import Tip from '../shared/Tip';
import type { ToolMetadata } from '../../types';
import { formatBytes } from '../../lib/format';

interface WebFetchCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

const MAX_PREVIEW_CHARS = 2000;

function statusVariant(code: number | undefined): 'success' | 'warning' | 'error' | 'info' {
  if (!code) return 'info';
  if (code >= 200 && code < 300) return 'success';
  if (code >= 300 && code < 400) return 'warning';
  return 'error';
}

export default function WebFetchCard(props: WebFetchCardProps) {
  const [expanded, setExpanded] = createSignal(false);

  const url = () => {
    if (props.metadata?.url) return props.metadata.url as string;
    try {
      const parsed = JSON.parse(props.input);
      return parsed.url || '';
    } catch {
      return '';
    }
  };

  const statusCode = () => props.metadata?.statusCode as number | undefined;
  const contentType = () => (props.metadata?.contentType as string) || '';

  const displayUrl = () => {
    try {
      const u = new URL(url());
      return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
      return url();
    }
  };

  const previewContent = () => {
    if (!props.output) return '';
    if (props.output.length <= MAX_PREVIEW_CHARS || expanded()) return props.output;
    return props.output.slice(0, MAX_PREVIEW_CHARS);
  };

  const isHtml = () => contentType().includes('html');
  const isJson = () => contentType().includes('json');

  // Content body — shared between headerless and full modes
  const Body = () => (
    <>
      {/* URL bar */}
      <div class="px-3 py-1.5 bg-surface border-b border-border-subtle flex items-center gap-2">
        <svg class="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        <span class="text-xs font-mono text-text-secondary truncate">{url()}</span>
      </div>

      {/* Content preview */}
      <Show when={props.output}>
        <div class="px-3 py-2 bg-surface max-h-[400px] overflow-y-auto">
          <pre class={`text-xs font-mono whitespace-pre-wrap break-all text-text-secondary ${isJson() ? '' : ''}`}>
            {previewContent()}
          </pre>
          <Show when={props.output.length > MAX_PREVIEW_CHARS && !expanded()}>
            <button
              class="text-xs text-accent hover:underline mt-1"
              onClick={() => setExpanded(true)}
            >
              Show full response ({formatBytes(props.output.length)})
            </button>
          </Show>
        </div>
      </Show>

      <Show when={!props.output && !props.isError}>
        <div class="px-3 py-2 bg-surface">
          <span class="text-xs text-text-muted italic">No content returned</span>
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
        <span class="text-xs font-medium text-[#4285F4]">Fetch</span>
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <Tip content={url()}>
            <a
              href={url()}
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-accent hover:underline truncate font-mono"
            >
              {displayUrl()}
            </a>
          </Tip>
        </div>
        <div class="flex items-center gap-1.5 ml-auto flex-shrink-0">
          <Show when={contentType()}>
            <span class="text-xs text-text-muted">{contentType().split(';')[0]}</span>
          </Show>
          <Show when={statusCode()}>
            <Badge variant={statusVariant(statusCode())}>
              {statusCode()}
            </Badge>
          </Show>
          <Show when={!statusCode()}>
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
