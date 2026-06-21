// MainApp — three-panel layout: Left Sidebar (agents) + Center Stage + Right Panel (memory/runs).
// Both sidebars are collapsible to a thin strip with hamburger icons.
// Center panel has a unified h-12 header bar aligned with both sidebars.
// Center content switches based on agent selection, mode, and centerView overlay:
// - centerView === 'run-detail' -> RunDetailView (selected run from sidebar)
// - centerView === 'trace-detail' -> TraceDetailView (selected trace)
// - No agent -> EmptyState
// - Daemon agent (orchestrator) -> OrchestratorDetailView (Chat + Delegation tabs)
// - Task agent (channel) -> AgentInspector (config, tools, resources)
import { onMount, onCleanup, Show, createMemo } from 'solid-js';
import { startEventStream } from '../stores/events';
import { selectedAgent, agentList } from '../stores/agents';
import { centerView } from '../stores/view';
import { selectedRunKey, allRuns, refreshRuns, startRunPolling, stopRunPolling } from '../stores/runs';
import { selectedTraceForDetail } from '../stores/view';
import { phaseVariant } from '../lib/format';
import { MonitorIcon } from '../components/shared/Icons';
import { startDelegationEventListener } from '../stores/chat';
import AppErrorBoundary from '../components/shared/ErrorBoundary';
import Sidebar from '../components/layout/Sidebar';
import RightPanel from '../components/layout/RightPanel';
import OrchestratorDetailView from '../components/agents/OrchestratorDetailView';
import AgentInspector from '../components/agents/AgentInspector';
import RunDetailView from '../components/runs/RunDetailView';
import TraceDetailView from '../components/traces/TraceDetailView';
import EmptyState from '../components/shared/EmptyState';
import Badge from '../components/shared/Badge';

export default function MainApp() {
  // Start global SSE and run polling on mount
  onMount(() => {
    startEventStream();
    startRunPolling();
    refreshRuns();
    const unsubDelegation = startDelegationEventListener();

    // Prevent browser back button from leaving the app.
    // Push a guard state so popstate fires before navigation leaves '/'.
    history.pushState({ guard: true }, '');
    const onPopState = () => {
      // Re-push the guard so the back button stays trapped
      history.pushState({ guard: true }, '');
    };
    window.addEventListener('popstate', onPopState);
    onCleanup(() => {
      window.removeEventListener('popstate', onPopState);
      unsubDelegation();
    });
  });

  onCleanup(() => {
    stopRunPolling();
  });

  const hasAgent = () => selectedAgent() !== null;
  const showRunOverlay = () => centerView() === 'run-detail' && selectedRunKey() !== null;
  const showTraceOverlay = () => centerView() === 'trace-detail' && selectedTraceForDetail() !== null;

  const agentInfo = createMemo(() => {
    const sel = selectedAgent();
    if (!sel) return null;
    const list = agentList();
    return list?.find((a) => a.namespace === sel.namespace && a.name === sel.name) ?? null;
  });

  const isTaskAgent = createMemo(() => agentInfo()?.mode === 'task');
  const isDaemonAgent = createMemo(() => agentInfo()?.mode === 'daemon');

  // Run info for the header when in run-detail mode
  const selectedRun = createMemo(() => {
    const key = selectedRunKey();
    if (!key) return null;
    const runs = allRuns() ?? [];
    return runs.find((r) => `${r.metadata.namespace}/${r.metadata.name}` === key) ?? null;
  });

  return (
    <div class="flex h-full bg-background text-text overflow-hidden">
      {/* ── Left Sidebar (agents — hierarchical) ── */}
      <AppErrorBoundary name="Sidebar">
        <Sidebar />
      </AppErrorBoundary>

      {/* ── Center Stage ── */}
      <div class="flex-1 flex flex-col min-w-0">
        {/* ── Unified header bar — hidden for orchestrators in default view (tabs replace it) ── */}
        <Show when={showTraceOverlay() || showRunOverlay() || !isDaemonAgent()}>
          <div class="flex items-center gap-3 px-4 h-12 border-b border-border flex-shrink-0">
            <Show when={showTraceOverlay()}>
              <MonitorIcon class="w-4 h-4 text-text-muted flex-shrink-0" />
              <span class="text-sm font-semibold text-text font-mono truncate min-w-0">
                {selectedTraceForDetail()}
              </span>
              <div class="ml-auto flex-shrink-0">
                <Badge variant="info" dot>trace</Badge>
              </div>
            </Show>

            <Show when={!showTraceOverlay() && showRunOverlay() && selectedRun()}>
              {(run) => (
                <>
                  <span class="text-sm font-semibold text-text font-mono truncate">
                    {run().metadata.name}
                  </span>
                  <span class="text-xs text-text-muted">{run().spec.agentRef}</span>
                  <div class="ml-auto flex-shrink-0">
                    <Badge variant={phaseVariant(run().status?.phase)} dot>
                      {run().status?.phase || '?'}
                    </Badge>
                  </div>
                </>
              )}
            </Show>

            <Show when={!showTraceOverlay() && !showRunOverlay() && agentInfo()}>
              {(info) => (
                <>
                  <span class="text-sm font-semibold text-text truncate">
                    {info().name}
                  </span>
                  <span class="text-xs text-text-muted font-mono">{info().model}</span>

                  <Show when={info().phase}>
                    <div class="ml-auto flex-shrink-0">
                      <Badge variant={phaseVariant(info().phase)} dot>
                        {info().phase}
                      </Badge>
                    </div>
                  </Show>
                </>
              )}
            </Show>

            <Show when={!showTraceOverlay() && !showRunOverlay() && !hasAgent()}>
              <span class="text-sm text-text-muted">Select an agent</span>
            </Show>
          </div>
        </Show>

        {/* ── Content below header ── */}
        <AppErrorBoundary name="Center Panel">
          <Show when={showTraceOverlay()}>
            <TraceDetailView class="flex-1 min-h-0" />
          </Show>

          <Show when={!showTraceOverlay() && showRunOverlay()}>
            <RunDetailView class="flex-1 min-h-0" />
          </Show>

          <Show when={!showTraceOverlay() && !showRunOverlay()}>
            <Show when={!hasAgent()}>
              <div class="flex-1 flex items-center justify-center min-h-0">
                <EmptyState
                  title="Select an Agent"
                  description="Choose an agent from the sidebar to get started."
                />
              </div>
            </Show>

            <Show when={hasAgent()}>
              <Show when={isDaemonAgent()} fallback={<AgentInspector class="flex-1 min-h-0" />}>
                <OrchestratorDetailView class="flex-1 min-h-0" />
              </Show>
            </Show>
          </Show>
        </AppErrorBoundary>
      </div>

      {/* ── Right Panel — hidden for orchestrators (tabs are in center), only show for task agents or trace overlay (span detail) ── */}
      <Show when={!isDaemonAgent() || showTraceOverlay()}>
        <AppErrorBoundary name="Right Panel">
          <RightPanel />
        </AppErrorBoundary>
      </Show>
    </div>
  );
}
