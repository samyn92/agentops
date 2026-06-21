// SearchResultsCard — grep results (matches with file grouping and line highlights)
import { createSignal, For, Show, createMemo } from 'solid-js';
import { Collapsible } from '@ark-ui/solid/collapsible';
import Badge from '../shared/Badge';
import type { ToolMetadata } from '../../types';

interface SearchResultsCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

interface MatchGroup {
  file: string;
  matches: Array<{ line: number; text: string }>;
}

function parseGrepOutput(output: string): MatchGroup[] {
  if (!output) return [];
  const groups: Map<string, Array<{ line: number; text: string }>> = new Map();

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;

    // Try to match file:line:content pattern
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (match) {
      const [, file, lineNum, text] = match;
      if (!groups.has(file)) groups.set(file, []);
      groups.get(file)!.push({ line: parseInt(lineNum, 10), text });
    } else {
      // Also handle file:line format without content
      const simpleMatch = line.match(/^(.+?):(\d+)$/);
      if (simpleMatch) {
        const [, file, lineNum] = simpleMatch;
        if (!groups.has(file)) groups.set(file, []);
        groups.get(file)!.push({ line: parseInt(lineNum, 10), text: '' });
      }
    }
  }

  return Array.from(groups.entries()).map(([file, matches]) => ({
    file,
    matches: matches.sort((a, b) => a.line - b.line),
  }));
}

function FileGroup(props: { group: MatchGroup }) {
  const [expanded, setExpanded] = createSignal(true);

  return (
    <Collapsible.Root
      open={expanded()}
      onOpenChange={(details) => setExpanded(details.open)}
      class="border-b border-border-subtle last:border-b-0"
    >
      <Collapsible.Trigger
        class="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-surface-hover transition-colors"
      >
        <Collapsible.Indicator>
          <span class="text-text-muted text-xs select-none w-3 inline-block transition-transform data-[state=open]:rotate-0 data-[state=closed]:-rotate-90">
            ▾
          </span>
        </Collapsible.Indicator>
        <span class="text-xs font-mono text-text-secondary truncate flex-1">
          {props.group.file}
        </span>
        <span class="text-xs text-text-muted">
          {props.group.matches.length} match{props.group.matches.length !== 1 ? 'es' : ''}
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content class="overflow-hidden">
        <div class="pl-3 pr-3 pb-1">
          <For each={props.group.matches}>
            {(m) => (
              <div class="flex gap-2 py-0.5 text-xs font-mono">
                <span class="text-text-muted select-none w-8 text-right flex-shrink-0">
                  {m.line}
                </span>
                <span class="text-text-secondary truncate">{m.text}</span>
              </div>
            )}
          </For>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export default function SearchResultsCard(props: SearchResultsCardProps) {
  const pattern = () => {
    if (props.metadata?.pattern) return props.metadata.pattern as string;
    try {
      const parsed = JSON.parse(props.input);
      return parsed.pattern || '';
    } catch {
      return '';
    }
  };

  const include = () => {
    try {
      const parsed = JSON.parse(props.input);
      return (parsed.include as string) || '';
    } catch {
      return '';
    }
  };

  const groups = createMemo(() => {
    // If metadata has structured matches, use them
    if (props.metadata?.matches && Array.isArray(props.metadata.matches)) {
      // Structured format from runtime
      return (props.metadata.matches as MatchGroup[]);
    }
    return parseGrepOutput(props.output);
  });

  const matchCount = () =>
    (props.metadata?.count as number) ||
    groups().reduce((sum, g) => sum + g.matches.length, 0);

  // Content body — shared between headerless and full modes
  const Body = () => (
    <div class="bg-surface max-h-[400px] overflow-y-auto">
      <Show when={groups().length > 0} fallback={
        <p class="text-xs text-text-muted px-3 py-2 italic">No matches found</p>
      }>
        <For each={groups()}>
          {(group) => <FileGroup group={group} />}
        </For>
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
        <span class="text-xs font-medium text-[#4285F4]">Search</span>
        <code class="text-xs text-text-secondary font-mono truncate">{pattern()}</code>
        <Show when={include()}>
          <span class="text-xs text-text-muted">in {include()}</span>
        </Show>
        <div class="flex items-center gap-1.5 ml-auto">
          <span class="text-xs text-text-muted">
            {matchCount()} match{matchCount() !== 1 ? 'es' : ''} in {groups().length} file{groups().length !== 1 ? 's' : ''}
          </span>
          <Badge variant={props.isError ? 'error' : 'success'}>
            {props.isError ? 'error' : 'done'}
          </Badge>
        </div>
      </div>

      <Body />
    </div>
  );
}
