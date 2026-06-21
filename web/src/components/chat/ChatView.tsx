// ChatView — chat orchestrator (sessions, input, messages)
import { Show } from 'solid-js';
import MessageList from './MessageList';
import Composer from './Composer';
import PermissionDialog from './PermissionDialog';
import QuestionPanel from './QuestionPanel';
import { pendingPermission, pendingQuestion } from '../../stores/chat';

// Import the setter functions we need to clear pending state
import { setPendingPermission, setPendingQuestion } from '../../stores/chat';

interface ChatViewProps {
  class?: string;
}

export default function ChatView(props: ChatViewProps) {
  return (
    <div class={`flex flex-col h-full ${props.class || ''}`}>
      <MessageList class="flex-1" />

      {/* Permission dialog overlay */}
      <Show when={pendingPermission()}>
        {(perm) => (
          <div class="px-4">
            <PermissionDialog
              permission={perm()}
              onResolve={() => setPendingPermission(null)}
            />
          </div>
        )}
      </Show>

      {/* Question panel overlay */}
      <Show when={pendingQuestion()}>
        {(q) => (
          <div class="px-4">
            <QuestionPanel
              questionData={q()}
              onResolve={() => setPendingQuestion(null)}
            />
          </div>
        )}
      </Show>

      <Composer />
    </div>
  );
}
