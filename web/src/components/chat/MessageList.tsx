// MessageList — auto-scrolling message list with rAF-debounced scroll.
// M3 spacing: 4dp grid, denser grouping for same-role consecutive messages.
import { For, Show, createEffect, onCleanup } from 'solid-js';
import {
  messages,
  streaming,
  activeText,
  activeReasoning,
  thinkingState,
  isHydrating,
} from '../../stores/chat';
import MessageBubble from './MessageBubble';
import AgentThinking from './AgentThinking';
import EmptyState from '../shared/EmptyState';

interface MessageListProps {
  class?: string;
}

export default function MessageList(props: MessageListProps) {
  let listRef: HTMLDivElement | undefined;
  let anchorRef: HTMLDivElement | undefined;
  let isUserScrolled = false;
  let rafId: number | null = null;

  function scheduleScroll() {
    if (isUserScrolled || !listRef) return;
    // Cancel any pending rAF so we always scroll with the latest layout
    if (rafId !== null) cancelAnimationFrame(rafId);
    // Double-rAF: first frame lets SolidJS commit DOM changes,
    // second frame scrolls after layout is stable
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (anchorRef) {
          anchorRef.scrollIntoView({ block: 'end' });
        } else if (listRef) {
          listRef.scrollTop = listRef.scrollHeight;
        }
      });
    });
  }

  onCleanup(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });

  createEffect(() => {
    messages();
    activeText();
    activeReasoning();
    scheduleScroll();
  });

  function onScroll() {
    if (!listRef) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef;
    isUserScrolled = scrollHeight - scrollTop - clientHeight > 100;
  }

  createEffect(() => {
    if (streaming()) {
      isUserScrolled = false;
      scheduleScroll();
    }
  });

  const msgs = () => messages();
  const lastIndex = () => msgs().length - 1;

  // Show thinking indicator when streaming but assistant has no visible output yet,
  // or during connecting/generating phases (bridging gaps in visual feedback).
  const showThinking = () => {
    if (!streaming()) return false;
    const phase = thinkingState().phase;
    // Always show during connecting (pre-SSE), generating (text_start → first
    // delta), and integrating (async delegation callback bootstrapping).
    if (phase === 'connecting' || phase === 'generating' || phase === 'integrating') return true;
    const m = msgs();
    if (m.length === 0) return true; // streaming started, no messages yet
    const last = m[m.length - 1];
    if (last.role !== 'assistant') return false;
    // Show if assistant has no finalized parts AND no active streaming content
    const hasParts = last.parts && last.parts.length > 0;
    const hasActive = !!(activeText()?.content || activeReasoning()?.content);
    return !hasParts && !hasActive;
  };

  return (
    <div
      ref={listRef}
      class={`flex-1 overflow-y-auto px-4 pt-6 ${props.class || ''}`}
      onScroll={onScroll}
    >
      <Show
        when={msgs().length > 0}
        fallback={
          <Show
            when={isHydrating()}
            fallback={
              <EmptyState
                title="Start a conversation"
                description="Select an agent and type a message to begin."
                icon={
                  <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                }
              />
            }
          >
            {/* Skeleton loader during working memory hydration */}
            <div class="max-w-3xl mx-auto chat-skeleton">
              <div class="chat-skeleton__line w-2/5 ml-auto" />
              <div class="chat-skeleton__line w-4/5" />
              <div class="chat-skeleton__line w-3/5" />
              <div class="chat-skeleton__line w-1/3 ml-auto" />
              <div class="chat-skeleton__line w-3/4" />
              <div class="chat-skeleton__line w-2/5" />
            </div>
          </Show>
        }
      >
        <div class="max-w-3xl mx-auto">
          <For each={msgs()}>
            {(msg, i) => {
              const prevMsg = () => i() > 0 ? msgs()[i() - 1] : null;
              const prevSameRole = () => prevMsg()?.role === msg.role;

              return (
                <MessageBubble
                  message={msg}
                  prevSameRole={prevSameRole()}
                  isLastAssistant={msg.role === 'assistant' && i() === lastIndex()}
                  isStreaming={msg.role === 'assistant' && i() === lastIndex() && streaming()}
                  activeText={i() === lastIndex() ? activeText() : null}
                  activeReasoning={i() === lastIndex() ? activeReasoning() : null}
                />
              );
            }}
          </For>

          {/* Phase-aware thinking indicator */}
          <AgentThinking active={showThinking()} thinkingState={thinkingState()} />
        </div>
      </Show>
      {/* Scroll-end spacer — consistent visual breathing room above the composer */}
      <div class="h-6" aria-hidden="true" />
      {/* Invisible scroll anchor — always at the very bottom of scroll content */}
      <div ref={anchorRef} class="h-0 w-0" aria-hidden="true" />
    </div>
  );
}
