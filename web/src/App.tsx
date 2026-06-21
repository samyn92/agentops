import { Router, Route, useNavigate } from '@solidjs/router'
import { onMount, onCleanup, createEffect } from 'solid-js'
import MainApp from './pages/MainApp'
import SettingsPage from './pages/SettingsPage'
import MissionControl from './pages/MissionControl'
import { registerKeyboardShortcuts } from './lib/keyboard'
import AppErrorBoundary from './components/shared/ErrorBoundary'
import { startEventStream, stopEventStream } from './stores/events'
import { isAuthenticated, isAuthDisabled } from './stores/auth'

function AppShell(props: { children?: any }) {
  const navigate = useNavigate()

  onMount(() => {
    const cleanup = registerKeyboardShortcuts(navigate)
    onCleanup(cleanup)
  })

  // Start SSE only when authenticated (or when auth is disabled — backward compat).
  // This avoids an infinite EventSource reconnect loop on 401.
  createEffect(() => {
    if (isAuthenticated() || isAuthDisabled()) {
      startEventStream()
    } else {
      stopEventStream()
    }
  })

  return (
    <AppErrorBoundary name="Application">
      {props.children}
    </AppErrorBoundary>
  )
}

// The legacy Work Board (/board) and GitLab Workspace (/gitlab) pages were
// merged into Mission Control. Redirect old links to /mission so they don't 404.
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
      <Route path="/board" component={RedirectToMission} />
      <Route path="/gitlab" component={RedirectToMission} />
      <Route path="/settings" component={SettingsPage} />
    </Router>
  )
}
