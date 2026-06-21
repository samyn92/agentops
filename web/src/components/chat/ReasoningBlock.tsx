// ReasoningBlock — collapsible thinking/reasoning display.
// Auto-collapsed by default. Dimmed italic text. No streaming cursor.
// Single-line summary when collapsed.
import { createSignal, Show, createMemo } from 'solid-js';

interface ReasoningBlockProps {
  content: string;
  isStreaming?: boolean;
  class?: string;
}

/** Extract a single-line summary from reasoning content */
function summarize(content: string, maxLen = 80): string {
  // Take first meaningful line
  const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
  const trimmed = firstLine.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + '...';
}

export default function ReasoningBlock(props: ReasoningBlockProps) {
  // Auto-collapsed by default. Expand on click.
  const [expanded, setExpanded] = createSignal(false);

  // During streaming, show expanded so user can see progress
  const isExpanded = () => props.isStreaming || expanded();

  const summary = createMemo(() => summarize(props.content));

  return (
    <div class={`my-1 ${props.class || ''}`}>
      <button
        class="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors w-full text-left"
        onClick={() => setExpanded((c) => !c)}
      >
        <svg
          class={`w-3 h-3 shrink-0 transition-transform duration-150 ${isExpanded() ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>

        <Show
          when={isExpanded()}
          fallback={
            <span class="text-text-muted/70 italic text-xs truncate">{summary()}</span>
          }
        >
          <span class="font-medium text-text-muted uppercase tracking-wider text-[10px]">Thinking</span>
          <Show when={props.isStreaming}>
            <span class="typing-dot w-1 h-1 rounded-full bg-accent" />
            <span class="typing-dot w-1 h-1 rounded-full bg-accent" style="animation-delay: 0.2s" />
            <span class="typing-dot w-1 h-1 rounded-full bg-accent" style="animation-delay: 0.4s" />
          </Show>
        </Show>
      </button>

      <Show when={isExpanded()}>
        <div class="text-xs text-text-muted/60 italic leading-relaxed whitespace-pre-wrap pl-[18px] mt-1 fade-in">
          {props.content}
        </div>
      </Show>
    </div>
  );
}
