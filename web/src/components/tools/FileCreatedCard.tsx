// FileCreatedCard — write results (new file indicator with preview)
import { createSignal, Show, createMemo } from 'solid-js';
import hljs from 'highlight.js';
import Badge from '../shared/Badge';
import type { ToolMetadata } from '../../types';
import { detectLanguage } from '../../lib/detect';
import { formatBytes } from '../../lib/format';

interface FileCreatedCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

const PREVIEW_LINES = 15;

export default function FileCreatedCard(props: FileCreatedCardProps) {
  const [showPreview, setShowPreview] = createSignal(false);

  const filePath = () => {
    if (props.metadata?.filePath) return props.metadata.filePath as string;
    try {
      const parsed = JSON.parse(props.input);
      return parsed.filePath || parsed.file_path || parsed.path || '';
    } catch {
      return '';
    }
  };

  const fileSize = () => {
    if (props.metadata?.size) return props.metadata.size as number;
    try {
      const parsed = JSON.parse(props.input);
      if (parsed.content) return parsed.content.length;
    } catch { /* ignore */ }
    return 0;
  };

  const language = () =>
    (props.metadata?.language as string) || detectLanguage(filePath());

  // Preview from input content (write tool sends content in input)
  const previewContent = createMemo(() => {
    try {
      const parsed = JSON.parse(props.input);
      if (parsed.content) {
        const lines = parsed.content.split('\n');
        return {
          lines: lines.slice(0, PREVIEW_LINES),
          total: lines.length,
          truncated: lines.length > PREVIEW_LINES,
        };
      }
    } catch { /* ignore */ }
    return { lines: [] as string[], total: 0, truncated: false };
  });

  const highlighted = createMemo(() => {
    const code = previewContent().lines.join('\n');
    if (!code) return '';
    const lang = language();
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  });

  const fileName = () => {
    const path = filePath();
    return path.split('/').pop() || path;
  };

  // Content body — shared between headerless and full modes
  const Body = () => (
    <>
      {/* New file indicator */}
      <div class="px-3 py-2 bg-surface flex items-center gap-2">
        <span class="text-success text-xs">+</span>
        <span class="text-xs text-text font-mono">{fileName()}</span>
        <Show when={previewContent().total > 0}>
          <span class="text-xs text-text-muted">
            ({previewContent().total} line{previewContent().total !== 1 ? 's' : ''})
          </span>
        </Show>
        <Show when={previewContent().lines.length > 0}>
          <button
            class="text-xs text-accent hover:underline ml-auto"
            onClick={() => setShowPreview(!showPreview())}
          >
            {showPreview() ? 'Hide preview' : 'Show preview'}
          </button>
        </Show>
      </div>

      {/* Preview */}
      <Show when={showPreview() && highlighted()}>
        <div class="border-t border-border-subtle bg-surface max-h-[300px] overflow-y-auto">
          <div class="flex">
            <div class="flex-shrink-0 px-2 py-2 text-right select-none border-r border-border-subtle bg-surface-2">
              {previewContent().lines.map((_: string, i: number) => (
                <div class="text-[11px] leading-[1.55] text-success/60 font-mono">
                  +{i + 1}
                </div>
              ))}
            </div>
            <div class="flex-1 overflow-x-auto px-3 py-2">
              <pre class="text-[13px] leading-[1.55]">
                <code class="hljs font-mono" innerHTML={highlighted()} />
              </pre>
            </div>
          </div>
          <Show when={previewContent().truncated}>
            <div class="px-3 py-1 text-xs text-text-muted border-t border-border-subtle">
              ... {previewContent().total - PREVIEW_LINES} more lines
            </div>
          </Show>
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
        <span class="text-xs font-medium text-[#4EAA25]">Write</span>
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="text-xs text-text-secondary truncate">{filePath()}</span>
        </div>
        <div class="flex items-center gap-1.5 ml-auto flex-shrink-0">
          <Show when={fileSize() > 0}>
            <span class="text-xs text-text-muted">{formatBytes(fileSize())}</span>
          </Show>
          <Show when={language()}>
            <span class="text-xs text-text-muted uppercase">{language()}</span>
          </Show>
          <Badge variant={props.isError ? 'error' : 'success'}>
            {props.isError ? 'failed' : 'created'}
          </Badge>
        </div>
      </div>

      <Body />
    </div>
  );
}
