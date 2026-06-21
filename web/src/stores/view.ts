// View store — tracks layout state for both sidebars and center panel routing.
import { createSignal } from 'solid-js';
import type { TraceSpan, TraceProcess } from '../types';

export type PanelState = 'collapsed' | 'expanded';

// ── Center panel view mode ──
// 'default' = normal routing (agent-based: ChatView/AgentInspector/EmptyState)
// 'run-detail' = show a specific AgentRun in the center stage
// 'trace-detail' = show a specific trace waterfall in the center stage
export type CenterView = 'default' | 'run-detail' | 'trace-detail';

const [centerView, setCenterViewRaw] = createSignal<CenterView>('default');

export { centerView };

export function setCenterView(view: CenterView) {
  setCenterViewRaw(view);
}

export function showRunDetail() {
  setCenterViewRaw('run-detail');
}

// ── Trace detail state ──
const [selectedTraceForDetail, setSelectedTraceForDetail] = createSignal<string | null>(null);
export { selectedTraceForDetail };

export function showTraceDetail(traceID: string) {
  setSelectedTraceForDetail(traceID);
  setSelectedSpanIDRaw(null);
  setSelectedSpanDataRaw(null);
  setTraceProcessesRaw({});
  setCenterViewRaw('trace-detail');
}

export function clearCenterOverlay() {
  setCenterViewRaw('default');
  setSelectedTraceForDetail(null);
  setSelectedSpanIDRaw(null);
  setSelectedSpanDataRaw(null);
  setTraceProcessesRaw({});
}

// ── Selected span state (shared between TraceDetailView and RightPanel) ──
// When a span is clicked in the waterfall, it populates these signals so
// the RightPanel can render SpanDetailPanel instead of Memory/Tools/Resources.

const [selectedSpanID, setSelectedSpanIDRaw] = createSignal<string | null>(null);
const [selectedSpanData, setSelectedSpanDataRaw] = createSignal<TraceSpan | null>(null);
const [traceProcesses, setTraceProcessesRaw] = createSignal<Record<string, TraceProcess>>({});

export { selectedSpanID, selectedSpanData, traceProcesses };

export function selectSpan(spanID: string | null, span: TraceSpan | null, processes?: Record<string, TraceProcess>) {
  setSelectedSpanIDRaw(spanID);
  setSelectedSpanDataRaw(span);
  if (processes !== undefined) setTraceProcessesRaw(processes);
  // Auto-expand the right panel when selecting a span
  if (spanID && span) {
    setRightPanelState('expanded');
  }
}

export function clearSelectedSpan() {
  setSelectedSpanIDRaw(null);
  setSelectedSpanDataRaw(null);
}

// ── Left panel (agents) ──

const LEFT_KEY = 'agentops:leftPanel';

function loadLeftState(): PanelState {
  try {
    const raw = localStorage.getItem(LEFT_KEY);
    if (raw === 'collapsed') return 'collapsed';
  } catch { /* ignore */ }
  return 'expanded';
}

const [leftPanelState, setLeftPanelStateRaw] = createSignal<PanelState>(loadLeftState());

export { leftPanelState };

export function setLeftPanelState(state: PanelState) {
  setLeftPanelStateRaw(state);
  try {
    localStorage.setItem(LEFT_KEY, state);
  } catch { /* ignore */ }
}

export function toggleLeftPanel() {
  const current = leftPanelState();
  setLeftPanelState(current === 'collapsed' ? 'expanded' : 'collapsed');
}

// ── Right panel (runs) ──

const RIGHT_KEY = 'agentops:rightPanel';

function loadRightState(): PanelState {
  try {
    const raw = localStorage.getItem(RIGHT_KEY);
    if (raw === 'expanded') return 'expanded';
  } catch { /* ignore */ }
  return 'collapsed';
}

const [rightPanelState, setRightPanelStateRaw] = createSignal<PanelState>(loadRightState());

export { rightPanelState };

export function setRightPanelState(state: PanelState) {
  setRightPanelStateRaw(state);
  try {
    localStorage.setItem(RIGHT_KEY, state);
  } catch { /* ignore */ }
}

export function toggleRightPanel() {
  const current = rightPanelState();
  setRightPanelState(current === 'collapsed' ? 'expanded' : 'collapsed');
}

// ── Left panel tab (agents, traces) ──
// Note: 'runs' kept in type for localStorage backwards compat — falls back to 'agents'.

export type LeftPanelTab = 'agents' | 'runs' | 'traces';

const LEFT_TAB_KEY = 'agentops:leftPanelTab';

function loadLeftTabState(): LeftPanelTab {
  try {
    const raw = localStorage.getItem(LEFT_TAB_KEY);
    if (raw === 'agents' || raw === 'traces') return raw;
  } catch { /* ignore */ }
  return 'agents';
}

const [leftPanelTab, setLeftPanelTabRaw] = createSignal<LeftPanelTab>(loadLeftTabState());

export { leftPanelTab };

export function setLeftPanelTab(tab: LeftPanelTab) {
  setLeftPanelTabRaw(tab);
  try {
    localStorage.setItem(LEFT_TAB_KEY, tab);
  } catch { /* ignore */ }
}

// ── Right panel tab (agent context: memory, tools, skills) ──

export type RightPanelTab = 'memory' | 'tools';

const TAB_KEY = 'agentops:rightPanelTab';

function loadRightTabState(): RightPanelTab {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    if (raw === 'memory' || raw === 'tools') return raw;
  } catch { /* ignore */ }
  return 'memory';
}

const [rightPanelTab, setRightPanelTabRaw] = createSignal<RightPanelTab>(loadRightTabState());

export { rightPanelTab };

export function setRightPanelTab(tab: RightPanelTab) {
  setRightPanelTabRaw(tab);
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
}

// Legacy exports — kept so existing imports don't break.
export type RightPanelState = PanelState;
export type AppView = 'agents' | 'runs';
export const activeView = () => 'agents' as const;
export function setActiveView(_view: AppView) {
  if (_view === 'runs') {
    setRightPanelState('expanded');
  }
}
