// TerminalCard — bash results (command, output, exit code)
import { createSignal, Show } from 'solid-js';
import Badge from '../shared/Badge';
import type { ToolMetadata } from '../../types';

interface TerminalCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row (used inside ToolCallCard) */
  headerless?: boolean;
}

const MAX_LINES = 50;

export default function TerminalCard(props: TerminalCardProps) {
  const [expanded, setExpanded] = createSignal(false);

  const command = () => {
    if (props.metadata?.command) return props.metadata.command as string;
    try {
      const parsed = JSON.parse(props.input);
      return parsed.command || '';
    } catch {
      return props.input;
    }
  };

  const exitCode = () => {
    if (props.metadata?.exitCode !== undefined) return props.metadata.exitCode as number;
    return props.isError ? 1 : 0;
  };

  const cwd = () => props.metadata?.cwd as string | undefined;
  const duration = (): string | undefined => {
    const ms = props.metadata?.duration as number | undefined;
    if (!ms) return undefined;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  const outputLines = () => props.output.split('\n');
  const isTruncated = () => outputLines().length > MAX_LINES && !expanded();

  const displayOutput = () => {
    if (isTruncated()) {
      return outputLines().slice(0, MAX_LINES).join('\n');
    }
    return props.output;
  };

  // Content body (command + output) — shared between headerless and full modes
  const Body = () => (
    <>
      {/* Command */}
      <div class="px-3 py-1.5 bg-surface border-b border-border-subtle font-mono text-sm">
        <span class="text-text-muted select-none">$ </span>
        <span class="text-text">{command()}</span>
      </div>

      {/* Output */}
      <Show when={props.output}>
        <div class="px-3 py-2 bg-surface max-h-[400px] overflow-y-auto">
          <pre class="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
            {displayOutput()}
          </pre>
          <Show when={isTruncated()}>
            <button
              class="text-xs text-accent hover:underline mt-1"
              onClick={() => setExpanded(true)}
            >
              Show all {outputLines().length} lines
            </button>
          </Show>
        </div>
      </Show>
    </>
  );

  if (props.headerless) {
    return <div class={props.class || ''}><Body /></div>;
  }

  return (
    <div class={`border border-border rounded-lg overflow-hidden my-1 ${props.class || ''}`}>
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-border-subtle">
        <span class="text-xs font-medium text-[#4EAA25]">Terminal</span>

        <Show when={cwd()}>
          <span class="text-xs text-text-muted truncate max-w-[200px]">{cwd()}</span>
        </Show>

        <div class="flex items-center gap-1.5 ml-auto">
          <Show when={duration()}>
            <span class="text-xs text-text-muted">{duration()}</span>
          </Show>
          <Badge variant={exitCode() === 0 ? 'success' : 'error'}>
            {exitCode() === 0 ? 'exit 0' : `exit ${exitCode()}`}
          </Badge>
        </div>
      </div>

      <Body />
    </div>
  );
}
