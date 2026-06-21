// StreamingText — smooth progressive text rendering with markdown.
// During streaming, characters are revealed via a rAF-driven buffer that
// decouples bursty SSE deltas from render cadence. The result is a natural,
// fluid text flow instead of jarring jumps.
import { createSignal, createEffect, onCleanup, createMemo } from 'solid-js';
import Markdown from '../shared/Markdown';

interface StreamingTextProps {
  content: string;
  isStreaming?: boolean;
  class?: string;
}

// Characters revealed per animation frame during streaming.
// Adaptive: starts gentle, accelerates when the buffer is large.
const BASE_CHARS_PER_FRAME = 3;
const MAX_CHARS_PER_FRAME = 30;

// Cursor HTML injected inline at the end of the last block element
const CURSOR_HTML = '<span class="streaming-cursor"></span>';

export default function StreamingText(props: StreamingTextProps) {
  // The smoothly revealed substring (only used during streaming)
  const [revealed, setRevealed] = createSignal('');
  let rafId: number | null = null;
  let revealedLen = 0;

  // The content to actually render: during streaming use the smooth buffer,
  // once done show the full content immediately.
  const displayContent = () => {
    if (!props.isStreaming) return props.content;
    return revealed();
  };

  // Whether to show the inline cursor
  const showCursor = createMemo(() => !!props.isStreaming);

  // rAF loop: reveal characters toward the target at a smooth pace
  function tick() {
    const target = props.content;
    const targetLen = target.length;

    if (revealedLen >= targetLen) {
      // Caught up — wait for more content
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Adaptive speed: reveal more chars/frame when buffer is large
    const buffered = targetLen - revealedLen;
    const speed = Math.min(
      MAX_CHARS_PER_FRAME,
      Math.max(BASE_CHARS_PER_FRAME, Math.floor(buffered / 8)),
    );

    revealedLen = Math.min(revealedLen + speed, targetLen);
    setRevealed(target.slice(0, revealedLen));

    rafId = requestAnimationFrame(tick);
  }

  // Start/stop the rAF loop based on streaming state
  createEffect(() => {
    if (props.isStreaming) {
      // Reset if content changed from a previous stream
      if (revealedLen > props.content.length) {
        revealedLen = 0;
        setRevealed('');
      }
      if (rafId === null) {
        rafId = requestAnimationFrame(tick);
      }
    } else {
      // Not streaming — stop loop, show full content
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      revealedLen = props.content.length;
      setRevealed(props.content);
    }
  });

  onCleanup(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  return (
    <div class={props.class || ''}>
      <Markdown
        content={displayContent()}
        injectHtml={showCursor() ? CURSOR_HTML : undefined}
      />
    </div>
  );
}
