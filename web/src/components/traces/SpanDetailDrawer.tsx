// SpanDetailDrawer — bottom panel that opens when a span is selected in the
// TraceDetailView waterfall. Takes real layout space (flex child) so the
// waterfall above shrinks and all spans remain reachable via scroll.
// Renders the existing SpanDetailPanel. Click X or press Escape to close.
import { Show, createEffect, onCleanup } from 'solid-js';
import SpanDetailPanel from './SpanDetailPanel';
import { selectedSpanID, selectedSpanData, traceProcesses, clearSelectedSpan } from '../../stores/view';

export default function SpanDetailDrawer() {
  const isOpen = () => selectedSpanID() !== null && selectedSpanData() !== null;

  // Close on Escape key
  createEffect(() => {
    if (!isOpen()) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') clearSelectedSpan();
    }
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  return (
    <Show when={isOpen()}>
      <div class="flex-shrink-0 h-1/2 min-h-0 border-t border-border bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.08)] flex flex-col overflow-hidden animate-[slideUpDrawer_200ms_ease-out]">
        <SpanDetailPanel
          span={selectedSpanData()!}
          processes={traceProcesses()}
          onClose={() => clearSelectedSpan()}
        />
      </div>

      {/* Keyframes — inlined because Tailwind doesn't ship a slide-up utility by default */}
      <style>{`
        @keyframes slideUpDrawer {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </Show>
  );
}
