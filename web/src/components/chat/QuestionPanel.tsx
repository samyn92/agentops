// QuestionPanel — interactive question from the agent
// Shown when the runtime emits a question_asked FEP event.
import { createSignal, For, Show } from 'solid-js';
import { control } from '../../lib/api';
import { selectedAgent } from '../../stores/agents';
import Badge from '../shared/Badge';

interface QuestionItem {
  header: string;
  question: string;
  options?: Array<{ label: string; description: string }>;
  multiple?: boolean;
}

interface QuestionPanelProps {
  questionData: {
    id: string;
    questions: QuestionItem[];
  };
  onResolve: () => void;
}

export default function QuestionPanel(props: QuestionPanelProps) {
  const data = () => props.questionData;

  // Track selected answers for each question
  // answers[i] = array of selected labels for question i
  const [answers, setAnswers] = createSignal<string[][]>(
    data().questions.map(() => []),
  );

  const [customInputs, setCustomInputs] = createSignal<string[]>(
    data().questions.map(() => ''),
  );

  function toggleOption(questionIdx: number, label: string, isMultiple: boolean) {
    setAnswers((prev) => {
      const updated = [...prev];
      const current = [...(updated[questionIdx] || [])];

      if (isMultiple) {
        const idx = current.indexOf(label);
        if (idx >= 0) {
          current.splice(idx, 1);
        } else {
          current.push(label);
        }
      } else {
        // Single select: replace
        if (current.length === 1 && current[0] === label) {
          return prev; // already selected
        }
        updated[questionIdx] = [label];
        return updated;
      }

      updated[questionIdx] = current;
      return updated;
    });
  }

  function setCustomInput(questionIdx: number, value: string) {
    setCustomInputs((prev) => {
      const updated = [...prev];
      updated[questionIdx] = value;
      return updated;
    });
  }

  function canSubmit() {
    return data().questions.every((q, i) => {
      if (q.options && q.options.length > 0) {
        return answers()[i]?.length > 0;
      }
      return customInputs()[i]?.trim().length > 0;
    });
  }

  async function handleSubmit() {
    const agent = selectedAgent();
    if (!agent) return;

    // Build final answers array
    const finalAnswers = data().questions.map((q, i) => {
      if (q.options && q.options.length > 0 && answers()[i]?.length > 0) {
        return answers()[i];
      }
      const custom = customInputs()[i]?.trim();
      return custom ? [custom] : [];
    });

    try {
      await control.replyQuestion(
        agent.namespace,
        agent.name,
        data().id,
        finalAnswers,
      );
    } catch (err) {
      console.error('Failed to reply to question:', err);
    }
    props.onResolve();
  }

  return (
    <div class="border border-info/40 bg-info/5 rounded-lg overflow-hidden my-2 animate-in fade-in slide-in-from-bottom-2">
      {/* Header */}
      <div class="flex items-center gap-2 px-4 py-2.5 bg-info/10 border-b border-info/20">
        <span class="text-sm">❓</span>
        <span class="text-sm font-medium text-text">Agent Question</span>
        <Badge variant="info" class="ml-auto">waiting for input</Badge>
      </div>

      {/* Questions */}
      <div class="px-4 py-3 space-y-4">
        <For each={data().questions}>
          {(q, qIdx) => (
            <div class="space-y-2">
              <Show when={q.header}>
                <h4 class="text-xs font-medium text-text-muted uppercase tracking-wide">
                  {q.header}
                </h4>
              </Show>
              <p class="text-sm text-text">{q.question}</p>

              {/* Options */}
              <Show when={q.options && q.options.length > 0}>
                <div class="space-y-1.5">
                  <For each={q.options}>
                    {(opt) => {
                      const isSelected = () => answers()[qIdx()]?.includes(opt.label);
                      return (
                        <button
                          class={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                            isSelected()
                              ? 'border-accent bg-accent/10 text-text'
                              : 'border-border bg-surface hover:bg-surface-hover text-text-secondary'
                          }`}
                          onClick={() => toggleOption(qIdx(), opt.label, q.multiple || false)}
                        >
                          <div class="flex items-center gap-2">
                            <span class={`w-4 h-4 rounded-${q.multiple ? 'sm' : 'full'} border flex items-center justify-center flex-shrink-0 ${
                              isSelected()
                                ? 'border-accent bg-accent text-white'
                                : 'border-text-muted'
                            }`}>
                              <Show when={isSelected()}>
                                <svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                                </svg>
                              </Show>
                            </span>
                            <div>
                              <span class="font-medium">{opt.label}</span>
                              <Show when={opt.description}>
                                <p class="text-xs text-text-muted mt-0.5">{opt.description}</p>
                              </Show>
                            </div>
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>

              {/* Free text input (when no options or as additional input) */}
              <Show when={!q.options || q.options.length === 0}>
                <input
                  type="text"
                  class="w-full px-3 py-2 text-sm bg-surface border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                  placeholder="Type your answer..."
                  value={customInputs()[qIdx()] || ''}
                  onInput={(e) => setCustomInput(qIdx(), e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit()) handleSubmit();
                  }}
                />
              </Show>
            </div>
          )}
        </For>

        {/* Submit */}
        <div class="flex justify-end pt-1">
          <button
            class={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              canSubmit()
                ? 'bg-accent text-white hover:bg-accent/90'
                : 'bg-surface-2 text-text-muted cursor-not-allowed'
            }`}
            disabled={!canSubmit()}
            onClick={handleSubmit}
          >
            Submit Answer{data().questions.length > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
