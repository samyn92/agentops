// OrchestratorDetailView — center panel for daemon (orchestrator) agents.
// Two tabs:
//   1. Chat  — the conversation stream
//   2. Agent — unified metadata panel (discovery, delegation, memory, config, tools, etc.)
//
// The old "Ops" tab was removed: its Delegation Team roster duplicated the
// sidebar's orchestrator → workers tree (now enriched with sparkline + success%
// + last-run time per worker). Its Fleet Overview stats collapse into a thin
// inline strip below the orchestrator header, always visible on both tabs.
import { Show, createSignal, createMemo } from 'solid-js';
import { Tabs } from '@ark-ui/solid/tabs';
import { selectedAgent, getAgentStatus } from '../../stores/agents';
import { getRunsDelegatedBy } from '../../stores/runs';
import { phaseVariant, formatTokens, formatCost } from '../../lib/format';
import ChatView from '../chat/ChatView';
import AgentPanel from './AgentPanel';
import Badge from '../shared/Badge';

interface OrchestratorDetailViewProps {
  class?: string;
}

export type OrchestratorTab = 'chat' | 'agent';

// Right-panel pill tab style
const TAB_CLASS = "relative px-2.5 py-1 text-[11px] rounded-lg transition-colors data-[selected]:bg-surface-hover data-[selected]:text-text data-[selected]:font-medium text-text-muted hover:text-text-secondary hover:bg-surface-hover/50";

export default function OrchestratorDetailView(props: OrchestratorDetailViewProps) {
  const [activeTab, setActiveTab] = createSignal<OrchestratorTab>('chat');

  const agent = () => selectedAgent();
  const agentName = () => agent()?.name ?? '';

  const agentStatus = () => {
    const a = agent();
    if (!a) return { phase: '', isOnline: false, model: '', image: '' };
    return getAgentStatus(a.namespace, a.name);
  };

  // Fleet stats derived from delegated runs
  const delegatedRuns = createMemo(() => getRunsDelegatedBy(agentName()));
  const activeCount = createMemo(() =>
    delegatedRuns().filter((r) => {
      const p = r.status?.phase;
      return p === 'Running' || p === 'Pending' || p === 'Queued';
    }).length,
  );
  const succeededCount = createMemo(() =>
    delegatedRuns().filter((r) => r.status?.phase === 'Succeeded').length,
  );
  const failedCount = createMemo(() =>
    delegatedRuns().filter((r) => r.status?.phase === 'Failed').length,
  );

  const aggregateStats = createMemo(() => {
    let totalTokens = 0;
    let totalCost = 0;
    for (const r of delegatedRuns()) {
      if (r.status?.tokensUsed) totalTokens += r.status.tokensUsed;
      if (r.status?.cost) totalCost += parseFloat(r.status.cost);
    }
    return { totalTokens, totalCost };
  });

  const hasFleetSignal = () => delegatedRuns().length > 0;

  return (
    <div class={`flex flex-col h-full ${props.class || ''}`}>
      <Tabs.Root
        value={activeTab()}
        onValueChange={(details) => setActiveTab(details.value as OrchestratorTab)}
        class="flex flex-col h-full"
      >
        {/* Tab bar */}
        <div class="flex items-center gap-3 h-12 border-b border-border flex-shrink-0 px-4">
          {/* Agent name + status badge */}
          <span class="text-sm font-semibold text-text truncate">{agentName()}</span>
          <Show when={agentStatus().phase}>
            <Badge variant={phaseVariant(agentStatus().phase)} dot>
              {agentStatus().phase}
            </Badge>
          </Show>

          {/* Spacer pushes tabs to the right */}
          <span class="flex-1" />

          {/* Tabs (right-aligned) */}
          <Tabs.List class="flex gap-0.5">
            <Tabs.Trigger value="chat" class={`${TAB_CLASS} inline-flex items-center gap-1`}>
              Chat
              <Show when={activeCount() > 0}>
                <span class="px-1 py-px text-[9px] font-bold bg-accent text-primary-foreground rounded-full animate-pulse">
                  {activeCount()}
                </span>
              </Show>
            </Tabs.Trigger>
            <Tabs.Trigger value="agent" class={TAB_CLASS}>
              Agent
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        {/* Inline fleet strip — always visible, shared across tabs */}
        <Show when={hasFleetSignal()}>
          <div class="flex items-center gap-4 px-4 py-1.5 border-b border-border-subtle bg-surface-2/30 flex-shrink-0 text-[10px]">
            <FleetPill label="Delegations" value={delegatedRuns().length} />
            <FleetPill label="Active" value={activeCount()} tone={activeCount() > 0 ? 'accent' : undefined} />
            <FleetPill label="Succeeded" value={succeededCount()} tone={succeededCount() > 0 ? 'success' : undefined} />
            <FleetPill label="Failed" value={failedCount()} tone={failedCount() > 0 ? 'error' : undefined} />
            <Show when={aggregateStats().totalTokens > 0}>
              <FleetPill label="Tokens" value={formatTokens(aggregateStats().totalTokens)} />
            </Show>
            <Show when={aggregateStats().totalCost > 0}>
              <FleetPill label="Cost" value={formatCost(aggregateStats().totalCost)} />
            </Show>
          </div>
        </Show>

        <Tabs.Content value="chat" class="flex-1 min-h-0 flex flex-col">
          <ChatView class="flex-1 min-h-0" />
        </Tabs.Content>

        <Tabs.Content value="agent" class="flex-1 min-h-0 overflow-hidden">
          <AgentPanel />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

// ── Fleet Pill (compact inline metric) ──
function FleetPill(props: { label: string; value: string | number; tone?: 'accent' | 'success' | 'error' }) {
  const valueColor = () => {
    switch (props.tone) {
      case 'accent': return 'text-accent';
      case 'success': return 'text-success';
      case 'error': return 'text-error';
      default: return 'text-text';
    }
  };
  return (
    <span class="inline-flex items-center gap-1">
      <span class="text-text-muted uppercase tracking-wider text-[9px]">{props.label}</span>
      <span class={`font-mono font-semibold tabular-nums ${valueColor()}`}>{props.value}</span>
    </span>
  );
}
