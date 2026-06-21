// TracesPage — standalone full-width traces view.
// Elevated from the Sidebar tab to a first-class route at /traces.
import TracesPanel from '../components/layout/TracesPanel';

export default function TracesPage() {
  return (
    <div class="h-full flex bg-background text-text overflow-hidden">
      {/* Full-width traces panel */}
      <div class="flex-1 min-h-0">
        <TracesPanel />
      </div>
    </div>
  );
}
