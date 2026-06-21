// Agent Resource store — tracks AgentResource bindings for the selected agent.
// Also manages resource context selection for per-turn context injection.
import { createSignal, createResource } from 'solid-js';
import { agentResources } from '../lib/api';
import { selectedAgent } from './agents';
import { onResourceChanged } from './events';
import type { AgentResourceBinding, ResourceContext } from '../types';
import { resourceContextKey } from '../types/api';

// ── State ──

const [resourceRefetch, setResourceRefetch] = createSignal(0);

// Fetch resources for the currently selected agent
const [resources, { refetch: refetchResources }] = createResource(
  () => {
    const agent = selectedAgent();
    const _ = resourceRefetch(); // track refetch trigger
    return agent;
  },
  async (agent) => {
    if (!agent) return [];
    try {
      return await agentResources.forAgent(agent.namespace, agent.name);
    } catch (err) {
      console.error('Failed to fetch agent resources:', err);
      return [];
    }
  },
);

// Refetch when K8s AgentResource changes
onResourceChanged(() => {
  setResourceRefetch((n) => n + 1);
});

// ── Selection state ──

const [selectedContextItems, setSelectedContextItems] = createSignal<ResourceContext[]>([]);

/** Toggle a resource context item (add if not present, remove if present) */
export function toggleContextItem(item: ResourceContext): void {
  const key = resourceContextKey(item);
  setSelectedContextItems((prev) => {
    const exists = prev.some((i) => resourceContextKey(i) === key);
    if (exists) {
      return prev.filter((i) => resourceContextKey(i) !== key);
    }
    return [...prev, item];
  });
}

/** Check if a resource context item is selected */
export function isContextItemSelected(item: ResourceContext): boolean {
  const key = resourceContextKey(item);
  return selectedContextItems().some((i) => resourceContextKey(i) === key);
}

/** Remove a specific context item by key */
export function removeContextItem(key: string): void {
  setSelectedContextItems((prev) => prev.filter((i) => resourceContextKey(i) !== key));
}

/** Clear all selected context items */
export function clearContextItems(): void {
  setSelectedContextItems([]);
}

/** Get all selected context items (consumed by chat store when sending messages) */
export function getSelectedContext(): ResourceContext[] {
  return selectedContextItems();
}

/** Get the count of selected context items (reactive) */
export function selectedContextCount(): number {
  return selectedContextItems().length;
}

// ── Public API ──

export { resources, refetchResources, selectedContextItems };

/** Get browsable resources (github-repo, gitlab-project) for the selected agent, sorted by displayName */
export function browsableResources(): AgentResourceBinding[] {
  return (resources() || [])
    .filter((r) => r.kind === 'github-repo' || r.kind === 'gitlab-project')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Get all resources for the selected agent */
export function allResources(): AgentResourceBinding[] {
  return resources() || [];
}

/** Resolve the forge type for a resource by name (returns 'github' | 'gitlab' | 'git' | null) */
export function getResourceForge(resourceRef: string | undefined): 'github' | 'gitlab' | 'git' | null {
  if (!resourceRef) return null;
  const res = (resources() || []).find((r) => r.name === resourceRef);
  if (!res) return null;
  if (res.kind === 'github-repo' || res.kind === 'github-org') return 'github';
  if (res.kind === 'gitlab-project' || res.kind === 'gitlab-group') return 'gitlab';
  if (res.kind === 'git-repo') return 'git';
  return null;
}

/** Resolve the repo/project name for a resource by name.
 *  Returns e.g. "owner/repo" for GitHub, "my-project" for GitLab, or null. */
export function getResourceRepoName(resourceRef: string | undefined): string | null {
  if (!resourceRef) return null;
  const res = (resources() || []).find((r) => r.name === resourceRef);
  if (!res) return null;
  if (res.github) return `${res.github.owner}/${res.github.repo}`;
  if (res.gitlab) return res.gitlab.project;
  if (res.githubOrg) return res.githubOrg.org;
  if (res.gitlabGroup) return res.gitlabGroup.group;
  return null;
}
