import { Router, Route, useNavigate } from '@solidjs/router'
import { onMount, onCleanup, createEffect, Show, For, createResource } from 'solid-js'
import MainApp from './pages/MainApp'
import SettingsPage from './pages/SettingsPage'
import MissionControl from './pages/MissionControl'
import TracesPage from './pages/TracesPage'
import { registerKeyboardShortcuts } from './lib/keyboard'
import AppErrorBoundary from './components/shared/ErrorBoundary'
import { startEventStream, stopEventStream } from './stores/events'
import { isAuthenticated, isAuthDisabled, currentUser, providers, login } from './stores/auth'
import { GitLabIcon } from './components/shared/Icons'
import AppHeader from './components/layout/AppHeader'

function AppShell(props: { children?: any }) {
  const navigate = useNavigate()

  onMount(() => {
    const cleanup = registerKeyboardShortcuts(navigate)
    onCleanup(cleanup)
  })

  // Start SSE only when authenticated (or when auth is disabled — backward compat).
  createEffect(() => {
    if (isAuthenticated() || isAuthDisabled()) {
      startEventStream()
    } else {
      stopEventStream()
    }
  })

  return (
    <AppErrorBoundary name="Application">
      {/* Show login screen when not authenticated; show app when authenticated or auth disabled */}
      <Show when={isAuthenticated() || isAuthDisabled()} fallback={<LoginScreen />}>
        <div class="h-dvh flex flex-col">
          <AppHeader />
          <div class="flex-1 min-h-0">
            {props.children}
          </div>
        </div>
      </Show>
    </AppErrorBoundary>
  )
}

/** Login screen — shows available GitLab providers to authenticate with. */
function LoginScreen() {
  const providerList = () => providers();

  return (
    <div class="min-h-dvh bg-surface flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-8">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 grid place-items-center text-white text-2xl shadow-lg mx-auto mb-4">
            &#9670;
          </div>
          <h1 class="text-xl font-bold tracking-tight">AgentOps</h1>
          <p class="text-sm text-text-muted mt-1">Sign in to access the agent platform</p>
        </div>

        <div class="bg-surface-2 border border-border rounded-xl p-6">
          <Show when={providerList().length > 0} fallback={
            <div class="text-center py-4">
              <p class="text-sm text-text-muted">Loading providers...</p>
            </div>
          }>
            <div class="flex flex-col gap-3">
              <For each={providerList()}>
                {(provider) => (
                  <button
                    class="flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-border-subtle bg-surface hover:bg-surface-3 hover:border-border transition-colors text-left"
                    onClick={() => login(window.location.pathname, provider.id)}
                  >
                    <GitLabIcon class="w-5 h-5 text-[#FC6D26] flex-none" />
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-semibold">{provider.label}</div>
                      <div class="text-[11px] text-text-muted font-mono truncate">{provider.baseUrl}</div>
                    </div>
                    <span class="text-text-muted text-xs">&#8594;</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <p class="text-[11px] text-text-muted text-center mt-4">
          Authenticate with your GitLab account to access workspaces, agents, and pipelines.
        </p>
      </div>
    </div>
  );
}

// Legacy redirects
function RedirectToMission() {
  const navigate = useNavigate()
  navigate('/mission', { replace: true })
  return null
}

export default function App() {
  return (
    <Router root={AppShell}>
      <Route path="/" component={MainApp} />
      <Route path="/mission" component={MissionControl} />
      <Route path="/traces" component={TracesPage} />
      <Route path="/board" component={RedirectToMission} />
      <Route path="/gitlab" component={RedirectToMission} />
      <Route path="/settings" component={SettingsPage} />
    </Router>
  )
}
