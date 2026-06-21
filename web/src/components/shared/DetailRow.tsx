// DetailRow — reusable label+value pair for metadata display
export default function DetailRow(props: { label: string; value: string }) {
  return (
    <div class="flex items-center gap-2 text-[11px]">
      <span class="text-text-muted w-16 flex-shrink-0">{props.label}</span>
      <span class="text-text-secondary font-mono truncate">{props.value}</span>
    </div>
  );
}
