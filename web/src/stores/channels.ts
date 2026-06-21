// Channels store — fetches Channel CRs and builds agent→channel bindings map.
// Used by the sidebar to group task agents that are triggered by channels.
import { createSignal, createResource, createMemo } from 'solid-js';
import { channels as channelsAPI } from '../lib/api';
import { onResourceChanged } from './events';
import type { ChannelResponse } from '../types';

// ── State ──

const [refetchTrigger, setRefetchTrigger] = createSignal(0);

const [channelList, { refetch: refetchChannels }] = createResource(
  refetchTrigger,
  async () => {
    try {
      return await channelsAPI.list();
    } catch (err) {
      console.error('Failed to fetch channels:', err);
      return [];
    }
  },
);

// Auto-refetch when K8s resources change (Channel CRD events)
onResourceChanged(() => {
  setRefetchTrigger((n) => n + 1);
});

// ── Derived state ──

/** Map of agent name → list of channels bound to it (via spec.agentRef). */
const channelBindings = createMemo<Record<string, ChannelResponse[]>>(() => {
  const channels = channelList() ?? [];
  const map: Record<string, ChannelResponse[]> = {};

  for (const ch of channels) {
    const agentRef = ch.spec.agentRef;
    if (!agentRef) continue;
    if (!map[agentRef]) map[agentRef] = [];
    map[agentRef].push(ch);
  }

  return map;
});

/** Get channels bound to a specific agent. */
export function getChannelsForAgent(agentName: string): ChannelResponse[] {
  return channelBindings()[agentName] ?? [];
}

/** Check if an agent has any channel bindings. */
export function hasChannels(agentName: string): boolean {
  return (channelBindings()[agentName]?.length ?? 0) > 0;
}

/** Get set of all agent names that have channel bindings. */
const channelBoundAgents = createMemo<Set<string>>(() => {
  return new Set(Object.keys(channelBindings()));
});

// ── Public API ──

export {
  channelList,
  channelBindings,
  channelBoundAgents,
  refetchChannels,
};

/** Force refresh the channel list. */
export function refreshChannels() {
  setRefetchTrigger((n) => n + 1);
}
