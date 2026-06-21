// Tip — thin wrapper around Ark UI Tooltip for consistent styling.
// Usage: <Tip content="Label text"><button>...</button></Tip>
// The child is rendered as the trigger; the tooltip appears on hover/focus.
import { Tooltip } from '@ark-ui/solid/tooltip';
import { Portal } from 'solid-js/web';
import type { JSX } from 'solid-js';

interface TipProps {
  /** Text displayed in the tooltip */
  content: string;
  children: JSX.Element;
  /** Placement relative to trigger (default: top) */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  /** Open delay in ms (default: 400) */
  openDelay?: number;
  /** Close delay in ms (default: 150) */
  closeDelay?: number;
}

export default function Tip(props: TipProps) {
  return (
    <Tooltip.Root
      openDelay={props.openDelay ?? 400}
      closeDelay={props.closeDelay ?? 150}
      positioning={{ placement: props.placement ?? 'top' }}
    >
      <Tooltip.Trigger asChild={(triggerProps) => (
        <span {...triggerProps()} class="contents">{props.children}</span>
      )} />
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content class="z-[9999] px-2 py-1 text-[11px] font-medium bg-surface-2 text-text border border-border rounded-md shadow-lg select-none tooltip-enter">
            {props.content}
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
