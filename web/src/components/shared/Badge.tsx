// Status/category badge component
import type { JSX } from 'solid-js';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'muted';

interface BadgeProps {
  variant?: BadgeVariant;
  children: JSX.Element;
  class?: string;
  dot?: boolean;
}

// Use conditional chains so Tailwind v4 can statically see every class string
function getVariantClasses(v: BadgeVariant): string {
  switch (v) {
    case 'success': return 'bg-success/10 text-success border-success/20';
    case 'warning': return 'bg-warning/10 text-warning border-warning/20';
    case 'error':   return 'bg-error/10 text-error border-error/20';
    case 'info':    return 'bg-info/10 text-info border-info/20';
    case 'muted':   return 'bg-surface text-text-muted border-border-subtle';
    default:        return 'bg-surface-2 text-text-secondary border-border';
  }
}

function getDotColor(v: BadgeVariant): string {
  switch (v) {
    case 'success': return 'bg-success';
    case 'warning': return 'bg-warning';
    case 'error':   return 'bg-error';
    case 'info':    return 'bg-info';
    case 'muted':   return 'bg-text-muted';
    default:        return 'bg-text-secondary';
  }
}

export default function Badge(props: BadgeProps) {
  const variant = () => props.variant || 'default';

  return (
    <span
      class={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border ${getVariantClasses(variant())} ${props.class || ''}`}
    >
      {props.dot && (
        <span class={`w-1.5 h-1.5 rounded-full ${getDotColor(variant())}`} />
      )}
      {props.children}
    </span>
  );
}
