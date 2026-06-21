// ErrorBoundary — catches component render errors and displays a fallback
import { ErrorBoundary as SolidErrorBoundary, type JSX } from 'solid-js';

interface AppErrorBoundaryProps {
  children: JSX.Element;
  /** Optional name for the boundary (shown in error UI) */
  name?: string;
}

export default function AppErrorBoundary(props: AppErrorBoundaryProps) {
  return (
    <SolidErrorBoundary
      fallback={(err, reset) => (
        <div class="flex flex-col items-center justify-center p-6 gap-3 text-center min-h-[120px]">
          <div class="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
            <svg class="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-text">
              {props.name ? `${props.name} crashed` : 'Something went wrong'}
            </p>
            <p class="text-xs text-text-muted mt-1 max-w-xs">
              {err instanceof Error ? err.message : String(err)}
            </p>
          </div>
          <button
            class="px-3 py-1.5 text-xs font-medium text-text bg-surface-hover hover:bg-surface-2 rounded-lg border border-border transition-colors"
            onClick={reset}
          >
            Try again
          </button>
        </div>
      )}
    >
      {props.children}
    </SolidErrorBoundary>
  );
}
