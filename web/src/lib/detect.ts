// Detection utilities — language detection and tool categorization

// ---- Language detection ----

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript',
  go: 'go', py: 'python', rs: 'rust', rb: 'ruby', java: 'java',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c',
  cs: 'csharp', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  yaml: 'yaml', yml: 'yaml', json: 'json', jsonc: 'json',
  toml: 'toml', ini: 'ini', cfg: 'ini',
  md: 'markdown', mdx: 'markdown',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  ps1: 'powershell',
  dockerfile: 'dockerfile', makefile: 'makefile',
  tf: 'hcl', hcl: 'hcl',
  proto: 'protobuf',
  graphql: 'graphql', gql: 'graphql',
  lua: 'lua', r: 'r', dart: 'dart', zig: 'zig', nim: 'nim',
  vue: 'html', svelte: 'html', astro: 'html',
};

/** Detect programming language from a file path extension */
export function detectLanguage(filePath: string): string {
  // Handle special filenames without extensions
  const filename = filePath.split('/').pop()?.toLowerCase() || '';
  if (filename === 'dockerfile') return 'dockerfile';
  if (filename === 'makefile' || filename === 'gnumakefile') return 'makefile';
  if (filename === '.gitignore' || filename === '.dockerignore') return 'bash';
  if (filename === 'cmakelists.txt') return 'cmake';

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MAP[ext] || '';
}

// ---- Tool categorization ----

export interface ToolStyle {
  label: string;
  color: string;
  icon: string;
}

const TOOL_STYLES: Record<string, ToolStyle> = {
  bash:      { label: 'Terminal',    color: 'text-[#4EAA25]', icon: 'terminal' },
  read:      { label: 'Read File',   color: 'text-[#E8A838]', icon: 'file' },
  edit:      { label: 'Edit File',   color: 'text-[#E8A838]', icon: 'file' },
  write:     { label: 'Write File',  color: 'text-[#E8A838]', icon: 'file' },
  glob:      { label: 'Find Files',  color: 'text-[#4285F4]', icon: 'search' },
  ls:        { label: 'List Files',  color: 'text-[#4285F4]', icon: 'search' },
  grep:      { label: 'Search',      color: 'text-[#4285F4]', icon: 'search' },
  fetch:     { label: 'Web Fetch',   color: 'text-info',      icon: 'web' },
  run_agent: { label: 'Run Agent',   color: 'text-accent',    icon: 'agent' },
  get_agent_run: { label: 'Agent Run', color: 'text-accent',  icon: 'agent' },
};

/** Get the display style for a tool name */
export function getToolStyle(toolName: string): ToolStyle {
  return TOOL_STYLES[toolName] || { label: toolName, color: 'text-text-secondary', icon: 'generic' };
}

type ToolCategory = 'file' | 'terminal' | 'search' | 'web' | 'agent' | 'generic';

function getToolCategory(toolName: string): ToolCategory {
  if (['read', 'edit', 'write'].includes(toolName)) return 'file';
  if (toolName === 'bash') return 'terminal';
  if (['glob', 'ls', 'grep'].includes(toolName)) return 'search';
  if (toolName === 'fetch') return 'web';
  if (['run_agent', 'get_agent_run'].includes(toolName)) return 'agent';
  return 'generic';
}

/** Get a tool icon emoji (used in PermissionDialog, etc.) */
export function getToolIcon(toolName: string): string {
  const category = getToolCategory(toolName);
  switch (category) {
    case 'terminal': return '\u2699\uFE0F'; // gear
    case 'file': return toolName === 'read' ? '\uD83D\uDCC4' : '\u270F\uFE0F'; // page / pencil
    case 'search': return '\uD83D\uDD0D'; // magnifying glass
    case 'web': return '\uD83C\uDF10'; // globe
    case 'agent': return '\uD83E\uDD16'; // robot
    default: return '\uD83D\uDD27'; // wrench
  }
}

/** Try to extract meaningful preview from partial JSON args (for ToolCallCard composing state) */
export function parsePartialArgs(
  toolName: string,
  args: string,
): { key: string; value: string } | null {
  if (!args) return null;

  if (toolName === 'bash') {
    const cmdMatch = args.match(/"command"\s*:\s*"([^"]*)/);
    if (cmdMatch) return { key: 'command', value: cmdMatch[1] };
  }

  if (['read', 'edit', 'write'].includes(toolName)) {
    const pathMatch = args.match(/"(?:filePath|file_path|path)"\s*:\s*"([^"]*)/);
    if (pathMatch) return { key: 'path', value: pathMatch[1] };
  }

  if (toolName === 'glob') {
    const patMatch = args.match(/"pattern"\s*:\s*"([^"]*)/);
    if (patMatch) return { key: 'pattern', value: patMatch[1] };
  }

  if (toolName === 'grep') {
    const patMatch = args.match(/"pattern"\s*:\s*"([^"]*)/);
    if (patMatch) return { key: 'pattern', value: patMatch[1] };
  }

  if (toolName === 'fetch') {
    const urlMatch = args.match(/"url"\s*:\s*"([^"]*)/);
    if (urlMatch) return { key: 'url', value: urlMatch[1] };
  }

  if (toolName === 'run_agent') {
    const promptMatch = args.match(/"prompt"\s*:\s*"([^"]*)/);
    if (promptMatch) return { key: 'prompt', value: promptMatch[1] };
    const agentMatch = args.match(/"agent"\s*:\s*"([^"]*)/);
    if (agentMatch) return { key: 'agent', value: agentMatch[1] };
  }

  return null;
}

/** Extract agent name from partial run_agent args */
export function parseAgentName(args: string): string | null {
  if (!args) return null;
  const match = args.match(/"agent"\s*:\s*"([^"]*)/);
  return match ? match[1] : null;
}
