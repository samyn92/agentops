// AppHeader — unified branded header with mode tab switcher.
// Shared between Explore (/) and Factory (/mission) views.
import { Show } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { currentUser, logout } from '../../stores/auth';

type AppMode = 'explore' | 'factory' | 'traces';

const MODES: { id: AppMode; label: string; path: string; icon: string }[] = [
  { id: 'explore', label: 'Explore', path: '/', icon: '◇' },
  { id: 'factory', label: 'Factory', path: '/mission', icon: '◆' },
  { id: 'traces', label: 'Traces', path: '/traces', icon: '⌁' },
];

export default function AppHeader() {
  const location = useLocation();
  const currentMode = () => {
    if (location.pathname === '/mission') return 'factory';
    if (location.pathname === '/traces') return 'traces';
    return 'explore';
  };
  const user = () => currentUser();

  return (
    <header class="h-12 flex items-center px-4 border-b border-border bg-surface/80 backdrop-blur-sm flex-shrink-0 z-10">
      {/* Left: Logo + Brand */}
      <div class="flex items-center gap-2.5 mr-6">
        <img src="/logo.png" alt="AgentOps" class="w-6 h-6 rounded-lg flex-shrink-0" />
        <span class="text-[15px] font-semibold tracking-wide leading-tight">
          Agent<span class="text-text-secondary">Ops</span>
        </span>
      </div>

      {/* Center: Segmented control — premium pill switcher */}
      <nav class="flex items-center h-7 rounded-lg border border-border-subtle bg-surface-2 p-0.5 gap-0.5">
        {MODES.map(mode => {
          const isActive = () => currentMode() === mode.id;
          return (
            <A
              href={mode.path}
              class="relative flex items-center gap-1.5 px-3 h-full rounded-md text-[11.5px] font-medium transition-all duration-150"
              classList={{
                'bg-surface text-text shadow-sm border border-border-subtle': isActive(),
                'text-text-muted hover:text-text-secondary': !isActive(),
              }}
            >
              <span class="text-[10px] opacity-70">{mode.icon}</span>
              <span>{mode.label}</span>
            </A>
          );
        })}
      </nav>

      {/* Right: User */}
      <div class="ml-auto flex items-center gap-3">
        <Show when={user()?.authenticated}>
          <button
            class="flex items-center gap-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors rounded-lg px-2 py-1 hover:bg-surface-hover"
            onClick={logout}
            title={`Signed in as ${user()?.username} — click to sign out`}
          >
            <Show when={user()?.avatarUrl} fallback={
              <span class="w-6 h-6 rounded-full grid place-items-center text-[9px] font-bold bg-accent/10 text-accent uppercase">
                {(user()?.username ?? '?').slice(0, 2)}
              </span>
            }>
              <img src={user()!.avatarUrl} class="w-6 h-6 rounded-full" alt="" />
            </Show>
            <span class="hidden sm:inline font-medium">{user()?.username}</span>
          </button>
        </Show>
      </div>
    </header>
  );
}
