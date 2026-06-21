// RightPanel — collapsible right sidebar with context-aware content.
// Default mode: Memory, Tools tabs (agent context).
// Trace mode: panel is hidden — span detail is shown in a bottom drawer inside TraceDetailView.
import { Show, createSignal } from 'solid-js';
import { Tabs } from '@ark-ui/solid/tabs';
import { HamburgerIcon } from '../shared/Icons';
import Tip from '../shared/Tip';
import { rightPanelState, toggleRightPanel, rightPanelTab, setRightPanelTab, centerView } from '../../stores/view';
import type { RightPanelTab } from '../../stores/view';
import { memoryEnabled } from '../../stores/memory';
import MemoryPanel from './MemoryPanel';
import ToolBrowser from '../resources/ToolBrowser';

interface RightPanelProps {
  class?: string;
}

export default function RightPanel(props: RightPanelProps) {
  const [panelWidth, setPanelWidth] = createSignal(340);
  const [isResizingWidth, setIsResizingWidth] = createSignal(false);

  let panelRef: HTMLElement | undefined;

  const isExpanded = () => rightPanelState() === 'expanded';
  const hasMemory = () => memoryEnabled();

  // When the trace detail view is active, hide the right panel entirely —
  // span details render in a bottom drawer within TraceDetailView, and the
  // trace waterfall gets full width.
  const isTraceView = () => centerView() === 'trace-detail';

  // Width resize handler (drag left edge)
  function onWidthResizeStart(e: MouseEvent) {
    e.preventDefault();
    setIsResizingWidth(true);
    const startX = e.clientX;
    const startWidth = panelWidth();

    function onMouseMove(e: MouseEvent) {
      const delta = startX - e.clientX;
      const newWidth = Math.max(280, Math.min(520, startWidth + delta));
      setPanelWidth(newWidth);
    }

    function onMouseUp() {
      setIsResizingWidth(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  return (
    <Show when={!isTraceView()}>
      <aside
        ref={panelRef}
        class={`relative flex flex-col h-full bg-surface border-l border-border overflow-hidden transition-[width,min-width] duration-200 ${props.class || ''}`}
        style={{
          width: isExpanded() ? `${panelWidth()}px` : '44px',
          'min-width': isExpanded() ? `${panelWidth()}px` : '44px',
        }}
      >
        {/* ── Collapsed strip ── */}
        <Show when={!isExpanded()}>
          <Tip content="Show panel (Ctrl+3)" placement="left">
            <button
              class="flex flex-col items-center gap-3 py-3 w-full h-full hover:bg-surface-hover transition-colors"
              onClick={() => toggleRightPanel()}
            >
              <div class="relative">
                <HamburgerIcon class="w-5 h-5" />
              </div>
            </button>
          </Tip>
        </Show>

        {/* ── Expanded panel ── */}
        <Show when={isExpanded()}>
          {/* Width resize handle (left edge) */}
          <div
            class={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/30 z-10 ${isResizingWidth() ? 'bg-accent/30' : ''}`}
            onMouseDown={onWidthResizeStart}
          />

          {/* ── Agent context mode (Memory/Tools) ── */}
          {/* Header with tabs */}
          <div class="flex items-center gap-2 px-3 h-12 border-b border-border flex-shrink-0">
            <Tip content="Collapse panel">
              <button
                class="p-1 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text transition-colors"
                onClick={() => toggleRightPanel()}
              >
                <HamburgerIcon class="w-5 h-5" />
              </button>
            </Tip>

            <Tabs.Root
              value={rightPanelTab()}
              onValueChange={(details) => setRightPanelTab(details.value as RightPanelTab)}
            >
              <Tabs.List class="flex gap-0.5 ml-1">
                <Tabs.Trigger value="memory" class="relative px-2.5 py-1 text-[11px] rounded-lg transition-colors data-[selected]:bg-surface-hover data-[selected]:text-text data-[selected]:font-medium text-text-muted hover:text-text-secondary hover:bg-surface-hover/50">Memory</Tabs.Trigger>
                <Tabs.Trigger value="tools" class="relative px-2.5 py-1 text-[11px] rounded-lg transition-colors data-[selected]:bg-surface-hover data-[selected]:text-text data-[selected]:font-medium text-text-muted hover:text-text-secondary hover:bg-surface-hover/50">Tools</Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>
          </div>

          {/* Content */}
          <div class="flex-1 min-h-0 overflow-hidden">
            <Show when={rightPanelTab() === 'memory'}>
              <MemoryPanel />
            </Show>
            <Show when={rightPanelTab() === 'tools'}>
              <div class="h-full relative">
                <ToolBrowser
                  open={true}
                  onClose={() => {}}
                  class="!absolute !inset-0 !w-full !h-full !rounded-none !border-0 !shadow-none !max-h-none !max-w-none"
                  embedded={true}
                />
              </div>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  );
}
