// Memory store — manages agentops-memory state for the currently selected agent.
// Fetches observations, search results, stats, and sessions from the BFF.
import { createSignal, createResource, createEffect } from 'solid-js';
import { memory as memoryAPI } from '../lib/api';
import { selectedAgent } from './agents';
import type {
  MemoryObservation,
  MemorySearchResult,
  MemorySession,
  MemoryContext,
  MemoryStats,
  MemoryObservationType,
} from '../types';

// ── Memory enabled state (per agent) ──

const memoryEnabledCache = new Map<string, boolean>();
const [memoryEnabled, setMemoryEnabled] = createSignal(false);
const [memoryProject, setMemoryProject] = createSignal('');

// Check memory status when agent changes
createEffect(async () => {
  const agent = selectedAgent();
  if (!agent) {
    setMemoryEnabled(false);
    setMemoryProject('');
    return;
  }

  const key = `${agent.namespace}/${agent.name}`;
  if (memoryEnabledCache.has(key)) {
    setMemoryEnabled(memoryEnabledCache.get(key)!);
    return;
  }

  try {
    const resp = await memoryAPI.enabled(agent.namespace, agent.name);
    memoryEnabledCache.set(key, resp.enabled);
    setMemoryEnabled(resp.enabled);
    setMemoryProject(resp.project);
  } catch {
    setMemoryEnabled(false);
    setMemoryProject('');
  }
});

export { memoryEnabled, memoryProject };

// ── Observations ──

const [observations, setObservations] = createSignal<MemoryObservation[]>([]);
const [observationsLoading, setObservationsLoading] = createSignal(false);
const [observationFilter, setObservationFilter] = createSignal<string>('all');

export { observations, observationsLoading, observationFilter, setObservationFilter };

export async function fetchObservations(typeFilter?: string) {
  const agent = selectedAgent();
  if (!agent || !memoryEnabled()) return;

  setObservationsLoading(true);
  try {
    const opts: { limit?: number; type?: string } = { limit: 50 };
    if (typeFilter && typeFilter !== 'all') {
      opts.type = typeFilter;
    }
    const result = await memoryAPI.listObservations(agent.namespace, agent.name, opts);
    setObservations(Array.isArray(result) ? result : []);
  } catch (err) {
    console.error('Failed to fetch observations:', err);
    setObservations([]);
  } finally {
    setObservationsLoading(false);
  }
}

// ── Selected observation (detail view) ──

const [selectedObservation, setSelectedObservation] = createSignal<MemoryObservation | null>(null);
const [selectedObservationLoading, setSelectedObservationLoading] = createSignal(false);

export { selectedObservation, setSelectedObservation, selectedObservationLoading };

export async function fetchObservationDetail(id: number) {
  const agent = selectedAgent();
  if (!agent) return;

  setSelectedObservationLoading(true);
  try {
    const obs = await memoryAPI.getObservation(agent.namespace, agent.name, id);
    setSelectedObservation(obs);
  } catch (err) {
    console.error('Failed to fetch observation:', err);
    setSelectedObservation(null);
  } finally {
    setSelectedObservationLoading(false);
  }
}

// ── Search ──

const [searchQuery, setSearchQuery] = createSignal('');
const [searchResults, setSearchResults] = createSignal<MemorySearchResult[]>([]);
const [searchLoading, setSearchLoading] = createSignal(false);

export { searchQuery, setSearchQuery, searchResults, searchLoading };

export async function searchMemory(query: string) {
  const agent = selectedAgent();
  if (!agent || !query.trim()) {
    setSearchResults([]);
    return;
  }

  setSearchLoading(true);
  setSearchQuery(query);
  try {
    const results = await memoryAPI.search(agent.namespace, agent.name, query, { limit: 20 });
    setSearchResults(Array.isArray(results) ? results : []);
  } catch (err) {
    console.error('Failed to search memory:', err);
    setSearchResults([]);
  } finally {
    setSearchLoading(false);
  }
}

// ── Stats ──

const [memoryStats, setMemoryStats] = createSignal<MemoryStats | null>(null);

export { memoryStats };

export async function fetchMemoryStats() {
  const agent = selectedAgent();
  if (!agent || !memoryEnabled()) return;

  try {
    const stats = await memoryAPI.stats(agent.namespace, agent.name);
    setMemoryStats(stats);
  } catch (err) {
    console.error('Failed to fetch memory stats:', err);
    setMemoryStats(null);
  }
}

// ── Sessions (work periods) ──

const [memorySessions, setMemorySessions] = createSignal<MemorySession[]>([]);

export { memorySessions };

export async function fetchMemorySessions() {
  const agent = selectedAgent();
  if (!agent || !memoryEnabled()) return;

  try {
    const sessions = await memoryAPI.sessions(agent.namespace, agent.name, 20);
    setMemorySessions(Array.isArray(sessions) ? sessions : []);
  } catch (err) {
    console.error('Failed to fetch memory sessions:', err);
    setMemorySessions([]);
  }
}

// ── Context ──

const [memoryContext, setMemoryContext] = createSignal<MemoryContext | null>(null);

export { memoryContext };

export async function fetchMemoryContext() {
  const agent = selectedAgent();
  if (!agent || !memoryEnabled()) return;

  try {
    const ctx = await memoryAPI.context(agent.namespace, agent.name);
    setMemoryContext(ctx);
  } catch (err) {
    console.error('Failed to fetch memory context:', err);
    setMemoryContext(null);
  }
}

// ── CRUD operations ──

/** Create a new observation ("Remember this" from chat) */
export async function createObservation(obs: {
  type: string;
  title: string;
  content: string;
  tags?: string[];
  scope?: string;
  topic_key?: string;
}): Promise<boolean> {
  const agent = selectedAgent();
  if (!agent) return false;

  try {
    await memoryAPI.createObservation(agent.namespace, agent.name, obs);
    // Refresh the list
    await fetchObservations(observationFilter() !== 'all' ? observationFilter() : undefined);
    return true;
  } catch (err) {
    console.error('Failed to create observation:', err);
    return false;
  }
}

/** Update an existing observation */
export async function updateObservation(id: number, updates: {
  title?: string;
  content?: string;
  type?: string;
  tags?: string[];
}): Promise<boolean> {
  const agent = selectedAgent();
  if (!agent) return false;

  try {
    const updated = await memoryAPI.updateObservation(agent.namespace, agent.name, id, updates);
    // Update local state
    setObservations((prev) => prev.map((o) => o.id === id ? { ...o, ...updates } as MemoryObservation : o));
    if (selectedObservation()?.id === id) {
      setSelectedObservation({ ...selectedObservation()!, ...updates } as MemoryObservation);
    }
    return true;
  } catch (err) {
    console.error('Failed to update observation:', err);
    return false;
  }
}

/** Delete an observation ("Forget") */
export async function deleteObservation(id: number, hard?: boolean): Promise<boolean> {
  const agent = selectedAgent();
  if (!agent) return false;

  try {
    await memoryAPI.deleteObservation(agent.namespace, agent.name, id, hard);
    // Remove from local state
    setObservations((prev) => prev.filter((o) => o.id !== id));
    if (selectedObservation()?.id === id) {
      setSelectedObservation(null);
    }
    return true;
  } catch (err) {
    console.error('Failed to delete observation:', err);
    return false;
  }
}

// ── Memory panel view state ──

export type MemoryView = 'observations' | 'search' | 'sessions' | 'detail' | 'extract';
const [memoryView, setMemoryView] = createSignal<MemoryView>('observations');
export { memoryView, setMemoryView };

// ── AI-assisted extraction ──

export interface ExtractionResult {
  type: string;
  title: string;
  content: string;
  tags: string[];
}

const [extracting, setExtracting] = createSignal(false);
const [extractionResult, setExtractionResult] = createSignal<ExtractionResult | null>(null);
const [extractionError, setExtractionError] = createSignal<string | null>(null);

export { extracting, extractionResult, extractionError, setExtractionResult };

/** Extract a structured observation from the current working memory using AI. */
export async function extractFromConversation(focus?: string, type?: string): Promise<boolean> {
  const agent = selectedAgent();
  if (!agent) return false;

  setExtracting(true);
  setExtractionError(null);
  setExtractionResult(null);

  try {
    const result = await memoryAPI.extract(agent.namespace, agent.name, {
      focus: focus || undefined,
      type: type || undefined,
    });
    setExtractionResult(result);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Extraction failed';
    setExtractionError(msg);
    console.error('Failed to extract memory:', err);
    return false;
  } finally {
    setExtracting(false);
  }
}

/** Save the extraction result as a new observation, then reset extraction state. */
export async function saveExtraction(overrides?: Partial<ExtractionResult>): Promise<boolean> {
  const result = extractionResult();
  if (!result) return false;

  const obs = {
    type: overrides?.type ?? result.type,
    title: overrides?.title ?? result.title,
    content: overrides?.content ?? result.content,
    tags: overrides?.tags ?? result.tags,
  };

  const ok = await createObservation(obs);
  if (ok) {
    setExtractionResult(null);
    setExtractionError(null);
    setMemoryView('observations');
  }
  return ok;
}

/** Discard extraction result. */
export function discardExtraction() {
  setExtractionResult(null);
  setExtractionError(null);
}

// ── Auto-refresh on agent change ──

createEffect(() => {
  const agent = selectedAgent();
  const enabled = memoryEnabled();
  if (agent && enabled) {
    fetchObservations();
    fetchMemoryStats();
  } else {
    setObservations([]);
    setMemoryStats(null);
    setMemorySessions([]);
    setSelectedObservation(null);
    setSearchResults([]);
    setSearchQuery('');
    setMemoryView('observations');
  }
});
