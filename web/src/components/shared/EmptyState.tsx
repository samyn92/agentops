// Empty state illustration component
import type { JSX } from 'solid-js';

interface EmptyStateProps {
  icon?: JSX.Element;
  title: string;
  description?: string;
  action?: JSX.Element;
  class?: string;
}

export default function EmptyState(props: EmptyStateProps) {
  return (
    <div class={`flex flex-col items-center justify-center py-12 px-4 text-center ${props.class || ''}`}>
      {props.icon && (
        <div class="mb-4 text-text-muted opacity-50">
          {props.icon}
        </div>
      )}
      <h3 class="text-sm font-medium text-text-secondary mb-1">
        {props.title}
      </h3>
      {props.description && (
        <p class="text-xs text-text-muted max-w-[280px]">
          {props.description}
        </p>
      )}
      {props.action && (
        <div class="mt-4">
          {props.action}
        </div>
      )}
    </div>
  );
}
