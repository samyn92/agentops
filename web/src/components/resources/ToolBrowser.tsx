// ToolBrowser — popover for browsing AgentTool CRs available in the cluster
import { createResource, createSignal, For, Show } from 'solid-js';
import { agentTools } from '../../lib/api';
import { selectedAgent } from '../../stores/agents';
import type { AgentToolResponse, AgentToolSourceType } from '../../types';
import Badge from '../shared/Badge';
import Spinner from '../shared/Spinner';

interface ToolBrowserProps {
  /** When true, the popover is visible */
  open: boolean;
  /** Called when the user wants to close the popover */
  onClose: () => void;
  /** Optional: CSS class for the root element */
  class?: string;
  /** When true, skip rendering backdrop and header (parent panel handles those) */
  embedded?: boolean;
}

function sourceTypeLabel(sourceType: AgentToolSourceType | string | undefined): string {
  switch (sourceType) {
    case 'oci': return 'OCI';
    case 'configMap': return 'ConfigMap';
    case 'inline': return 'Inline';
    case 'mcpServer': return 'MCP Server';
    case 'mcpEndpoint': return 'MCP Endpoint';
    case 'skill': return 'Skill';
    default: return sourceType || 'Unknown';
  }
}

function sourceTypeBadgeVariant(sourceType: string | undefined): 'info' | 'muted' | 'warning' | 'success' {
  switch (sourceType) {
    case 'oci': return 'info';
    case 'mcpServer':
    case 'mcpEndpoint': return 'success';
    case 'skill': return 'warning';
    default: return 'muted';
  }
}

export default function ToolBrowser(props: ToolBrowserProps) {
  const [toolList] = createResource(
    () => props.open,
    async (isOpen) => {
      if (!isOpen) return [];
      const agent = selectedAgent();
      if (!agent) return [];
      return agentTools.list();
    }
  );

  const [collapsedTools, setCollapsedTools] = createSignal<Set<string>>(new Set());

  function toggleExpand(name: string) {
    setCollapsedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function phaseVariant(phase: string | undefined): 'success' | 'warning' | 'error' | 'muted' {
    switch (phase) {
      case 'Ready':
        return 'success';
      case 'Pending':
      case 'Deploying':
        return 'warning';
      case 'Failed':
        return 'error';
      default:
        return 'muted';
    }
  }

  return (
    <Show when={props.open}>
      {/* Backdrop — skip in embedded mode */}
      <Show when={!props.embedded}>
        <div class="fixed inset-0 z-40" onClick={() => props.onClose()} />
      </Show>

      {/* Popover panel */}
      <div
        class={`${props.embedded ? '' : 'absolute z-50'} bg-surface ${props.embedded ? '' : 'w-80 max-h-96 border border-border rounded-xl shadow-lg'} overflow-hidden ${props.class || ''}`}
        style={props.embedded ? { width: '100%', height: '100%' } : {}}
      >
        {/* Header — skip in embedded mode */}
        <Show when={!props.embedded}>
        <div class="flex items-center justify-between px-3 py-2 border-b border-border">
          <span class="text-xs font-semibold text-text uppercase tracking-wide">
            Tools
          </span>
          <button
            class="p-1 text-text-muted hover:text-text rounded transition-colors"
            onClick={() => props.onClose()}
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        </Show>

        {/* Content */}
        <div class={`overflow-y-auto ${props.embedded ? 'h-full' : 'max-h-80'}`}>
          <Show when={toolList.loading}>
            <div class="flex items-center justify-center py-6">
              <Spinner size="sm" />
            </div>
          </Show>

          <Show when={!toolList.loading}>
            <Show
              when={(toolList() || []).length > 0}
              fallback={
                <div class="px-3 py-6 text-center">
                  <p class="text-xs text-text-muted">No agent tools found.</p>
                </div>
              }
            >
              <div class="divide-y divide-border-subtle">
                <For each={toolList()}>
                  {(tool: AgentToolResponse) => {
                    const isExpanded = () => !collapsedTools().has(tool.metadata.name);
                    const srcType = () => tool.status?.sourceType;

                    return (
                      <div>
                        {/* Tool row */}
                        <button
                          class="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors flex items-center gap-2"
                          onClick={() => toggleExpand(tool.metadata.name)}
                        >
                          {/* Expand chevron */}
                          <svg
                            class={`w-3 h-3 text-text-muted transition-transform ${isExpanded() ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>

                          <span class="text-xs font-mono text-text truncate flex-1">
                            {tool.metadata.name}
                          </span>

                          <Badge variant={sourceTypeBadgeVariant(srcType())}>
                            {sourceTypeLabel(srcType())}
                          </Badge>

                          <Badge variant={phaseVariant(tool.status?.phase)}>
                            {tool.status?.phase || '?'}
                          </Badge>
                        </button>

                        {/* Expanded detail */}
                        <Show when={isExpanded()}>
                          <div class="px-3 pb-2 pl-8 space-y-1.5">
                            <Show when={tool.spec.description}>
                              <p class="text-[10px] text-text-secondary">{tool.spec.description}</p>
                            </Show>

                            <Show when={tool.spec.category}>
                              <div class="flex items-center gap-1 text-[10px] text-text-muted">
                                <span>Category:</span>
                                <span class="text-text-secondary font-medium">{tool.spec.category}</span>
                              </div>
                            </Show>

                            {/* Source-specific details */}
                            <Show when={tool.spec.oci}>
                              <div class="text-[10px] text-text-muted truncate">
                                OCI: {tool.spec.oci!.ref}
                              </div>
                            </Show>
                            <Show when={tool.spec.mcpServer}>
                              <div class="text-[10px] text-text-muted truncate">
                                Image: {tool.spec.mcpServer!.image}
                              </div>
                            </Show>
                            <Show when={tool.spec.mcpEndpoint}>
                              <div class="text-[10px] text-text-muted truncate">
                                URL: {tool.spec.mcpEndpoint!.url}
                              </div>
                            </Show>
                            <Show when={tool.spec.configMap}>
                              <div class="text-[10px] text-text-muted truncate">
                                ConfigMap: {tool.spec.configMap!.name}/{tool.spec.configMap!.key}
                              </div>
                            </Show>
                            <Show when={tool.spec.skill}>
                              <div class="text-[10px] text-text-muted truncate">
                                Skill: {tool.spec.skill!.ref}
                              </div>
                            </Show>
                            <Show when={tool.spec.inline}>
                              <div class="text-[10px] text-text-muted">
                                Inline ({tool.spec.inline!.content.length} chars)
                              </div>
                            </Show>

                            <Show when={tool.status?.serviceURL}>
                              <div class="text-[10px] text-text-muted truncate">
                                Service: {tool.status!.serviceURL}
                              </div>
                            </Show>

                            <div class="text-[10px] text-text-muted/60">
                              {tool.metadata.namespace}
                            </div>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  );
}
