// FileTreeCard — glob results (interactive file tree)
import { createSignal, For, Show, createMemo } from 'solid-js';
import Badge from '../shared/Badge';
import type { ToolMetadata } from '../../types';

interface FileTreeCardProps {
  toolName: string;
  input: string;
  output: string;
  isError: boolean;
  metadata?: ToolMetadata;
  class?: string;
  /** When true, skip the outer wrapper border/rounded/margin and the header row */
  headerless?: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

const FILE_ICONS: Record<string, string> = {
  ts: '🔷', tsx: '🔷', js: '🟡', jsx: '🟡',
  go: '🔵', py: '🐍', rs: '🦀', rb: '💎',
  json: '📋', yaml: '📋', yml: '📋', toml: '📋',
  md: '📝', html: '🌐', css: '🎨', scss: '🎨',
  sh: '⚙️', bash: '⚙️', dockerfile: '🐳',
  mod: '📦', sum: '📦', lock: '🔒',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const base = name.toLowerCase();
  if (base === 'dockerfile') return '🐳';
  if (base === 'makefile') return '⚙️';
  return FILE_ICONS[ext] || '📄';
}

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const file of files) {
    const parts = file.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const existingChild = current.children.find((c) => c.name === part);

      if (existingChild) {
        current = existingChild;
      } else {
        const node: TreeNode = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          children: [],
        };
        current.children.push(node);
        current = node;
      }
    }
  }

  // Sort: directories first, then alphabetical
  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortTree(node.children);
    }
  }
  sortTree(root.children);

  return root.children;
}

function TreeItem(props: { node: TreeNode; depth: number }) {
  const [open, setOpen] = createSignal(props.depth < 2);

  return (
    <div>
      <div
        class={`flex items-center gap-1.5 py-0.5 hover:bg-surface-hover rounded-sm cursor-default text-xs font-mono ${
          props.node.isDir ? 'text-text' : 'text-text-secondary'
        }`}
        style={{ 'padding-left': `${props.depth * 16 + 8}px` }}
        onClick={() => props.node.isDir && setOpen(!open())}
      >
        <Show when={props.node.isDir}>
          <span class="text-text-muted w-3 text-center select-none">
            {open() ? '▾' : '▸'}
          </span>
          <span class="select-none">📁</span>
        </Show>
        <Show when={!props.node.isDir}>
          <span class="w-3" />
          <span class="select-none">{getFileIcon(props.node.name)}</span>
        </Show>
        <span class="truncate">{props.node.name}</span>
      </div>
      <Show when={props.node.isDir && open()}>
        <For each={props.node.children}>
          {(child) => <TreeItem node={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  );
}

export default function FileTreeCard(props: FileTreeCardProps) {
  const pattern = () => {
    if (props.metadata?.pattern) return props.metadata.pattern as string;
    try {
      const parsed = JSON.parse(props.input);
      return parsed.pattern || '';
    } catch {
      return '';
    }
  };

  const files = createMemo(() => {
    // metadata.files is authoritative if present
    if (props.metadata?.files && Array.isArray(props.metadata.files)) {
      return props.metadata.files as string[];
    }
    // Fall back to parsing output (one file per line)
    if (!props.output) return [];
    return props.output.split('\n').filter((l) => l.trim());
  });

  const fileCount = () =>
    (props.metadata?.count as number) || files().length;

  const tree = createMemo(() => buildTree(files()));

  // Content body — shared between headerless and full modes
  const Body = () => (
    <div class="bg-surface max-h-[400px] overflow-y-auto py-1">
      <Show when={tree().length > 0} fallback={
        <p class="text-xs text-text-muted px-3 py-2 italic">No files matched</p>
      }>
        <For each={tree()}>
          {(node) => <TreeItem node={node} depth={0} />}
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
        <span class="text-xs font-medium text-[#4285F4]">Glob</span>
        <Show when={pattern()}>
          <code class="text-xs text-text-secondary font-mono truncate">{pattern()}</code>
        </Show>
        <div class="flex items-center gap-1.5 ml-auto">
          <span class="text-xs text-text-muted">{fileCount()} files</span>
          <Badge variant={props.isError ? 'error' : 'success'}>
            {props.isError ? 'error' : 'done'}
          </Badge>
        </div>
      </div>

      <Body />
    </div>
  );
}
