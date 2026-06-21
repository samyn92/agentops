// TracesPage — standalone full-width traces view with inline detail.
import { Show } from 'solid-js';
import TracesPanel from '../components/layout/TracesPanel';
import TraceDetailView from '../components/traces/TraceDetailView';
import { selectedTraceForDetail, clearCenterOverlay } from '../stores/view';
import AppErrorBoundary from '../components/shared/ErrorBoundary';

export default function TracesPage() {
  const hasDetail = () => !!selectedTraceForDetail();

  return (
    <div class="h-full flex bg-background text-text overflow-hidden">
      {/* Left: trace list */}
      <div class="flex flex-col border-r border-border"
        classList={{ 'w-80 flex-shrink-0': hasDetail(), 'flex-1': !hasDetail() }}>
        <TracesPanel />
      </div>

      {/* Right: trace detail (shown when a trace is selected) */}
      <Show when={hasDetail()}>
        <div class="flex-1 min-h-0 flex flex-col">
          <div class="flex items-center justify-end px-3 py-1.5 border-b border-border flex-shrink-0">
            <button
              class="text-[11px] text-text-muted hover:text-text px-2 py-1 rounded-md hover:bg-surface-hover transition-colors"
              onClick={clearCenterOverlay}
            >
              Close
            </button>
          </div>
          <div class="flex-1 min-h-0 overflow-auto">
            <AppErrorBoundary name="Trace Detail">
              <TraceDetailView />
            </AppErrorBoundary>
          </div>
        </div>
      </Show>
    </div>
  );
}
