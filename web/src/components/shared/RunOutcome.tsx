// RunOutcome — shared renderer for the structured AgentRun outcome.
//
// Per the AgentRunOutcomeSpec proposal, every AgentRun finalizes a
// `status.outcome` with:
//   - intent:    change | plan | incident | discovery | noop
//   - artifacts: [{ kind, url, ref, title, provider }]   (pr | mr | issue | memory | commit)
//   - summary:   short human-readable result
//
// This component replaces the historical bespoke renderers for
// `status.pullRequestURL`, `status.branch`, and `status.commits` that were
// scattered across the codebase. Two layouts:
//
//   variant="full"    — card-style: forge-aware PR/MR link, branch chip,
//                       commit count, issue/memory chips, full intent chip.
//                       Used inside DelegationResultCard, AgentInspector,
//                       TaskAgentView, RunDetailView.
//
//   variant="compact" — single inline row of small chips, suitable for
//                       run cards in the sidebar / RunsPanel.
//
// Intent fallback: when `status.outcome.intent` is missing the caller
// can pass `intentHint` (typically `spec.outcome.intent`). The hint is
// rendered in a muted style so it's distinguishable from the agent's
// authoritative finalization.
import { Show, For } from 'solid-js'
import type { AgentRunOutcome, AgentRunArtifact, AgentRunIntent } from '../../types/api'

interface RunOutcomeProps {
  outcome?: AgentRunOutcome
  /** Caller hint used when status.outcome.intent is empty (typically spec.outcome.intent). */
  intentHint?: AgentRunIntent
  /** Layout variant. Defaults to "full". */
  variant?: 'full' | 'compact'
  /** When true, render the summary line. Defaults to true in full, false in compact. */
  showSummary?: boolean
  /** When true, render the intent chip. Defaults to true. */
  showIntent?: boolean
}

// ────────────────────────────────────────────────────────────────────────────
// Intent chip styling
// ────────────────────────────────────────────────────────────────────────────

const INTENT_STYLE: Record<AgentRunIntent, string> = {
  change:    'bg-blue-500/15 text-blue-400 border-blue-500/25',
  plan:      'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  incident:  'bg-red-500/15 text-red-400 border-red-500/25',
  discovery: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  noop:      'bg-surface-2 text-text-muted border-border-subtle',
}

const INTENT_LABEL: Record<AgentRunIntent, string> = {
  change:    'change',
  plan:      'plan',
  incident:  'incident',
  discovery: 'discovery',
  noop:      'noop',
}

// ────────────────────────────────────────────────────────────────────────────
// URL helpers — extract forge / repo / number from a PR/MR URL
// ────────────────────────────────────────────────────────────────────────────

/** Extract PR/MR number from URL like https://github.com/u/r/pull/2 → "#2". */
function prNumber(url: string): string | null {
  const m = url.match(/\/pull\/(\d+)/)
  if (m) return `#${m[1]}`
  const mr = url.match(/\/merge_requests\/(\d+)/)
  if (mr) return `!${mr[1]}`
  const iss = url.match(/\/issues\/(\d+)/)
  if (iss) return `#${iss[1]}`
  return null
}

/** Extract owner/repo segment from a forge URL. */
function repoFromURL(url: string): string | null {
  const m = url.match(/(?:github\.com|gitlab\.com|gitea[^/]*|codeberg\.org|bitbucket\.org)\/([^/]+\/[^/]+)/)
  return m ? m[1] : null
}

/** Resolve forge from the explicit provider field or by sniffing the URL. */
function forge(a: AgentRunArtifact): 'github' | 'gitlab' | 'gitea' | 'codeberg' | 'bitbucket' | null {
  if (a.provider === 'github' || a.provider === 'gitlab' || a.provider === 'gitea' ||
      a.provider === 'codeberg' || a.provider === 'bitbucket') {
    return a.provider
  }
  if (!a.url) return null
  if (a.url.includes('github.com')) return 'github'
  if (a.url.includes('gitlab')) return 'gitlab'
  if (a.url.includes('gitea')) return 'gitea'
  if (a.url.includes('codeberg')) return 'codeberg'
  if (a.url.includes('bitbucket')) return 'bitbucket'
  return null
}

// ────────────────────────────────────────────────────────────────────────────
// Forge SVG icons (inline so component is self-contained)
// ────────────────────────────────────────────────────────────────────────────

function ForgeIcon(props: { forge: ReturnType<typeof forge> }) {
  return (
    <Show when={props.forge}>
      <Show when={props.forge === 'github'}>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
        </svg>
      </Show>
      <Show when={props.forge === 'gitlab'}>
        <svg class="w-3.5 h-3.5 text-[#FC6D26]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
        </svg>
      </Show>
    </Show>
  )
}

function ExternalLinkIcon() {
  return (
    <svg class="w-3 h-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3H9m-3 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
    </svg>
  )
}

function MemoryIcon() {
  return (
    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Artifact chip
// ────────────────────────────────────────────────────────────────────────────

interface ArtifactChipProps {
  a: AgentRunArtifact
  compact?: boolean
}

function ArtifactChip(props: ArtifactChipProps) {
  const a = () => props.a
  const isPRish = () => a().kind === 'pr' || a().kind === 'mr' || a().kind === 'issue'

  // PR / MR / Issue — clickable forge link with repo + number
  if (isPRish() && a().url) {
    const f = () => forge(a())
    const repo = () => repoFromURL(a().url!) || a().kind.toUpperCase()
    const num = () => prNumber(a().url!)
    return (
      <a
        href={a().url}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/8 border border-accent/20 hover:bg-accent/15 transition-colors text-xs font-mono text-accent"
        onClick={(e) => e.stopPropagation()}
        title={a().title || a().url}
      >
        <ForgeIcon forge={f()} />
        <span>{repo()}</span>
        <Show when={num()}>
          <span class="font-semibold">{num()}</span>
        </Show>
        <ExternalLinkIcon />
      </a>
    )
  }

  // Commit artifact — branch + count tag (no link)
  if (a().kind === 'commit') {
    return (
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 border border-border-subtle text-[10px] font-mono text-text-secondary"
            title={a().title || ''}>
        <BranchIcon />
        <Show when={a().ref}>
          <span>{a().ref}</span>
        </Show>
        <Show when={a().title}>
          <span class="text-text-muted">{a().title}</span>
        </Show>
      </span>
    )
  }

  // Memory artifact
  if (a().kind === 'memory') {
    return (
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-[10px] font-mono text-purple-300"
            title={a().title || ''}>
        <MemoryIcon />
        <span>memory</span>
        <Show when={a().ref}>
          <span class="text-text-muted">{a().ref}</span>
        </Show>
      </span>
    )
  }

  // Fallback (unknown kind, or pr/mr/issue without URL)
  return (
    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 border border-border-subtle text-[10px] font-mono text-text-secondary"
          title={a().title || a().url || ''}>
      <span>{a().kind}</span>
      <Show when={a().ref}>
        <span class="text-text-muted">{a().ref}</span>
      </Show>
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Intent chip
// ────────────────────────────────────────────────────────────────────────────

interface IntentChipProps {
  intent: AgentRunIntent
  muted?: boolean
  /** "sm" = ultra-compact pill for inline use next to titles (sidebar run cards). */
  size?: 'sm' | 'md'
}

export function IntentChip(props: IntentChipProps) {
  const cls = INTENT_STYLE[props.intent]
  const size = props.size ?? 'md'
  const sizeCls = size === 'sm'
    ? 'px-1.5 py-px text-[8.5px] tracking-[0.06em]'
    : 'px-2 py-0.5 text-[10px] tracking-wide'
  return (
    <span
      class={`inline-flex items-center rounded-full border font-semibold uppercase ${sizeCls} ${cls} ${props.muted ? 'opacity-60' : ''}`}
      title={props.muted ? `${INTENT_LABEL[props.intent]} (caller hint, not yet finalized)` : `Run intent: ${INTENT_LABEL[props.intent]}`}
    >
      {INTENT_LABEL[props.intent]}
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

export default function RunOutcome(props: RunOutcomeProps) {
  const variant = () => props.variant ?? 'full'
  const showIntent = () => props.showIntent ?? true
  const showSummary = () => props.showSummary ?? (variant() === 'full')

  const effectiveIntent = () => props.outcome?.intent ?? props.intentHint
  const intentIsHint = () => !props.outcome?.intent && !!props.intentHint

  const hasArtifacts = () => !!props.outcome?.artifacts?.length
  const hasAnything = () => !!effectiveIntent() || hasArtifacts() || !!props.outcome?.summary

  // Render nothing rather than an empty container; lets parents use <Show> trivially.
  if (!hasAnything()) return null

  return (
    <div class={variant() === 'compact' ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}>
      {/* Intent + artifacts row */}
      <div class="flex flex-wrap items-center gap-2">
        <Show when={showIntent() && effectiveIntent()}>
          <IntentChip intent={effectiveIntent()!} muted={intentIsHint()} />
        </Show>
        <Show when={hasArtifacts()}>
          <For each={props.outcome!.artifacts}>
            {(a) => <ArtifactChip a={a} compact={variant() === 'compact'} />}
          </For>
        </Show>
      </div>

      {/* Summary */}
      <Show when={showSummary() && props.outcome?.summary}>
        <p class="text-xs text-text-secondary leading-relaxed">{props.outcome!.summary}</p>
      </Show>
    </div>
  )
}
