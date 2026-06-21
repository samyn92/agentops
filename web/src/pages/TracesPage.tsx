// TracesPage — standalone full-width traces view with inline detail.
import { Show, createEffect } from 'solid-js';
import TracesPanel from '../components/layout/TracesPanel';
import TraceDetailView from '../components/traces/TraceDetailView';
import { selectedTraceForDetail, clearCenterOverlay, showTraceDetail } from '../stores/view';
import AppErrorBoundary from '../components/shared/ErrorBoundary';
import { traces as tracesAPI } from '../lib/api';

export default function TracesPage() {
  const hasDetail = () => !!selectedTraceForDetail();

  // Auto-select the most recent trace if none is selected.
  createEffect(async () => {
    if (selectedTraceForDetail()) return;
    try {
      const result = await tracesAPI.search({ limit: 1 });
      if (result.traces?.length > 0) {
        showTraceDetail(result.traces[0].traceID);
      }
    } catch { /* ignore — traces may not be available */ }
  });

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
