// RunPhaseIcon — compact phase indicator for run cards.
// Running: animated spinner circle
// Succeeded: green checkmark
// Failed: red X
// Pending/Queued: pulsing amber dot
// Unknown: static muted dot

import { Show, Switch, Match } from 'solid-js';

interface RunPhaseIconProps {
  phase: string | undefined;
}

export default function RunPhaseIcon(props: RunPhaseIconProps) {
  return (
    <span class="flex-shrink-0 w-4 h-4 flex items-center justify-center" title={props.phase || 'Unknown'}>
      <Switch fallback={
        <span class="w-2 h-2 rounded-full bg-text-muted/40" />
      }>
        <Match when={props.phase === 'Running'}>
          <span class="run-phase-spinner" />
        </Match>
        <Match when={props.phase === 'Succeeded'}>
          <svg class="w-4 h-4 text-success" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
        </Match>
        <Match when={props.phase === 'Failed'}>
          <svg class="w-3.5 h-3.5 text-error" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </Match>
        <Match when={props.phase === 'Pending' || props.phase === 'Queued'}>
          <span class="run-phase-pending" />
        </Match>
      </Switch>
    </span>
  );
}
