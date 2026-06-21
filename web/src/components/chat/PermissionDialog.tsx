// PermissionDialog — tool permission approval prompt
// Shown when the runtime emits a permission_asked FEP event.
import { Show } from 'solid-js';
import { control } from '../../lib/api';
import { selectedAgent } from '../../stores/agents';
import { pendingPermission } from '../../stores/chat';
import Badge from '../shared/Badge';
import { getToolIcon } from '../../lib/detect';

interface PermissionDialogProps {
  permission: {
    id: string;
    toolName: string;
    input: string;
    description: string;
  };
  onResolve: () => void;
}

export default function PermissionDialog(props: PermissionDialogProps) {
  const perm = () => props.permission;

  const formattedInput = () => {
    try {
      return JSON.stringify(JSON.parse(perm().input), null, 2);
    } catch {
      return perm().input;
    }
  };

  const toolIcon = () => getToolIcon(perm().toolName);

  async function handleReply(response: 'once' | 'always' | 'deny') {
    const agent = selectedAgent();
    if (!agent) return;

    try {
      await control.replyPermission(
        agent.namespace,
        agent.name,
        perm().id,
        response,
      );
    } catch (err) {
      console.error('Failed to reply to permission:', err);
    }
    props.onResolve();
  }

  return (
    <div class="border border-warning/40 bg-warning/5 rounded-lg overflow-hidden my-2 animate-in fade-in slide-in-from-bottom-2">
      {/* Header */}
      <div class="flex items-center gap-2 px-4 py-2.5 bg-warning/10 border-b border-warning/20">
        <span class="text-sm">{toolIcon()}</span>
        <span class="text-sm font-medium text-text">Permission Required</span>
        <Badge variant="warning" class="ml-auto">waiting</Badge>
      </div>

      {/* Description */}
      <div class="px-4 py-3 space-y-3">
        <p class="text-sm text-text-secondary">{perm().description}</p>

        {/* Tool & input details */}
        <div class="rounded-md bg-surface-2 border border-border-subtle p-3 space-y-2">
          <div class="flex items-center gap-2 text-xs">
            <span class="text-text-muted w-12">Tool</span>
            <code class="text-text font-mono">{perm().toolName}</code>
          </div>
          <Show when={perm().input}>
            <div class="text-xs">
              <span class="text-text-muted">Arguments</span>
              <pre class="mt-1 text-text-secondary font-mono whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto text-[11px]">
                {formattedInput()}
              </pre>
            </div>
          </Show>
        </div>

        {/* Action buttons */}
        <div class="flex items-center gap-2 pt-1">
          <button
            class="flex-1 px-3 py-2 text-sm font-medium rounded-md bg-success/15 text-success hover:bg-success/25 border border-success/30 transition-colors"
            onClick={() => handleReply('once')}
          >
            Allow Once
          </button>
          <button
            class="flex-1 px-3 py-2 text-sm font-medium rounded-md bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30 transition-colors"
            onClick={() => handleReply('always')}
          >
            Always Allow
          </button>
          <button
            class="flex-1 px-3 py-2 text-sm font-medium rounded-md bg-error/15 text-error hover:bg-error/25 border border-error/30 transition-colors"
            onClick={() => handleReply('deny')}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
