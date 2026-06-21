// GenericCard — fallback tool result renderer.
// Detects JSON output and renders via JsonTreeViewer (collapsible tree);
// falls back to monospace <pre> for plain text.
import { createSignal, Show } from 'solid-js';
import Badge from '../shared/Badge';
import JsonTreeViewer from './JsonTreeViewer';

interface GenericCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

/** Try to detect if output is valid JSON */
function isJsonOutput(output: string): boolean {
  const trimmed = output.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(output);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export default function GenericCard(props: GenericCardProps) {
  const [expanded, setExpanded] = createSignal(false);
  const isJson = () => !!props.output && isJsonOutput(props.output);

  const truncatedOutput = () => {
    if (!props.output) return '';
    if (props.output.length <= 500 || expanded()) return props.output;
    return props.output.slice(0, 500) + '...';
  };

  const formattedInput = () => {
    try {
      return JSON.stringify(JSON.parse(props.input), null, 2);
    } catch {
      return props.input;
    }
  };

  // Content body — shared between headerless and full modes
  const Body = () => (
    <div class={isJson() ? '' : 'px-3 py-2 bg-surface'}>
      <Show when={props.output}>
        <Show
          when={isJson()}
          fallback={
            <>
              <pre class="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all overflow-hidden max-h-[300px] overflow-y-auto">
                {truncatedOutput()}
              </pre>
              <Show when={props.output.length > 500 && !expanded()}>
                <button
                  class="text-xs text-accent hover:underline mt-1"
                  onClick={() => setExpanded(true)}
                >
                  Show all ({props.output.length} chars)
                </button>
              </Show>
            </>
          }
        >
          <JsonTreeViewer
            data={props.output}
            initialDepth={2}
            maxHeight={500}
          />
        </Show>
      </Show>
      <Show when={!props.output}>
        <span class="text-xs text-text-muted italic px-3 py-2">No output</span>
      </Show>
    </div>
  );

  if (props.headerless) {
    return <div class={props.class || ''}><Body /></div>;
  }

  return (
    <div class={`border border-border rounded-lg overflow-hidden my-1 ${props.class || ''}`}>
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-border-subtle">
        <span class="text-xs font-medium text-text-secondary">{props.toolName}</span>
        <Badge variant={props.isError ? 'error' : 'success'} class="ml-auto">
          {props.isError ? 'error' : 'done'}
        </Badge>
      </div>

      <Body />
    </div>
  );
}
