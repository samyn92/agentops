// JsonTreeViewer — Clean, minimal interactive JSON tree with collapsible nodes
// and syntax highlighting. No toolbar clutter — just the data.
import { createSignal, createMemo, For, Show } from 'solid-js';

// ── Types ──

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface JsonTreeViewerProps {
  /** Raw JSON string or pre-parsed object */
  data: string | JsonValue;
  /** Maximum initial depth to auto-expand (default: 2) */
  initialDepth?: number;
  /** Max height before scroll (default: 500px) */
  maxHeight?: number;
  /** Optional class */
  class?: string;
}

interface NodeProps {
  keyName: string | null;
  value: JsonValue;
  depth: number;
  isLast: boolean;
  initialDepth: number;
}

// ── Helpers ──

function typeOf(v: JsonValue): 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as 'string' | 'number' | 'boolean' | 'object';
}

function typeColor(t: ReturnType<typeof typeOf>): string {
  switch (t) {
    case 'string':  return 'text-[#0a3069] dark:text-[#a5d6ff]';
    case 'number':  return 'text-[#0550ae] dark:text-[#79c0ff]';
    case 'boolean': return 'text-[#cf222e] dark:text-[#ff7b72]';
    case 'null':    return 'text-text-muted italic';
    case 'array':   return 'text-[#8250df] dark:text-[#d2a8ff]';
    case 'object':  return 'text-[#953800] dark:text-[#ffa657]';
  }
}

/** Count items in an object or array */
function itemCount(v: JsonValue): number {
  if (Array.isArray(v)) return v.length;
  if (v !== null && typeof v === 'object') return Object.keys(v).length;
  return 0;
}

/** Format a string value for display — truncate long strings */
function formatStringValue(s: string, maxLen = 120): string {
  if (s.length <= maxLen) return JSON.stringify(s);
  return JSON.stringify(s.slice(0, maxLen)) + `...`;
}

// ── Node Component ──

function JsonNode(props: NodeProps) {
  const t = () => typeOf(props.value);
  const isContainer = () => t() === 'object' || t() === 'array';
  const defaultExpanded = () => props.depth < props.initialDepth;
  const [expanded, setExpanded] = createSignal(defaultExpanded());

  // ── Leaf node ──
  if (!isContainer()) {
    return (
      <div
        class="flex items-start gap-0 py-[0.5px] leading-[20px]"
        style={{ "padding-left": `${props.depth * 14 + 6}px` }}
      >
        <Show when={props.keyName !== null}>
          <span class="text-text-secondary select-none">{props.keyName}</span>
          <span class="text-text-muted select-none mx-[3px]">:</span>
        </Show>

        <span class={typeColor(t())}>
          <Show when={t() === 'string'}>{formatStringValue(props.value as string)}</Show>
          <Show when={t() === 'number' || t() === 'boolean'}>{String(props.value)}</Show>
          <Show when={t() === 'null'}>null</Show>
        </span>

        <Show when={!props.isLast}>
          <span class="text-text-muted/50 select-none">,</span>
        </Show>
      </div>
    );
  }

  // ── Container node ──
  const entries = createMemo(() => {
    if (Array.isArray(props.value)) {
      const arr = props.value as JsonValue[];
      return arr.map((v, i) => ({
        key: String(i),
        value: v,
        isLast: i === arr.length - 1,
      }));
    }
    const obj = props.value as Record<string, JsonValue>;
    const keys = Object.keys(obj);
    return keys.map((k, i) => ({
      key: k,
      value: obj[k],
      isLast: i === keys.length - 1,
    }));
  });

  const openBracket = () => t() === 'array' ? '[' : '{';
  const closeBracket = () => t() === 'array' ? ']' : '}';
  const count = () => itemCount(props.value);

  return (
    <div>
      {/* Header line */}
      <div
        class="flex items-center gap-0 py-[0.5px] leading-[20px] cursor-pointer select-none hover:bg-surface-hover/30 rounded-sm transition-colors"
        style={{ "padding-left": `${props.depth * 14}px` }}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Chevron */}
        <span class={`shrink-0 w-[14px] h-[14px] flex items-center justify-center transition-transform duration-100 text-text-muted/60 ${expanded() ? 'rotate-90' : ''}`}>
          <svg class="w-[8px] h-[8px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7" />
          </svg>
        </span>

        <Show when={props.keyName !== null}>
          <span class="text-text-secondary">{props.keyName}</span>
          <span class="text-text-muted mx-[3px]">:</span>
        </Show>

        <span class="text-text-muted/70">{openBracket()}</span>

        {/* Collapsed preview */}
        <Show when={!expanded()}>
          <span class="text-text-muted/40 mx-1 text-[10px]">
            {count()} {count() === 1 ? 'item' : 'items'}
          </span>
          <span class="text-text-muted/70">{closeBracket()}</span>
          <Show when={!props.isLast}>
            <span class="text-text-muted/50">,</span>
          </Show>
        </Show>
      </div>

      {/* Children */}
      <Show when={expanded()}>
        <For each={entries()}>
          {(entry) => (
            <JsonNode
              keyName={t() === 'array' ? null : entry.key}
              value={entry.value}
              depth={props.depth + 1}
              isLast={entry.isLast}
              initialDepth={props.initialDepth}
            />
          )}
        </For>

        {/* Closing bracket */}
        <div
          class="text-text-muted/70 py-[0.5px] leading-[20px]"
          style={{ "padding-left": `${props.depth * 14 + 6}px` }}
        >
          {closeBracket()}
          <Show when={!props.isLast}>
            <span class="text-text-muted/50">,</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── Main Component ──

export default function JsonTreeViewer(props: JsonTreeViewerProps) {
  const parsed = createMemo<{ ok: true; data: JsonValue } | { ok: false; error: string }>(() => {
    if (typeof props.data !== 'string') return { ok: true, data: props.data };
    try {
      return { ok: true, data: JSON.parse(props.data) };
    } catch (e: any) {
      return { ok: false, error: e.message || 'Invalid JSON' };
    }
  });

  const rawString = createMemo(() => {
    if (typeof props.data === 'string') return props.data;
    return JSON.stringify(props.data, null, 2);
  });

  const initialDepth = () => props.initialDepth ?? 2;
  const maxHeight = () => props.maxHeight ?? 500;

  return (
    <div class={props.class || ''}>
      <div
        class="overflow-auto font-mono text-xs px-3 py-1.5"
        style={{ "max-height": `${maxHeight()}px` }}
      >
        <Show
          when={parsed().ok}
          fallback={
            <div class="px-3 py-2">
              <span class="text-error text-xs">Parse error: {(parsed() as { ok: false; error: string }).error}</span>
              <pre class="mt-2 text-text-secondary whitespace-pre-wrap break-all">{rawString()}</pre>
            </div>
          }
        >
          <JsonNode
            keyName={null}
            value={(parsed() as { ok: true; data: JsonValue }).data}
            depth={0}
            isLast={true}
            initialDepth={initialDepth()}
          />
        </Show>
      </div>
    </div>
  );
}
