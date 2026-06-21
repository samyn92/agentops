// SourceReference — citation/source link from the model
import { Show } from 'solid-js';

interface SourceReferenceProps {
  sourceType: 'url' | 'document';
  url: string;
  title: string;
  class?: string;
}

export default function SourceReference(props: SourceReferenceProps) {
  const displayUrl = () => {
    try {
      const u = new URL(props.url);
      return u.hostname + (u.pathname === '/' ? '' : u.pathname);
    } catch {
      return props.url;
    }
  };

  const isUrl = () => props.sourceType === 'url' && props.url;

  return (
    <div class={`inline-flex items-center gap-1.5 px-2 py-1 bg-surface-2 border border-border-subtle rounded-md text-xs my-0.5 ${props.class || ''}`}>
      {/* Icon */}
      <Show
        when={isUrl()}
        fallback={
          <svg class="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        }
      >
        <svg class="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </Show>

      {/* Content */}
      <Show
        when={isUrl()}
        fallback={
          <span class="text-text-secondary truncate max-w-[300px]">
            {props.title || 'Document'}
          </span>
        }
      >
        <a
          href={props.url}
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent hover:underline truncate max-w-[300px]"
          title={props.url}
        >
          {props.title || displayUrl()}
        </a>
      </Show>
    </div>
  );
}
