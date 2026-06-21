// Chat store — FEP event state machine with per-agent state.
// Uses SolidJS createStore + produce for granular reactivity — only changed
// properties trigger re-renders. No more immutable spread cascades that
// replace the entire message tree on every SSE event.
import { createSignal, batch, createEffect, onCleanup } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { streamPrompt, conversation as conversationAPI } from '../lib/api';
import { selectedAgent, refreshAgentHealth, getAgentRuntimeStatus } from './agents';
import { getSelectedContext, clearContextItems } from './resources';
import { onFEPEventWithKey } from './events';
import type { AgentKey } from './events';
import type {
  FEPEvent,
  Usage,
  ContextBudget,
  ToolMetadata,
  RuntimeMessage,
  RuntimeMessagePart,
  DelegationRunCompletedEvent,
  DelegationAllCompletedEvent,
  DelegationTimeoutEvent,
  DelegationResultEvent,
} from '../types';
import type {
  ChatMessage,
  MessagePart,
  TextPart,
  ReasoningPart,
  ToolPart,
  StepFinishPart,
  DelegationResultPart,
} from '../types';

// ── Thinking phase — derived from FEP event flow ──
// Visible in AgentThinking component between output gaps.
// Each phase maps to a distinct label + animation character.

export type ThinkingPhase =
  | 'connecting'  // user submitted, waiting for SSE connection + agent_start
  | 'analyzing'   // agent_start received, waiting for first LLM response
  | 'integrating' // agent_start for a delegation callback — integrating child results
  | 'thinking'    // step_start received, LLM processing
  | 'reasoning'   // reasoning_start received, deep chain-of-thought
  | 'planning'    // reasoning_end received, transitioning to action
  | 'generating'  // text_start received, waiting for first text_delta
  | 'executing'   // step_finish with tool-calls finish_reason
  | 'delegating'  // delegation.fan_out received
  | 'idle';       // not actively processing

export interface ThinkingState {
  phase: ThinkingPhase;
  stepNumber: number;
  stepCount: number;       // total steps completed so far
  finishReason: string;    // last step's finish_reason
  toolCallCount: number;   // tools called in last step
}

// ── Per-agent state ──

interface MessageStore {
  list: ChatMessage[];
}

interface AgentChatState {
  // Messages use a SolidJS store for fine-grained proxy-based reactivity.
  // Mutations via produce() only notify the specific property path that changed.
  msgStore: ReturnType<typeof createStore<MessageStore>>;
  // Scalar signals (cheap — no deep nesting)
  streaming: ReturnType<typeof createSignal<boolean>>;
  currentStep: ReturnType<typeof createSignal<number>>;
  totalUsage: ReturnType<typeof createSignal<Usage | null>>;
  lastStepUsage: ReturnType<typeof createSignal<Usage | null>>;
  activeModel: ReturnType<typeof createSignal<string | null>>;
  contextBudget: ReturnType<typeof createSignal<ContextBudget | null>>;
  activeText: ReturnType<typeof createSignal<{ id: string; content: string } | null>>;
  activeReasoning: ReturnType<typeof createSignal<{ id: string; content: string } | null>>;
  activeToolInput: ReturnType<typeof createSignal<{ id: string; toolName: string; args: string } | null>>;
  pendingPermission: ReturnType<typeof createSignal<PendingPermissionState | null>>;
  pendingQuestion: ReturnType<typeof createSignal<PendingQuestionState | null>>;
  lastTraceID: ReturnType<typeof createSignal<string | null>>;
  thinkingState: ReturnType<typeof createSignal<ThinkingState>>;
  // Non-reactive
  abortController: AbortController | null;
  // True while a per-prompt SSE handler is actively driving this agent's state
  // machine (set by sendMessage, cleared on stream end). The global async/NATS
  // listener uses this to avoid duplicate processing of events that the
  // dedicated SSE handler is already consuming. NOT used for delegation
  // callback bookkeeping — those flow exclusively through the global listener.
  ssePromptActive: boolean;
  // RAF batching for tool_input_delta
  _deltaBuffer: Map<string, string>; // toolId → accumulated delta text
  _deltaRafId: number | null;
}

interface PendingPermissionState {
  id: string;
  toolName: string;
  input: string;
  description: string;
}

interface PendingQuestionState {
  id: string;
  questions: Array<{
    question: string;
    header: string;
    options?: Array<{ label: string; description: string }>;
    multiple?: boolean;
  }>;
}

// ── Agent state registry ──

const agentStates = new Map<string, AgentChatState>();
// Reactive trigger so SolidJS re-evaluates currentState() when the Map mutates
const [stateVersion, setStateVersion] = createSignal(0);

function agentKey(ns: string, name: string): string {
  return `${ns}/${name}`;
}

function getOrCreateState(key: string): AgentChatState {
  let state = agentStates.get(key);
  if (!state) {
    state = {
      msgStore: createStore<MessageStore>({ list: [] }),
      streaming: createSignal(false),
      currentStep: createSignal(0),
      totalUsage: createSignal<Usage | null>(null),
      lastStepUsage: createSignal<Usage | null>(null),
      activeModel: createSignal<string | null>(null),
      contextBudget: createSignal<ContextBudget | null>(null),
      activeText: createSignal<{ id: string; content: string } | null>(null),
      activeReasoning: createSignal<{ id: string; content: string } | null>(null),
      activeToolInput: createSignal<{ id: string; toolName: string; args: string } | null>(null),
      pendingPermission: createSignal<PendingPermissionState | null>(null),
      pendingQuestion: createSignal<PendingQuestionState | null>(null),
      lastTraceID: createSignal<string | null>(null),
      thinkingState: createSignal<ThinkingState>({
        phase: 'idle',
        stepNumber: 0,
        stepCount: 0,
        finishReason: '',
        toolCallCount: 0,
      }),
      abortController: null,
      ssePromptActive: false,
      _deltaBuffer: new Map(),
      _deltaRafId: null,
    };
    agentStates.set(key, state);
    setStateVersion((v) => v + 1); // notify reactive consumers
  }
  return state;
}

// ── Store accessors (typed helpers) ──

function getMsgs(state: AgentChatState): ChatMessage[] {
  return state.msgStore[0].list;
}

function setMsgs(state: AgentChatState, setter: (s: MessageStore) => void) {
  state.msgStore[1](produce(setter));
}

// ── Current-agent derived accessors ──
// These read from whichever agent is currently selected.
// Components bind to these; when selectedAgent changes, they re-render.

function currentState(): AgentChatState | null {
  const agent = selectedAgent();
  stateVersion(); // subscribe to Map mutations
  if (!agent) return null;
  return agentStates.get(agentKey(agent.namespace, agent.name)) ?? null;
}

export const messages = () => currentState()?.msgStore[0].list ?? [];
export const streaming = () => currentState()?.streaming[0]() ?? false;
export const contextBudget = () => currentState()?.contextBudget[0]() ?? null;
export const activeText = () => currentState()?.activeText[0]() ?? null;
export const activeReasoning = () => currentState()?.activeReasoning[0]() ?? null;
export const pendingPermission = () => currentState()?.pendingPermission[0]() ?? null;
export const pendingQuestion = () => currentState()?.pendingQuestion[0]() ?? null;
export const thinkingState = () => currentState()?.thinkingState[0]() ?? { phase: 'idle' as ThinkingPhase, stepNumber: 0, stepCount: 0, finishReason: '', toolCallCount: 0 };

export function setPendingPermission(val: PendingPermissionState | null) {
  const state = currentState();
  if (state) state.pendingPermission[1](val);
}

export function setPendingQuestion(val: PendingQuestionState | null) {
  const state = currentState();
  if (state) state.pendingQuestion[1](val);
}

// ── Agent change: hydrate chat from working memory ──

createEffect(() => {
  const agent = selectedAgent();
  if (!agent) return;

  // Hydrate chat from working memory (if local chat is empty)
  hydrateFromWorkingMemory(agent.namespace, agent.name);
});

// ── Seed context budget from status poll on page load / agent switch ──
// The context budget is normally set by FEP SSE events (agent_start / step_finish),
// but on browser refresh those events are gone. The runtime /status endpoint always
// returns the current context_budget, so we seed from the health poll.
createEffect(() => {
  const agent = selectedAgent();
  if (!agent) return;

  const runtimeStatus = getAgentRuntimeStatus(agent.namespace, agent.name);
  if (!runtimeStatus?.context_budget) return;

  const key = agentKey(agent.namespace, agent.name);
  const state = getOrCreateState(key);
  const [getBudget, setBudget] = state.contextBudget;

  // Only seed if no budget is set yet (don't overwrite live FEP data)
  if (!getBudget()) {
    setBudget(runtimeStatus.context_budget);
  }
});

// ── Streaming agents (for sidebar indicators) ──

const [streamingAgentKeys, setStreamingAgentKeys] = createSignal<Set<string>>(new Set());
export { streamingAgentKeys };

// ── Hydration state (for skeleton loader) ──
const [isHydrating, setIsHydrating] = createSignal(false);
export { isHydrating };

// ── Composer seed (cross-page pre-fill) ──
// Lets other pages (e.g. the GitLab "New Plan" button) drop a draft into the
// chat composer without sending it. The Composer consumes and clears it so the
// human can edit before submitting.
const [composerSeed, setComposerSeed] = createSignal<string | null>(null);
export { composerSeed, setComposerSeed };

function markStreaming(key: string, isStreaming: boolean) {
  setStreamingAgentKeys((prev) => {
    const next = new Set(prev);
    if (isStreaming) {
      next.add(key);
    } else {
      next.delete(key);
    }
    return next;
  });
}

// ── Send message (agent-scoped) ──

export async function sendMessage(prompt: string) {
  const agent = selectedAgent();
  if (!agent) return;

  // Capture selected resource context before clearing (per-turn injection)
  const context = getSelectedContext();
  if (context.length > 0) {
    clearContextItems(); // clear after capturing
  }

  const key = agentKey(agent.namespace, agent.name);
  const state = getOrCreateState(key);
  const [, setStr] = state.streaming;
  const [, setStep] = state.currentStep;
  const [, setUsage] = state.totalUsage;
  const [, setATxt] = state.activeText;
  const [, setAReason] = state.activeReasoning;
  const [, setAToolIn] = state.activeToolInput;
  const [, setThinkingSt] = state.thinkingState;

  // Add user message + placeholder assistant message
  const userMsg: ChatMessage = { role: 'user', content: prompt, timestamp: Date.now() };
  const assistantMsg: ChatMessage = { role: 'assistant', parts: [], timestamp: Date.now() };

  batch(() => {
    setMsgs(state, (s) => {
      s.list.push(userMsg, assistantMsg);
    });
    setStr(true);
    setStep(0);
    setUsage(null);
    setThinkingSt({ phase: 'connecting', stepNumber: 0, stepCount: 0, finishReason: '', toolCallCount: 0 });
    setATxt(null);
    setAReason(null);
    setAToolIn(null);
  });

  markStreaming(key, true);
  state.abortController = new AbortController();
  state.ssePromptActive = true;

  // Capture for the closure — even if user switches agents mid-stream,
  // events continue writing to the correct agent's state.
  const capturedKey = key;
  const capturedState = state;

  try {
    await streamPrompt(
      agent.namespace,
      agent.name,
      prompt,
      (event) => handleFEPEvent(capturedState, capturedKey, event),
      state.abortController.signal,
      context.length > 0 ? context : undefined,
    );
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      appendPart(capturedState, { type: 'error', error: (err as Error).message });
    }
  } finally {
    // Flush any pending delta buffer
    flushDeltaBuffer(capturedState);

    batch(() => {
      capturedState.streaming[1](false);
      finalizeActiveText(capturedState);
      finalizeActiveReasoning(capturedState);
      capturedState.activeToolInput[1](null);
      capturedState.thinkingState[1]((prev) => ({ ...prev, phase: 'idle' }));
    });
    capturedState.abortController = null;
    capturedState.ssePromptActive = false;
    markStreaming(capturedKey, false);
    // Refresh agent health after stream completes (updates context usage)
    refreshAgentHealth();
  }
}

/** Abort the stream for the current agent. */
export function abortStream() {
  const agent = selectedAgent();
  if (!agent) return;
  const key = agentKey(agent.namespace, agent.name);
  const state = agentStates.get(key);
  if (state?.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  if (state) {
    flushDeltaBuffer(state);
    state.streaming[1](false);
  }
  markStreaming(key, false);
}

/** Steer the current agent mid-execution. */
export async function steerAgent(message: string) {
  const agent = selectedAgent();
  if (!agent) return;

  try {
    await conversationAPI.steer(agent.namespace, agent.name, message);
  } catch (err) {
    console.error('Failed to steer:', err);
  }
}

// ── RAF delta batching ──
// tool_input_delta events can arrive many times per frame. Instead of
// producing a store mutation per delta, we accumulate into a plain buffer
// and flush once per animation frame.

function scheduleDeltaFlush(state: AgentChatState) {
  if (state._deltaRafId !== null) return; // already scheduled
  state._deltaRafId = requestAnimationFrame(() => {
    state._deltaRafId = null;
    flushDeltaBuffer(state);
  });
}

function flushDeltaBuffer(state: AgentChatState) {
  if (state._deltaRafId !== null) {
    cancelAnimationFrame(state._deltaRafId);
    state._deltaRafId = null;
  }

  if (state._deltaBuffer.size === 0) return;

  const buffered = new Map(state._deltaBuffer);
  state._deltaBuffer.clear();

  setMsgs(state, (s) => {
    for (const [toolId, delta] of buffered) {
      const loc = findToolPartInStore(s.list, toolId);
      if (loc) {
        const [mi, pi] = loc;
        (s.list[mi].parts![pi] as ToolPart).input += delta;
      }
    }
  });

  // Keep activeToolInput in sync for any readers
  for (const [, delta] of buffered) {
    state.activeToolInput[1]((prev) =>
      prev ? { ...prev, args: prev.args + delta } : null,
    );
  }
}

// ── FEP Event Handler (agent-scoped) ──

function handleFEPEvent(state: AgentChatState, key: string, event: FEPEvent) {
  const [, setStr] = state.streaming;
  const [, setStep] = state.currentStep;
  const [, setUsage] = state.totalUsage;
  const [, setLastStep] = state.lastStepUsage;
  const [, setModel] = state.activeModel;
  const [, setBudget] = state.contextBudget;
  const [, setATxt] = state.activeText;
  const [, setAReason] = state.activeReasoning;
  const [, setAToolIn] = state.activeToolInput;
  const [, setPerm] = state.pendingPermission;
  const [, setQ] = state.pendingQuestion;
  const [, setTraceID] = state.lastTraceID;
  const [, setThinking] = state.thinkingState;

  switch (event.type) {
    case 'agent_start':
      // Capture trace_id for the Traces panel / Run detail linking
      if (event.trace_id) {
        setTraceID(event.trace_id);
      }
      // Capture context budget snapshot for the UI gauge
      if (event.context_budget) {
        setBudget(event.context_budget);
      }
      // Phase: analyzing the prompt
      setThinking((prev) => ({ ...prev, phase: 'analyzing', stepNumber: 0, stepCount: 0, finishReason: '', toolCallCount: 0 }));
      // Use server timestamp (RFC3339 UTC) for the assistant message if available.
      if (event.timestamp) {
        const serverTs = new Date(event.timestamp).getTime();
        if (!isNaN(serverTs)) {
          setMsgs(state, (s) => {
            const last = s.list[s.list.length - 1];
            if (last?.role === 'assistant') {
              last.timestamp = serverTs;
            }
          });
        }
      }
      break;

    case 'agent_finish':
      batch(() => {
        setUsage(event.total_usage);
        setModel(event.model || null);
        setThinking((prev) => ({ ...prev, phase: 'idle' }));
      });
      break;

    case 'agent_error':
      setThinking((prev) => ({ ...prev, phase: 'idle' }));
      appendPart(state, { type: 'error', error: event.error || 'Unknown error' });
      break;

    case 'step_start': {
      const stepNum = event.step_number || 0;
      setStep(stepNum);
      // Phase: thinking (LLM processing)
      setThinking((prev) => ({ ...prev, phase: 'thinking', stepNumber: stepNum }));

      // On step > 0, create a new assistant message so each step gets its own
      // bubble + TokenBadge.
      if (stepNum > 0) {
        batch(() => {
          finalizeActiveText(state);
          finalizeActiveReasoning(state);
          state.activeToolInput[1](null);
          setMsgs(state, (s) => {
            s.list.push({ role: 'assistant' as const, parts: [], timestamp: Date.now() });
          });
        });
      }
      break;
    }

    case 'step_finish':
      if (event.usage && event.usage.total_tokens > 0) {
        setLastStep(event.usage);
        appendPart(state, {
          type: 'step-finish',
          stepNumber: event.step_number || 0,
          usage: event.usage,
          finishReason: event.finish_reason || 'unknown',
          toolCallCount: event.tool_call_count || 0,
        });
      }
      // Phase: executing (tools about to run) or idle (final answer)
      {
        const reason = event.finish_reason || 'unknown';
        const toolCount = event.tool_call_count || 0;
        setThinking((prev) => ({
          ...prev,
          phase: reason === 'tool-calls' ? 'executing' : 'idle',
          stepCount: prev.stepCount + 1,
          finishReason: reason,
          toolCallCount: toolCount,
        }));
      }
      // Update context budget with actual token data
      if (event.context_budget) {
        setBudget(event.context_budget);
      }
      break;

    case 'text_start':
      // Phase: generating — waiting for first text_delta to produce visible content.
      // AgentThinking hides but the bubble shows a mini inline indicator.
      // Once text_delta arrives, the StreamingText cursor takes over seamlessly.
      setThinking((prev) => ({ ...prev, phase: 'generating' }));
      setATxt({ id: event.id || '', content: '' });
      break;

    case 'text_delta': {
      // Transition from 'generating' → idle on first actual delta
      const [getThinkSt] = state.thinkingState;
      if (getThinkSt().phase === 'generating') {
        setThinking((prev) => ({ ...prev, phase: 'idle' }));
      }
      setATxt((prev) =>
        prev ? { ...prev, content: prev.content + (event.delta || '') } : null,
      );
      break;
    }

    case 'text_end':
      finalizeActiveText(state);
      break;

    case 'reasoning_start':
      setThinking((prev) => ({ ...prev, phase: 'reasoning' }));
      setAReason({ id: event.id || '', content: '' });
      break;

    case 'reasoning_delta':
      setAReason((prev) =>
        prev ? { ...prev, content: prev.content + (event.delta || '') } : null,
      );
      break;

    case 'reasoning_end':
      setThinking((prev) => ({ ...prev, phase: 'planning' }));
      finalizeActiveReasoning(state);
      break;

    case 'tool_input_start':
      // Unified tool lifecycle: create the tool part immediately with 'composing'
      // status. The same part transitions through composing → running → done.
      appendPart(state, {
        type: 'tool',
        id: event.id || '',
        toolName: event.tool_name || '',
        input: '',
        output: '',
        isError: false,
        status: 'composing',
      });
      // Still set activeToolInput for backward compat with any code reading it
      setAToolIn({ id: event.id || '', toolName: event.tool_name || '', args: '' });
      break;

    case 'tool_input_delta': {
      // Accumulate into buffer; flush on next animation frame.
      // This collapses rapid deltas into a single store mutation per frame.
      const deltaId = state.activeToolInput[0]()?.id;
      if (deltaId && event.delta) {
        const existing = state._deltaBuffer.get(deltaId) || '';
        state._deltaBuffer.set(deltaId, existing + event.delta);
        scheduleDeltaFlush(state);
      }
      break;
    }

    case 'tool_input_end':
      // Flush any pending deltas before transitioning status
      flushDeltaBuffer(state);
      // Transition to 'running' — tool execution is about to start
      {
        const endId = state.activeToolInput[0]()?.id;
        if (endId) {
          setMsgs(state, (s) => {
            const loc = findToolPartInStore(s.list, endId);
            if (loc) {
              const [mi, pi] = loc;
              (s.list[mi].parts![pi] as ToolPart).status = 'running';
            }
          });
        }
        setAToolIn(null);
      }
      break;

    case 'tool_call':
      // Tool execution started (or completed for provider-executed tools).
      // Update the existing part with final input, or create if missing.
      {
        const toolId = event.id || '';
        const existing = findToolPartInStore(getMsgs(state), toolId);
        if (existing) {
          setMsgs(state, (s) => {
            const [mi, pi] = existing;
            const part = s.list[mi].parts![pi] as ToolPart;
            if (event.input) part.input = event.input;
            part.status = 'running';
          });
        } else {
          appendPart(state, {
            type: 'tool',
            id: toolId,
            toolName: event.tool_name || '',
            input: event.input || '',
            output: '',
            isError: false,
            status: 'running',
          });
        }
      }
      break;

    case 'tool_result': {
      const toolId = event.id || '';
      let metadata: ToolMetadata | undefined;
      if (event.metadata) {
        try {
          metadata = JSON.parse(event.metadata) as ToolMetadata;
        } catch { /* skip */ }
      }
      const dur = typeof metadata?.duration === 'number' ? metadata.duration : undefined;

      setMsgs(state, (s) => {
        const loc = findToolPartInStore(s.list, toolId);
        if (!loc) return;
        const [mi, pi] = loc;
        const part = s.list[mi].parts![pi] as ToolPart;
        part.output = event.output || '';
        part.isError = event.is_error || false;
        if (metadata) part.metadata = metadata;
        if (dur !== undefined) part.duration = dur;
        part.status = event.is_error ? 'error' : 'completed';
        if (event.media_type) part.mediaType = event.media_type;
        if (event.data) part.data = event.data;
      });
      break;
    }

    case 'permission_asked':
      setPerm({
        id: event.id || '',
        toolName: event.tool_name || '',
        input: event.input || '',
        description: event.description || '',
      });
      break;

    case 'question_asked':
      setQ({
        id: event.id || '',
        questions: (event.questions as any) || [],
      });
      break;

    case 'source':
      appendPart(state, {
        type: 'source',
        id: event.id || '',
        sourceType: event.source_type || 'url',
        url: event.url || '',
        title: event.title || '',
      });
      break;

    case 'warnings': {
      // Runtime warnings (context pressure, deprecated tools, etc.)
      const warnings = (event as any).warnings as string[] | undefined;
      if (warnings && warnings.length > 0) {
        for (const warning of warnings) {
          appendPart(state, { type: 'warning', message: warning });
        }
      }
      break;
    }

    case 'session_status':
      // Update phase based on runtime-reported session status
      if ((event as any).status === 'waiting') {
        // Agent is blocked (e.g., waiting for permission/question)
        // Don't override if we already have a permission/question pending
        if (!state.pendingPermission[0]() && !state.pendingQuestion[0]()) {
          setThinking((prev) => ({ ...prev, phase: 'analyzing' }));
        }
      }
      break;

    case 'session_idle':
      setStr(false);
      markStreaming(key, false);
      break;

    // ── Delegation events (update existing run_agents tool part in-place) ──

    case 'delegation.fan_out':
      setThinking((prev) => ({ ...prev, phase: 'delegating' }));
      break;

    case 'delegation.run_completed':
      updateDelegationMeta(state, event as DelegationRunCompletedEvent);
      break;

    case 'delegation.all_completed':
      updateDelegationAllCompleted(state, event as DelegationAllCompletedEvent);
      break;

    case 'delegation.timeout':
      updateDelegationTimeout(state, event as DelegationTimeoutEvent);
      break;

    case 'delegation.result':
      insertDelegationResult(state, event as DelegationResultEvent);
      break;
  }
}

// ── Helpers ──

function appendPart(state: AgentChatState, part: MessagePart) {
  setMsgs(state, (s) => {
    const last = s.list[s.list.length - 1];
    if (last?.role === 'assistant') {
      if (!last.parts) last.parts = [];
      last.parts.push(part);
    }
  });
}

function finalizeActiveText(state: AgentChatState) {
  const text = state.activeText[0]();
  if (text && text.content) {
    batch(() => {
      appendPart(state, { type: 'text', id: text.id, content: text.content } as TextPart);
      state.activeText[1](null);
    });
  } else {
    state.activeText[1](null);
  }
}

function finalizeActiveReasoning(state: AgentChatState) {
  const reasoning = state.activeReasoning[0]();
  if (reasoning && reasoning.content) {
    batch(() => {
      appendPart(state, { type: 'reasoning', id: reasoning.id, content: reasoning.content } as ReasoningPart);
      state.activeReasoning[1](null);
    });
  } else {
    state.activeReasoning[1](null);
  }
}

// ── Tool part lookup helpers (work on store proxy arrays) ──

/**
 * Find a tool part by its tool call ID within a store-proxy messages array.
 * Returns [messageIndex, partIndex] or null.
 */
function findToolPartInStore(
  msgs: ChatMessage[],
  toolId: string,
): [number, number] | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'assistant' || !m.parts) continue;
    for (let j = 0; j < m.parts.length; j++) {
      const p = m.parts[j];
      if (p.type === 'tool' && (p as ToolPart).id === toolId) {
        return [i, j];
      }
    }
  }
  return null;
}

// ── Delegation metadata updaters ──
// These find the run_agents tool part by groupId and patch its metadata
// so the DelegationFanOutCard re-renders with live progress.

function findDelegationToolPartInStore(
  msgs: ChatMessage[],
  groupId: string,
): [number, number] | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'assistant' || !m.parts) continue;
    for (let j = 0; j < m.parts.length; j++) {
      const p = m.parts[j];
      if (
        p.type === 'tool' &&
        (p as ToolPart).metadata?.ui === 'delegation-fan-out' &&
        (p as ToolPart).metadata?.groupId === groupId
      ) {
        return [i, j];
      }
    }
  }
  return null;
}

/** Update delegation tool part when a child run completes. */
function updateDelegationMeta(state: AgentChatState, event: DelegationRunCompletedEvent) {
  setMsgs(state, (s) => {
    const loc = findDelegationToolPartInStore(s.list, event.groupId);
    if (!loc) return;
    const [mi, pi] = loc;
    const part = s.list[mi].parts![pi] as ToolPart;
    if (!part.metadata) part.metadata = {} as ToolMetadata;
    const meta = part.metadata as ToolMetadata & Record<string, unknown>;

    // Build completedRuns map: { runName: { childAgent, phase, duration } }
    if (!meta._completedRuns) meta._completedRuns = {};
    (meta._completedRuns as Record<string, unknown>)[event.runName] = {
      childAgent: event.childAgent,
      phase: event.phase,
      duration: event.duration,
    };
    meta._remaining = event.remaining;
  });
}

/** Mark delegation group as fully completed. */
function updateDelegationAllCompleted(state: AgentChatState, event: DelegationAllCompletedEvent) {
  setMsgs(state, (s) => {
    const loc = findDelegationToolPartInStore(s.list, event.groupId);
    if (!loc) return;
    const [mi, pi] = loc;
    const part = s.list[mi].parts![pi] as ToolPart;
    if (!part.metadata) part.metadata = {} as ToolMetadata;
    const meta = part.metadata as ToolMetadata & Record<string, unknown>;

    meta._allCompleted = true;
    meta._succeeded = event.succeeded;
    meta._failed = event.failed;
    meta._totalDuration = event.totalDuration;
    meta._remaining = 0;
  });
}

/** Mark delegation group as timed out. */
function updateDelegationTimeout(state: AgentChatState, event: DelegationTimeoutEvent) {
  setMsgs(state, (s) => {
    const loc = findDelegationToolPartInStore(s.list, event.groupId);
    if (!loc) return;
    const [mi, pi] = loc;
    const part = s.list[mi].parts![pi] as ToolPart;
    if (!part.metadata) part.metadata = {} as ToolMetadata;
    const meta = part.metadata as ToolMetadata & Record<string, unknown>;

    meta._timedOut = true;
    meta._completedCount = event.completed;
    meta._timedOutCount = event.timedOut;
  });
}

/** Insert a structured delegation result card into the chat. */
function insertDelegationResult(state: AgentChatState, event: DelegationResultEvent) {
  const part: DelegationResultPart = {
    type: 'delegation-result',
    groupId: event.groupId,
    single: event.single,
    timedOut: event.timedOut,
    totalDuration: event.totalDuration,
    succeeded: event.succeeded,
    failed: event.failed,
    runs: event.runs,
  };
  // Finalize any in-progress text so the card appears after it
  finalizeActiveText(state);
  appendPart(state, part);
}

// ── Working memory hydration ──

/**
 * Convert RuntimeMessage[] (from the runtime's GET /working-memory) into
 * ChatMessage[] for the frontend. Groups assistant + tool messages together,
 * merges tool results back into their tool call parts.
 */
function runtimeToChat(runtimeMessages: RuntimeMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let currentAssistant: ChatMessage | null = null;
  // Tracks when the previous user message was a synthetic delegation callback
  // steer — the next assistant message should be marked as internal.
  let pendingInternalAssistant = false;

  for (const msg of runtimeMessages) {
    if (msg.role === 'user') {
      // Flush any pending assistant
      if (currentAssistant) {
        result.push(currentAssistant);
        currentAssistant = null;
      }
      // Extract text from content parts
      const text = msg.content
        ?.filter((p) => p.type === 'text')
        .map((p) => p.text || '')
        .join('\n') || '';
      // Skip synthetic delegation-callback prompts — these are internal
      // "steer" messages the runtime injects after a child agent completes.
      // The user never typed them; rendering them as user bubbles is confusing.
      // The subsequent assistant message (the callback response) is kept and
      // marked as `internal` so the UI can show a proper indicator on replay.
      if (text.startsWith('[DELEGATION RESULT]') || text.startsWith('[DELEGATION RESULTS]')) {
        // Next assistant block should be flagged as internal
        pendingInternalAssistant = true;
        continue;
      }
      result.push({ role: 'user', content: text, timestamp: Date.now() });

    } else if (msg.role === 'assistant') {
      // Flush any pending assistant (new step = new bubble)
      if (currentAssistant) {
        result.push(currentAssistant);
      }
      currentAssistant = {
        role: 'assistant',
        parts: [],
        timestamp: Date.now(),
        ...(pendingInternalAssistant ? { internal: true, source: 'delegation_callback' } : {}),
      };
      pendingInternalAssistant = false;

      for (const part of msg.content || []) {
        if (part.type === 'text' && part.text) {
          currentAssistant.parts!.push({
            type: 'text',
            id: crypto.randomUUID(),
            content: part.text,
          } as TextPart);
        } else if (part.type === 'reasoning' && part.text) {
          currentAssistant.parts!.push({
            type: 'reasoning',
            id: crypto.randomUUID(),
            content: part.text,
          } as ReasoningPart);
        } else if (part.type === 'tool-call') {
          currentAssistant.parts!.push({
            type: 'tool',
            id: part.tool_call_id || crypto.randomUUID(),
            toolName: part.tool_name || '',
            input: part.input || '',
            output: '',
            isError: false,
            status: 'completed', // historical — already finished
          } as ToolPart);
        }
      }

    } else if (msg.role === 'tool') {
      // Tool result — find the matching tool-call in currentAssistant
      if (!currentAssistant) continue;

      for (const part of msg.content || []) {
        if (part.type === 'tool-result' && part.tool_call_id) {
          const toolPart = currentAssistant.parts?.find(
            (p) => p.type === 'tool' && (p as ToolPart).id === part.tool_call_id,
          ) as ToolPart | undefined;
          if (toolPart) {
            const output = part.output;
            if (output) {
              toolPart.output = output.text || output.error || '';
              toolPart.isError = output.type === 'error';
              if (output.type === 'media') {
                toolPart.mediaType = output.media_type;
                toolPart.data = output.data;
              }
            }
            // Restore metadata from working memory (renderer hints, duration, etc.)
            if (part.metadata) {
              try {
                const meta = JSON.parse(part.metadata);
                toolPart.metadata = meta;
                if (typeof meta?.duration === 'number') {
                  toolPart.duration = meta.duration;
                }
              } catch { /* malformed metadata — ignore */ }
            }
          }
        }
      }
    }
  }

  // Flush last assistant
  if (currentAssistant) {
    result.push(currentAssistant);
  }

  return result;
}

/**
 * Hydrate the chat for the selected agent from the runtime's working memory.
 * Called on agent change / page load. Only populates if the local chat is empty
 * (doesn't overwrite an in-progress conversation).
 */
async function hydrateFromWorkingMemory(ns: string, name: string) {
  const key = agentKey(ns, name);
  const state = agentStates.get(key);

  // Don't hydrate if already streaming or if we already have messages
  if (state?.streaming[0]()) return;
  if (state && getMsgs(state).length > 0) return;

  setIsHydrating(true);
  try {
    const runtimeMsgs = await conversationAPI.getWorkingMemory(ns, name);
    if (!runtimeMsgs || runtimeMsgs.length === 0) return;

    const chatMsgs = runtimeToChat(runtimeMsgs);
    if (chatMsgs.length === 0) return;

    // Re-check: might have started streaming while we waited
    const freshState = getOrCreateState(key);
    if (freshState.streaming[0]() || getMsgs(freshState).length > 0) return;

    // Use reconcile for full replacement — wraps plain objects into store proxies
    freshState.msgStore[1]('list', reconcile(chatMsgs));
  } catch {
    // Silently fail — agent might be unreachable or BFF not ready
  } finally {
    setIsHydrating(false);
  }
}

// ── Global SSE event subscription ──
// Handles two categories of events arriving via the global SSE multiplexer:
//
// 1. Delegation events (run_completed, all_completed, timeout) — arrive after
//    the parent agent's per-prompt SSE stream has closed.
//
// 2. Async FEP events from NATS — when handleInternalPrompt runs a delegation
//    callback, all FEP events (agent_start, text_*, step_*, tool_*, agent_finish,
//    session_idle) flow through NATS → BFF → global SSE. The browser must create
//    message bubbles and stream content in real-time even though no user-initiated
//    stream is active.

/** Event types that are handled during a per-prompt SSE stream (user-initiated).
 *  When these arrive via the global SSE while no stream is active, they indicate
 *  an async internal prompt (delegation callback). */
const ASYNC_FEP_EVENTS = new Set([
  'agent_start', 'agent_finish', 'agent_error',
  'step_start', 'step_finish',
  'text_start', 'text_delta', 'text_end',
  'reasoning_start', 'reasoning_delta', 'reasoning_end',
  'tool_input_start', 'tool_input_delta', 'tool_input_end',
  'tool_call', 'tool_result',
  'source', 'warnings', 'stream_finish',
  'permission_asked', 'question_asked',
  'session_idle',
]);

/** Delegation event types that need broadcasting to all agent states. */
const DELEGATION_EVENTS = new Set([
  'delegation.run_completed',
  'delegation.all_completed',
  'delegation.timeout',
  'delegation.fan_out',
]);

/** Start listening for async FEP and delegation events on the global SSE.
 *  Call once at app mount. */
export function startDelegationEventListener() {
  return onFEPEventWithKey((agentKeyObj: AgentKey, event: FEPEvent) => {
    const isDelegation = DELEGATION_EVENTS.has(event.type);
    const isAsyncFEP = ASYNC_FEP_EVENTS.has(event.type);

    if (!isDelegation && !isAsyncFEP) return;

    if (isDelegation) {
      // Delegation events: route to all agent states (parentAgent matching
      // happens inside handleFEPEvent via tool part lookup).
      for (const [key, state] of agentStates.entries()) {
        handleFEPEvent(state, key, event);
      }
      return;
    }

    // Async FEP event — route to the specific agent identified by NATS subject.
    const key = agentKey(agentKeyObj.namespace, agentKeyObj.name);
    const state = getOrCreateState(key);

    // If this agent is already streaming via a user-initiated prompt, the
    // per-prompt SSE handler is driving the state machine — skip the global
    // handler to avoid duplicate processing. Note: we check ssePromptActive
    // (set only by sendMessage), NOT state.streaming — async delegation
    // callbacks set streaming=true themselves and need their own subsequent
    // events (text_delta, agent_finish, etc.) to flow through this handler.
    if (state.ssePromptActive) return;

    // agent_start from an async source (delegation callback): set up message
    // bubbles and mark as streaming so subsequent events have a target.
    if (event.type === 'agent_start') {
      // Internal prompts (delegation callbacks, scheduled nudges, etc.) must
      // NOT render a user bubble — the synthetic prompt is an implementation
      // detail, not something the user typed. Just set up the assistant bubble
      // with a "processing results" indicator.
      const isInternal = event.internal === true || !event.prompt;

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        parts: [],
        timestamp: Date.now(),
        internal: isInternal,
        source: event.source,
      };

      batch(() => {
        setMsgs(state, (s) => {
          if (isInternal) {
            s.list.push(assistantMsg);
          } else {
            const userMsg: ChatMessage = {
              role: 'user',
              content: event.prompt || '',
              timestamp: Date.now(),
            };
            s.list.push(userMsg, assistantMsg);
          }
        });
        state.streaming[1](true);
        state.currentStep[1](0);
        state.totalUsage[1](null);
        state.activeText[1](null);
        state.activeReasoning[1](null);
        state.activeToolInput[1](null);
        // Show the thinking indicator immediately — gives the user a visible
        // "integrating delegation results…" signal before text arrives.
        state.thinkingState[1]({
          phase: isInternal ? 'integrating' : 'connecting',
          stepNumber: 0,
          stepCount: 0,
          finishReason: '',
          toolCallCount: 0,
        });
      });
      markStreaming(key, true);
    }

    // session_idle from an async source: finalize and clean up.
    if (event.type === 'session_idle') {
      batch(() => {
        flushDeltaBuffer(state);
        finalizeActiveText(state);
        finalizeActiveReasoning(state);
        state.activeToolInput[1](null);
        state.streaming[1](false);
        state.thinkingState[1]((prev) => ({ ...prev, phase: 'idle' }));
      });
      markStreaming(key, false);
      refreshAgentHealth();
      return; // Don't pass to handleFEPEvent — we've handled it fully
    }

    // Route through the normal FEP state machine
    handleFEPEvent(state, key, event);
  });
}
