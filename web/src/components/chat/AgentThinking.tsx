// AgentThinking — phase-aware thinking indicator.
// Displays context-sensitive labels derived from the FEP event flow:
//   analyzing → thinking → reasoning → planning → executing → delegating
// Each phase has a distinct animation character and label. Step number
// is shown for multi-step interactions. Elapsed timer appears after 2s.
import { Show, onCleanup, createSignal, createEffect, createMemo } from 'solid-js';
import type { ThinkingPhase, ThinkingState } from '../../stores/chat';
import { thinkingStyle } from '../../stores/settings';

interface AgentThinkingProps {
  active: boolean;
  thinkingState: ThinkingState;
}

/** Phase display configuration */
const PHASE_CONFIG: Record<ThinkingPhase, { label: string; animClass: string }> = {
  connecting:  { label: 'Connecting',                   animClass: 'agent-thinking--phase-connecting' },
  analyzing:   { label: 'Analyzing',                    animClass: 'agent-thinking--phase-analyzing' },
  integrating: { label: 'Integrating delegation results', animClass: 'agent-thinking--phase-delegating' },
  thinking:    { label: 'Thinking',                     animClass: 'agent-thinking--phase-thinking' },
  reasoning:   { label: 'Reasoning',                    animClass: 'agent-thinking--phase-reasoning' },
  planning:    { label: 'Planning',                     animClass: 'agent-thinking--phase-planning' },
  generating:  { label: 'Writing',                      animClass: 'agent-thinking--phase-generating' },
  executing:   { label: 'Executing',                    animClass: 'agent-thinking--phase-executing' },
  delegating:  { label: 'Delegating',                   animClass: 'agent-thinking--phase-delegating' },
  idle:        { label: 'Thinking',                     animClass: 'agent-thinking--phase-thinking' },
};

export default function AgentThinking(props: AgentThinkingProps) {
  const [elapsed, setElapsed] = createSignal(0);
  const [prevPhase, setPrevPhase] = createSignal<ThinkingPhase>('idle');
  const [phaseChanged, setPhaseChanged] = createSignal(false);
  let interval: ReturnType<typeof setInterval> | null = null;
  let startTime = 0;

  // Start/stop timer based on active state
  const startTimer = () => {
    startTime = Date.now();
    setElapsed(0);
    interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  };

  const stopTimer = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    setElapsed(0);
  };

  // Watch active prop changes
  const checkActive = () => {
    if (props.active && !interval) {
      startTimer();
    } else if (!props.active && interval) {
      stopTimer();
    }
  };

  const isActive = () => {
    checkActive();
    return props.active;
  };

  // Track phase transitions for label swap animation
  createEffect(() => {
    const phase = props.thinkingState.phase;
    if (phase !== prevPhase()) {
      setPrevPhase(phase);
      setPhaseChanged(true);
      // Clear the animation trigger after the CSS transition completes
      const t = setTimeout(() => setPhaseChanged(false), 200);
      onCleanup(() => clearTimeout(t));
    }
  });

  onCleanup(() => stopTimer());

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const phase = () => props.thinkingState.phase;
  const config = createMemo(() => PHASE_CONFIG[phase()] || PHASE_CONFIG.thinking);
  const styleClass = createMemo(() => `agent-thinking--style-${thinkingStyle()}`);
  const stepNumber = () => props.thinkingState.stepNumber;
  const stepCount = () => props.thinkingState.stepCount;

  // Step context: "Step 2" shown when multi-step, with finish reason hint
  const stepLabel = createMemo(() => {
    const step = stepNumber();
    const count = stepCount();
    if (step === 0 && count === 0) return '';
    // After first step completes, show step context
    if (step > 0) return `Step ${step + 1}`;
    if (count > 0) return `Step ${count + 1}`;
    return '';
  });

  // Finish reason context for the step badge
  const reasonHint = createMemo(() => {
    const reason = props.thinkingState.finishReason;
    const tools = props.thinkingState.toolCallCount;
    if (!reason || reason === 'unknown') return '';
    switch (reason) {
      case 'tool-calls': return tools > 1 ? `${tools} tools` : '1 tool';
      case 'length': return 'length limit';
      case 'content-filter': return 'filtered';
      default: return '';
    }
  });

  return (
    <Show when={isActive()}>
      <div class={`agent-thinking fade-slide-in ${config().animClass} ${styleClass()}`} role="status" aria-live="polite">
        {/* Phase-specific animation */}
        <div class="agent-thinking__indicator" aria-hidden="true">
          <span class="agent-thinking__spark agent-thinking__spark--lead" />
          <span class="agent-thinking__spark agent-thinking__spark--mid" />
          <span class="agent-thinking__spark agent-thinking__spark--trail" />
        </div>

        {/* Phase label with swap animation */}
        <span class={`agent-thinking__label ${phaseChanged() ? 'agent-thinking__label--entering' : ''}`}>
          {config().label}
        </span>

        {/* Step badge */}
        <Show when={stepLabel()}>
          <span class="agent-thinking__step">
            {stepLabel()}
            <Show when={reasonHint()}>
              <span class="agent-thinking__reason">{reasonHint()}</span>
            </Show>
          </span>
        </Show>

        {/* Elapsed timer — shows after 2s */}
        <Show when={elapsed() >= 2}>
          <span class="agent-thinking__elapsed" aria-hidden="true">{formatElapsed(elapsed())}</span>
        </Show>
      </div>
    </Show>
  );
}
