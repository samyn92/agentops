// NeuralTrace — agent activity indicator beam
// CSS classes are defined in index.css

interface NeuralTraceProps {
  active: boolean;
  variant?: 'accent' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md';
  inline?: boolean;
  class?: string;
}

export default function NeuralTrace(props: NeuralTraceProps) {
  const variant = () => props.variant || 'accent';
  const size = () => props.size || 'sm';

  return (
    <div
      class={`neural-trace neural-trace--${size()} neural-trace--${variant()} ${props.inline ? 'neural-trace--inline' : ''} ${props.active ? 'neural-trace-enter' : ''} ${props.class || ''}`}
      style={{ display: props.active ? 'block' : 'none' }}
    >
      <div class="neural-trace__rail" />
      <div class="neural-trace__glow" />
      <div class="neural-trace__beam" />
    </div>
  );
}
