// AgentCard — M3-styled card for the sidebar agent list.
// Shows name, run history queue, online indicator, concurrency slots,
// and channel/schedule indicator badges.
import { Show, For, createMemo } from 'solid-js';
import { getAgentStatus } from '../../stores/agents';
import { getAgentConcurrency, getAgentRuns } from '../../stores/runs';
import { getChannelsForAgent } from '../../stores/channels';
import { LightningBoltFilledIcon, ClockIcon } from '../shared/Icons';
import type { AgentResponse } from '../../types';

interface AgentCardProps {
  agent: AgentResponse;
  selected: boolean;
  onSelect: () => void;
  /** Compact variant for nested task agents under an orchestrator */
  compact?: boolean;
}

export default function AgentCard(props: AgentCardProps) {
  const status = () => getAgentStatus(props.agent.namespace, props.agent.name);
  const concurrency = () => getAgentConcurrency(props.agent.name);
  const hasActivity = () => concurrency().running > 0 || concurrency().queued > 0;
  const isCompact = () => props.compact ?? false;

  // Indicator badges: channels and schedule
  const channels = () => getChannelsForAgent(props.agent.name);
  const hasChannelBindings = () => channels().length > 0;
  const hasSchedule = () => !!props.agent.schedule;

  // Recent runs for the history queue (newest first → latest is leftmost)
  const recentRuns = createMemo(() => {
    const runs = getAgentRuns(props.agent.name, 16);
    return runs;
  });

  return (
    <button
      class={`agent-card w-full text-left transition-all ${
        props.selected ? 'agent-card--selected' : ''
      } ${isCompact() ? 'agent-card--compact' : ''}`}
      onClick={() => props.onSelect()}
    >
      {/* Row 1: Name + Status dot */}
      <div class="flex items-center gap-2 mb-1">
        <span
          class={`flex-shrink-0 rounded-full ${
            status().isOnline ? 'bg-success' : 'bg-text-muted'
          } ${isCompact() ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}
          title={status().isOnline ? 'Online' : 'Offline'}
        />
        <Show when={status().isOnline && !isCompact()}>
          <span class="absolute w-2 h-2 rounded-full bg-success status-dot-glow" style={{ left: '12px' }} />
        </Show>
        <span class={`font-medium text-text truncate flex-1 ${isCompact() ? 'text-xs' : 'text-sm'}`}>
          {props.agent.name}
        </span>
        <Show when={props.agent.phase && props.agent.phase !== 'Running' && props.agent.phase !== 'Ready'}>
          <span class={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            props.agent.phase === 'Pending' ? 'bg-warning/15 text-warning' :
            props.agent.phase === 'Failed' ? 'bg-error/15 text-error' :
            'bg-text-muted/15 text-text-muted'
          }`}>
            {props.agent.phase}
          </span>
        </Show>
      </div>

       {/* Row 2: Run pipeline + indicator badges */}
      <div class={`flex items-center gap-1.5 min-w-0 ${isCompact() ? 'text-[10px]' : 'text-[11px]'} leading-[16px]`}>
        {/* Run history pipeline */}
        <Show
          when={recentRuns().length > 0}
          fallback={
            <span class="text-text-muted/40 text-[10px]">no runs</span>
          }
        >
          <div class="flex items-center flex-shrink min-w-0 overflow-hidden gap-[3px] ml-4">
            <For each={recentRuns()}>
              {(run, i) => {
                const phase = run.status?.phase;
                const isLast = () => i() === recentRuns().length - 1;
                const isActive = () => phase === 'Running' || phase === 'Pending' || phase === 'Queued';
                const lineColor = () => {
                  switch (phase) {
                    case 'Succeeded': return 'bg-success/30';
                    case 'Failed': return 'bg-error/30';
                    case 'Running': return 'bg-accent/25';
                    case 'Pending': case 'Queued': return 'bg-accent/20';
                    default: return 'bg-text-muted/10';
                  }
                };
                const sz = isCompact() ? 9 : 11;
                return (
                  <>
                    <Show when={phase === 'Succeeded'}>
                      <svg
                        width={sz} height={sz}
                        viewBox="0 0 16 16"
                        class="flex-shrink-0"
                      >
                        <title>{`${run.metadata.name}: Succeeded`}</title>
                        <circle cx="8" cy="8" r="7.5" fill="none" stroke="var(--success)" stroke-width="1.5" opacity="0.25" />
                        <circle cx="8" cy="8" r="5.5" fill="var(--success)" opacity="0.15" />
                        <path d="M5.25 8.25L7 10l3.75-4" fill="none" stroke="var(--success)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </Show>
                    <Show when={phase === 'Failed'}>
                      <svg
                        width={sz} height={sz}
                        viewBox="0 0 16 16"
                        class="flex-shrink-0"
                      >
                        <title>{`${run.metadata.name}: Failed`}</title>
                        <circle cx="8" cy="8" r="7.5" fill="none" stroke="var(--error)" stroke-width="1.5" opacity="0.25" />
                        <circle cx="8" cy="8" r="5.5" fill="var(--error)" opacity="0.15" />
                        <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" fill="none" stroke="var(--error)" stroke-width="1.8" stroke-linecap="round" />
                      </svg>
                    </Show>
                    <Show when={isActive()}>
                      <svg
                        width={sz} height={sz}
                        viewBox="0 0 16 16"
                        class="flex-shrink-0 run-spinner"
                      >
                        <title>{`${run.metadata.name}: ${phase}`}</title>
                        <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.15" />
                        <path
                          d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
                          fill="none"
                          stroke="var(--accent)"
                          stroke-width="1.8"
                          stroke-linecap="round"
                        />
                      </svg>
                    </Show>
                    <Show when={!phase || (phase !== 'Succeeded' && phase !== 'Failed' && !isActive())}>
                      <svg
                        width={sz} height={sz}
                        viewBox="0 0 16 16"
                        class="flex-shrink-0"
                      >
                        <title>{`${run.metadata.name}: ${phase || 'unknown'}`}</title>
                        <circle cx="8" cy="8" r="3" fill="var(--text-muted)" opacity="0.2" />
                      </svg>
                    </Show>
                    <Show when={!isLast()}>
                      <div class={`${isCompact() ? 'w-[3px]' : 'w-[4px]'} h-[1px] ${lineColor()} flex-shrink-0 rounded-full`} />
                    </Show>
                  </>
                );
              }}
            </For>
          </div>
        </Show>

        <span class="flex-1" />
        {/* Channel indicator */}
        <Show when={hasChannelBindings()}>
          <span
            class="sidebar-indicator-badge sidebar-indicator-badge--channel"
            title={`${channels().length} channel${channels().length > 1 ? 's' : ''}: ${channels().map(c => c.metadata.name).join(', ')}`}
          >
            <LightningBoltFilledIcon class="w-2.5 h-2.5" />
            <Show when={!isCompact()}>
              <span>{channels().length}</span>
            </Show>
          </span>
        </Show>

        {/* Schedule indicator — icon only, hover reveals cron expression */}
        <Show when={hasSchedule()}>
          <span class="sidebar-schedule-icon group relative">
            <ClockIcon class="w-3.5 h-3.5" />
            <span class="sidebar-schedule-tooltip">
              {props.agent.schedule}
            </span>
          </span>
        </Show>
      </div>

      {/* Row 3: Concurrency slots (only when there's activity) */}
      <Show when={hasActivity()}>
        <div class={`flex items-center gap-1.5 ${isCompact() ? 'mt-1' : 'mt-1.5'}`}>
          <div class="flex gap-0.5 flex-1">
            <For each={Array.from({ length: Math.max(concurrency().running + concurrency().queued, concurrency().running + 1) })}>
              {(_, i) => (
                <div
                  class={`flex-1 rounded-full transition-colors ${
                    i() < concurrency().running
                      ? 'bg-success'
                      : i() < concurrency().running + concurrency().queued
                        ? 'bg-warning'
                        : 'bg-border'
                  } ${isCompact() ? 'h-0.5' : 'h-1'}`}
                />
              )}
            </For>
          </div>
          <span class="text-[10px] font-mono text-text-muted flex-shrink-0">
            {concurrency().running}r
            <Show when={concurrency().queued > 0}>
              <span class="text-warning"> +{concurrency().queued}q</span>
            </Show>
          </span>
        </div>
      </Show>
    </button>
  );
}
