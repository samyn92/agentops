// DiffCard — edit results with rich unified diff view (line numbers, hunk headers, collapsible)
import { createSignal, Show, For, createMemo } from 'solid-js';
import { Collapsible } from '@ark-ui/solid/collapsible';
import Badge from '../shared/Badge';
import type { ToolMetadata } from '../../types';

interface DiffCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** Parse diff output with line number tracking and hunk header detection */
function parseDiffOutput(output: string): { lines: DiffLine[]; added: number; removed: number } {
  if (!output) return { lines: [], added: 0, removed: 0 };

  const rawLines = output.split('\n');
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let oldLine = 1;
  let newLine = 1;

  for (const raw of rawLines) {
    // Detect hunk headers: @@ -start,count +start,count @@
    const hunkMatch = raw.match(/^@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@(.*)?$/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      lines.push({ type: 'header', content: raw });
      continue;
    }

    if (raw.startsWith('+')) {
      added++;
      lines.push({ type: 'add', content: raw.slice(1), newLineNo: newLine++ });
    } else if (raw.startsWith('-')) {
      removed++;
      lines.push({ type: 'remove', content: raw.slice(1), oldLineNo: oldLine++ });
    } else {
      // Context line (may start with space)
      const content = raw.startsWith(' ') ? raw.slice(1) : raw;
      lines.push({
        type: 'context',
        content,
        oldLineNo: oldLine++,
        newLineNo: newLine++,
      });
    }
  }

  return { lines, added, removed };
}

export default function DiffCard(props: DiffCardProps) {
  const [expanded, setExpanded] = createSignal(true);

  const filePath = () => {
    if (props.metadata?.filePath) return props.metadata.filePath as string;
    try {
      const parsed = JSON.parse(props.input);
      return parsed.filePath || parsed.file_path || '';
    } catch {
      return '';
    }
  };

  const diff = createMemo(() => parseDiffOutput(props.output));
  const hasLineNumbers = createMemo(() =>
    diff().lines.some((l) => l.oldLineNo !== undefined || l.newLineNo !== undefined),
  );

  // Content body — shared between headerless and full modes
  const Body = () => (
    <Collapsible.Root
      open={expanded()}
      onOpenChange={(details) => setExpanded(details.open)}
    >
      <Show when={diff().lines.length > 0}>
        <Collapsible.Content class="overflow-hidden">
          <div class="bg-surface max-h-[400px] overflow-y-auto overflow-x-auto">
            <table class="w-full text-[11px] font-mono border-collapse leading-[18px]">
              <tbody>
                <For each={diff().lines}>
                  {(line) => (
                    <Show
                      when={line.type !== 'header'}
                      fallback={
                        <tr class="bg-surface-2/50">
                          <td
                            colspan={hasLineNumbers() ? 3 : 2}
                            class="px-2 py-0 text-text-muted/60 text-[10px] select-none"
                          >
                            {line.content}
                          </td>
                        </tr>
                      }
                    >
                      <tr
                        class={
                          line.type === 'add'
                            ? 'bg-success/8'
                            : line.type === 'remove'
                            ? 'bg-error/8'
                            : ''
                        }
                      >
                        {/* Line numbers */}
                        <Show when={hasLineNumbers()}>
                          <td class="w-[1px] px-1 py-0 text-right text-text-muted/40 select-none whitespace-nowrap border-r border-border-subtle tabular-nums">
                            {line.oldLineNo ?? ''}
                          </td>
                          <td class="w-[1px] px-1 py-0 text-right text-text-muted/40 select-none whitespace-nowrap border-r border-border-subtle tabular-nums">
                            {line.newLineNo ?? ''}
                          </td>
                        </Show>
                        <td class="px-1.5 py-0 whitespace-pre-wrap break-all">
                          <span
                            class={
                              line.type === 'add'
                                ? 'text-success'
                                : line.type === 'remove'
                                ? 'text-error'
                                : 'text-text-secondary'
                            }
                          >
                            <span class="select-none text-text-muted/40 mr-1">
                              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                            </span>
                            {line.content}
                          </span>
                        </td>
                      </tr>
                    </Show>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Collapsible.Content>

        <Show when={!expanded()}>
          {/* Collapsed preview: show first few diff lines */}
          <div class="bg-surface-2/30">
            <For each={diff().lines.filter((l) => l.type !== 'header').slice(0, 4)}>
              {(line) => (
                <div
                  class={`px-2 py-0 font-mono text-[11px] leading-[18px] whitespace-pre truncate ${
                    line.type === 'add'
                      ? 'bg-success/8 text-success'
                      : line.type === 'remove'
                      ? 'bg-error/8 text-error'
                      : 'text-text-secondary'
                  }`}
                >
                  <span class="select-none text-text-muted/40 mr-1">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  {line.content}
                </div>
              )}
            </For>
            <Collapsible.Trigger
              class="w-full px-3 py-1 text-xs text-accent hover:bg-surface-hover text-left"
            >
              Show full diff ({diff().lines.length} lines)
            </Collapsible.Trigger>
          </div>
        </Show>
      </Show>
    </Collapsible.Root>
  );

  if (props.headerless) {
    return <div class={props.class || ''}><Body /></div>;
  }

  return (
    <div class={`border border-border rounded-lg overflow-hidden my-1 ${props.class || ''}`}>
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-border-subtle">
        <span class="text-xs font-medium text-[#E8A838]">Edit</span>
        <span class="text-xs text-text-secondary truncate">{filePath()}</span>
        <div class="flex items-center gap-1.5 ml-auto">
          <Show when={diff().added > 0}>
            <span class="text-xs text-success font-mono">+{diff().added}</span>
          </Show>
          <Show when={diff().removed > 0}>
            <span class="text-xs text-error font-mono">-{diff().removed}</span>
          </Show>
          <Badge variant={props.isError ? 'error' : 'success'}>
            {props.isError ? 'failed' : 'applied'}
          </Badge>
        </div>
      </div>

      <Body />
    </div>
  );
}
