// AppHeader — unified branded header with mode switcher.
// Shared between Explore (/) and Factory (/mission) views.
import { createSignal, Show, For } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { currentUser, logout } from '../../stores/auth';

type AppMode = 'explore' | 'factory';

const MODES: { id: AppMode; label: string; path: string; description: string }[] = [
  { id: 'explore', label: 'Explore', path: '/', description: 'Agent chat, inspect, and traces' },
  { id: 'factory', label: 'Factory', path: '/mission', description: 'Kanban board and agent automation' },
];

export default function AppHeader() {
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = createSignal(false);

  const currentMode = () => location.pathname === '/mission' ? 'factory' : 'explore';
  const currentModeLabel = () => MODES.find(m => m.id === currentMode())?.label ?? 'Explore';

  const user = () => currentUser();

  return (
    <header class="h-12 flex items-center px-4 border-b border-border bg-surface/80 backdrop-blur-sm flex-shrink-0 z-10">
      {/* Left: Logo + Brand + Mode */}
      <div class="flex items-center gap-3">
        {/* Logo — same as Sidebar */}
        <img src="/logo.png" alt="AgentOps" class="w-6 h-6 rounded-lg flex-shrink-0" />

        {/* Brand + Mode selector */}
        <div class="relative">
          <button
            class="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            onClick={() => setDropdownOpen(!dropdownOpen())}
          >
            <span class="text-[15px] font-semibold tracking-wide leading-tight">
              Agent<span class="text-text-secondary">Ops</span>
            </span>
            <span class="text-text-muted text-[14px]">/</span>
            <span class="text-[14px] font-medium text-text-secondary">{currentModeLabel()}</span>
            <svg class="w-3 h-3 text-text-muted ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown */}
          <Show when={dropdownOpen()}>
            <div class="absolute top-full left-0 mt-1.5 w-56 rounded-xl border border-border bg-surface shadow-lg overflow-hidden z-50"
              onMouseLeave={() => setDropdownOpen(false)}>
              <For each={MODES}>
                {(mode) => (
                  <A
                    href={mode.path}
                    class="flex flex-col px-3 py-2.5 hover:bg-surface-hover transition-colors"
                    classList={{ 'bg-accent/5': currentMode() === mode.id }}
                    onClick={() => setDropdownOpen(false)}
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-[12.5px] font-semibold">{mode.label}</span>
                      <Show when={currentMode() === mode.id}>
                        <span class="text-accent text-[10px]">&#10003;</span>
                      </Show>
                    </div>
                    <span class="text-[11px] text-text-muted">{mode.description}</span>
                  </A>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* Right: User */}
      <div class="ml-auto flex items-center gap-3">
        <Show when={user()?.authenticated}>
          <button
            class="flex items-center gap-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors"
            onClick={logout}
            title="Log out"
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
