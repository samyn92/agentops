// CodeCard — read results (syntax highlighted, line numbers)
import { createSignal, Show, createMemo } from 'solid-js';
import hljs from 'highlight.js';
import Badge from '../shared/Badge';
import type { ToolMetadata } from '../../types';
import { detectLanguage } from '../../lib/detect';

interface CodeCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

const MAX_VISIBLE_LINES = 30;

export default function CodeCard(props: CodeCardProps) {
  const [expanded, setExpanded] = createSignal(false);

  const filePath = () => {
    if (props.metadata?.filePath) return props.metadata.filePath as string;
    try {
      const parsed = JSON.parse(props.input);
      return parsed.filePath || parsed.file_path || '';
    } catch {
      return '';
    }
  };

  const offset = () => (props.metadata?.offset as number) || 1;
  const language = () => (props.metadata?.language as string) || detectLanguage(filePath());

  const lines = () => props.output.split('\n');
  const isTruncated = () => lines().length > MAX_VISIBLE_LINES && !expanded();

  const displayLines = () => {
    if (isTruncated()) return lines().slice(0, MAX_VISIBLE_LINES);
    return lines();
  };

  const highlighted = createMemo(() => {
    const code = displayLines().join('\n');
    if (language() && hljs.getLanguage(language())) {
      return hljs.highlight(code, { language: language() }).value;
    }
    return hljs.highlightAuto(code).value;
  });

  // Content body — shared between headerless and full modes
  const Body = () => (
    <>
      {/* Code content */}
      <div class="bg-surface max-h-[400px] overflow-y-auto">
        <div class="flex">
          {/* Line numbers */}
          <div class="flex-shrink-0 px-2 py-2 text-right select-none border-r border-border-subtle bg-surface-2">
            {displayLines().map((_, i) => (
              <div class="text-[11px] leading-[1.55] text-text-muted font-mono">
                {i + offset()}
              </div>
            ))}
          </div>
          {/* Code */}
          <div class="flex-1 overflow-x-auto px-3 py-2">
            <pre class="text-[13px] leading-[1.55]">
              <code class="hljs font-mono" innerHTML={highlighted()} />
            </pre>
          </div>
        </div>
      </div>

      <Show when={isTruncated()}>
        <button
          class="w-full px-3 py-1.5 text-xs text-accent hover:bg-surface-hover text-left border-t border-border-subtle"
          onClick={() => setExpanded(true)}
        >
          Show all {lines().length} lines
        </button>
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
        <span class="text-xs font-medium text-[#E8A838]">Read</span>
        <span class="text-xs text-text-secondary truncate">{filePath()}</span>
        <Show when={language()}>
          <span class="text-xs text-text-muted uppercase">{language()}</span>
        </Show>
        <span class="text-xs text-text-muted ml-auto">{lines().length} lines</span>
      </div>

      <Body />
    </div>
  );
}
