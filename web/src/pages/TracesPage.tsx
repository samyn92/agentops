// TracesPage — standalone traces view (elevated from Sidebar tab to first-class route).
import TracesPanel from '../components/layout/TracesPanel';

export default function TracesPage() {
  return (
    <div class="h-full flex flex-col bg-background text-text overflow-hidden">
      <div class="flex-1 min-h-0 overflow-auto p-4">
        <TracesPanel />
      </div>
    </div>
  );
}
