// REST + SSE client for the console backend API.
import type {
  FEPEvent,
  AgentEventEnvelope,
  AgentResponse,
  AgentCRD,
  AgentConfig,
  AgentRunResponse,
  ChannelResponse,
  AgentToolResponse,
  AgentResourceBinding,
  ResourceContext,
  RuntimeMessage,
  GitFile,
  GitCommit,
  GitBranch,
  GitMergeRequest,
  GitIssue,
  GitPipeline,
  GitBoardIssue,
  GitMergeRequestDetail,
  GitNote,
  GitLabProject,
  GitGroupIssue,  GitGroupMergeRequest,
  GitLabel,
  GitMember,
  GitJob,
  IntegrationResource,
  GroupRunJoin,
  GroupProjectPipelineHealth,
  GitMilestone,
  GitProjectDetail,
  GitPipelineLite,
  GitLanguages,
  GitRelease,
  GitContributor,
  NamespaceInfo,
  PodInfo,
  K8sNamespace,
  K8sNamespaceSummary,
  K8sPod,
  K8sDeployment,
  K8sStatefulSet,
  K8sDaemonSet,
  K8sJob,
  K8sCronJob,
  K8sService,
  K8sIngress,
  K8sConfigMap,
  K8sSecret,
  K8sEvent,
  MemoryEnabledResponse,
  MemoryObservation,
  MemorySearchResult,
  MemorySession,
  MemoryContext,
  MemoryStats,
  TempoTraceResponse,
  TempoSearchResponse,
} from '../types';

const BASE = '/api/v1';

// ── 401 Interceptor ──
// When the BFF returns 401, throw an error. The App component reactively shows
// the login screen when isAuthenticated() is false — no redirect needed.
// This prevents login loops with multi-provider OAuth (where the browser may
// have an active session on one provider that auto-grants tokens).

function handleAuthRequired(res: Response): void {
  if (res.status === 401) {
    throw new Error('Authentication required');
  }
}

// ── Generic fetch helpers ──

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  handleAuthRequired(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

/** GET a plain-text body (e.g. CI job logs). */
async function getText(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`);
  handleAuthRequired(res);
  if (!res.ok) {
    throw new Error(res.statusText);
  }
  return res.text();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  handleAuthRequired(res);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  handleAuthRequired(res);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  handleAuthRequired(res);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  handleAuthRequired(res);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

// ── Auth (GitLab OIDC — routes outside /api/v1) ──

export interface AuthUser {
  username: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
  authenticated: boolean;
  /** The provider ID this user authenticated with (e.g. "default", "1"). */
  provider?: string;
  /** The GitLab instance base URL for this session. */
  gitlabUrl?: string;
  /** True when the BFF has no OIDC configured (env vars absent). */
  authDisabled?: boolean;
}

export interface AuthProvider {
  id: string;
  label: string;
  baseUrl: string;
}

export const authApi = {
  /** Get current user identity (or { authenticated: false }). */
  me: async (): Promise<AuthUser> => {
    const res = await fetch('/auth/me');
    if (!res.ok) return { username: '', authenticated: false };
    return res.json();
  },
  /** List available OAuth providers. */
  providers: async (): Promise<AuthProvider[]> => {
    const res = await fetch('/auth/providers');
    if (!res.ok) return [];
    return res.json();
  },
  /** Redirect the browser to the GitLab login page for a specific provider. */
  login: (returnTo?: string, provider?: string) => {
    const params = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : '';
    const providerPath = provider ? `/${provider}` : '';
    window.location.href = `/auth/login${providerPath}${params}`;
  },
  /** Log out (clears session cookie). */
  logout: async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  },
};

// ── Agents ──

export const agents = {
  list: () => get<AgentResponse[]>('/agents'),
  get: (ns: string, name: string) => get<AgentCRD>(`/agents/${ns}/${name}`),
  config: (ns: string, name: string) => get<AgentConfig>(`/agents/${ns}/${name}/config`),
  status: (ns: string, name: string) => get<Record<string, unknown>>(`/agents/${ns}/${name}/status`),
};

// ── AgentRun dispatch (console-initiated direct run creation) ──
// Complements the board's GitLab-label dispatch. Used by the CI repair loop:
// create a fix run pinned to an MR's source branch, with retry-budget
// enforcement (the BFF returns 409 + blocked=true once the budget is spent).

export interface DispatchRequest {
  agentRef: string;
  prompt: string;
  namespace?: string;
  // Git workspace (clone + work on branch). For a CI fix: the MR source branch.
  integrationRef?: string;
  branch?: string;
  baseBranch?: string;
  project?: string;
  // GitLab join keys (overlay the run on its card).
  projectRef?: string;
  issueIID?: string;
  mrIID?: string;
  intent?: string;
  // CI repair-loop bookkeeping.
  ciFix?: boolean;
  retryBudget?: number;
}

export interface DispatchResponse {
  run?: string;
  namespace?: string;
  agentRef?: string;
  attempt?: number;
  budget?: number;
  blocked?: boolean;
  reason?: string;
}

// ── Agent conversation (sessionless — one conversation per agent) ──

export const conversation = {
  /** Non-streaming prompt */
  prompt: (ns: string, name: string, prompt: string) =>
    post<{ output: string; model: string }>(`/agents/${ns}/${name}/prompt`, { prompt }),

  /** Mid-execution steering */
  steer: (ns: string, name: string, message: string) =>
    post<{ ok: boolean }>(`/agents/${ns}/${name}/steer`, { message }),

  /** Abort generation */
  abort: (ns: string, name: string) =>
    del<{ ok: boolean }>(`/agents/${ns}/${name}/abort`),

  /** Get working memory messages */
  getWorkingMemory: (ns: string, name: string) =>
    get<RuntimeMessage[]>(`/agents/${ns}/${name}/working-memory`),
};

// ── Streaming prompt (returns ReadableStream for SSE) ──

export async function streamPrompt(
  ns: string,
  name: string,
  prompt: string,
  onEvent: (event: FEPEvent) => void,
  signal?: AbortSignal,
  context?: ResourceContext[],
): Promise<void> {
  const body: Record<string, unknown> = { prompt };
  if (context && context.length > 0) {
    body.context = context;
  }

  const res = await fetch(`${BASE}/agents/${ns}/${name}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });

  handleAuthRequired(res);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // Flush any remaining bytes from the TextDecoder
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE frames
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data) {
          try {
            const event = JSON.parse(data) as FEPEvent;
            onEvent(event);
          } catch {
            // Skip malformed frames
          }
        }
      }
    }
  }

  // Flush any remaining data in the buffer (e.g. final agent_finish event).
  // The buffer may contain one or more SSE frames without a trailing newline.
  if (buffer.length > 0) {
    for (const line of buffer.split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data) {
          try {
            const event = JSON.parse(data) as FEPEvent;
            onEvent(event);
          } catch {
            // Skip malformed frames
          }
        }
      }
    }
  }
}

// ── Agent Runs ──

export const agentRuns = {
  list: () => get<AgentRunResponse[]>('/agentruns'),
  get: (ns: string, name: string) => get<AgentRunResponse>(`/agentruns/${ns}/${name}`),
  /**
   * Dispatch a new AgentRun (console-initiated). Resolves to the created run, or
   * — when a CI-fix dispatch hits the retry budget — a blocked DispatchResponse
   * (HTTP 409, blocked=true with a human reason) rather than throwing, so the
   * caller can render the budget-exhausted state. Other failures still throw.
   */
  dispatch: async (req: DispatchRequest): Promise<DispatchResponse> => {
    const res = await fetch(`${BASE}/agentruns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    handleAuthRequired(res);
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && (data as DispatchResponse).blocked) {
      return data as DispatchResponse; // retry budget exhausted — not an error
    }
    if (res.status === 403) {
      // Dispatch denied — insufficient GitLab access on target project.
      throw new Error((data as { error?: string }).error || 'Insufficient access to dispatch agents on this project');
    }
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || res.statusText);
    }
    return data as DispatchResponse;
  },
};

// ── Channels ──

export const channels = {
  list: () => get<ChannelResponse[]>('/channels'),
  get: (ns: string, name: string) => get<ChannelResponse>(`/channels/${ns}/${name}`),
};

// ── Agent Tools ──

export const agentTools = {
  list: () => get<AgentToolResponse[]>('/agenttools'),
  get: (ns: string, name: string) => get<AgentToolResponse>(`/agenttools/${ns}/${name}`),
};

// ── Agent Resources ──

export const agentResources = {
  /** List all AgentResource CRs */
  list: () => get<unknown[]>('/agentresources'),

  /** Get a specific AgentResource CR */
  getResource: (ns: string, name: string) => get<unknown>(`/agentresources/${ns}/${name}`),

  /** List resources bound to a specific agent (enriched with binding metadata) */
  forAgent: (ns: string, agentName: string) =>
    get<AgentResourceBinding[]>(`/agents/${ns}/${agentName}/integrations`),

  /** Browse files/tree for a browsable resource */
  files: (ns: string, agentName: string, resName: string, path?: string, ref?: string) => {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (ref) params.set('ref', ref);
    return get<GitFile[]>(`/agents/${ns}/${agentName}/integrations/${resName}/files?${params}`);
  },

  /** Get file content */
  fileContent: (ns: string, agentName: string, resName: string, path: string, ref?: string) => {
    const params = new URLSearchParams({ path });
    if (ref) params.set('ref', ref);
    return get<unknown>(`/agents/${ns}/${agentName}/integrations/${resName}/files/content?${params}`);
  },

  /** Browse commits */
  commits: (ns: string, agentName: string, resName: string, ref?: string, path?: string, page?: number) => {
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);
    if (path) params.set('path', path);
    if (page) params.set('page', String(page));
    return get<GitCommit[]>(`/agents/${ns}/${agentName}/integrations/${resName}/commits?${params}`);
  },

  /** Browse branches */
  branches: (ns: string, agentName: string, resName: string, page?: number) => {
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    return get<GitBranch[]>(`/agents/${ns}/${agentName}/integrations/${resName}/branches?${params}`);
  },

  /** Browse merge requests / pull requests */
  mergeRequests: (ns: string, agentName: string, resName: string, state?: string, page?: number) => {
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    if (page) params.set('page', String(page));
    return get<GitMergeRequest[]>(`/agents/${ns}/${agentName}/integrations/${resName}/mergerequests?${params}`);
  },

  /** Browse issues */
  issues: (ns: string, agentName: string, resName: string, state?: string, page?: number) => {
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    if (page) params.set('page', String(page));
    return get<GitIssue[]>(`/agents/${ns}/${agentName}/integrations/${resName}/issues?${params}`);
  },

  /** Browse CI pipelines (GitLab) */
  pipelines: (ns: string, agentName: string, resName: string, ref?: string, page?: number) => {
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);
    if (page) params.set('page', String(page));
    return get<GitPipeline[]>(`/agents/${ns}/${agentName}/integrations/${resName}/pipelines?${params}`);
  },
};

// ── Work Board (GitLab label-driven) ──
// All paths require a gitlab-project Integration. The board reads issues by
// trigger label (columns), inspects MRs (diff/notes/pipelines), and performs
// the human merge gate + label moves.

export const board = {
  /** List issues carrying a given label (one call per board column). */
  issuesByLabel: (ns: string, agentName: string, resName: string, label: string, state = 'opened') => {
    const params = new URLSearchParams({ labels: label, state });
    return get<GitBoardIssue[]>(`/agents/${ns}/${agentName}/integrations/${resName}/issues?${params}`);
  },

  /** Get a single merge request. */
  mergeRequest: (ns: string, agentName: string, resName: string, iid: number) =>
    get<GitMergeRequestDetail>(`/agents/${ns}/${agentName}/integrations/${resName}/mergerequests/${iid}`),

  /** Get a merge request's diff/changes. */
  mergeRequestChanges: (ns: string, agentName: string, resName: string, iid: number) =>
    get<GitMergeRequestDetail>(`/agents/${ns}/${agentName}/integrations/${resName}/mergerequests/${iid}/changes`),

  /** List a merge request's discussion notes. */
  mergeRequestNotes: (ns: string, agentName: string, resName: string, iid: number) =>
    get<GitNote[]>(`/agents/${ns}/${agentName}/integrations/${resName}/mergerequests/${iid}/notes`),

  /** Post a note to a merge request. */
  addMergeRequestNote: (ns: string, agentName: string, resName: string, iid: number, body: string) =>
    post<GitNote>(`/agents/${ns}/${agentName}/integrations/${resName}/mergerequests/${iid}/notes`, { body }),

  /** List a merge request's CI pipelines. */
  mergeRequestPipelines: (ns: string, agentName: string, resName: string, iid: number) =>
    get<GitPipeline[]>(`/agents/${ns}/${agentName}/integrations/${resName}/mergerequests/${iid}/pipelines`),

  /** Merge a merge request (human merge gate). */
  merge: (ns: string, agentName: string, resName: string, iid: number, opts?: Record<string, unknown>) =>
    put<GitMergeRequestDetail>(`/agents/${ns}/${agentName}/integrations/${resName}/mergerequests/${iid}/merge`, opts),

  /** Move an issue between columns by setting its labels. */
  setIssueLabels: (ns: string, agentName: string, resName: string, iid: number, labels: string) =>
    put<GitBoardIssue>(`/agents/${ns}/${agentName}/integrations/${resName}/issues/${iid}/labels`, { labels }),

  /** Add/remove labels on an issue without replacing the full set. */
  updateIssueLabels: (
    ns: string, agentName: string, resName: string, iid: number,
    change: { add_labels?: string; remove_labels?: string },
  ) => put<GitBoardIssue>(`/agents/${ns}/${agentName}/integrations/${resName}/issues/${iid}/labels`, change),
};

// ── Integrations (cluster-wide CRD listing) ──
// Used by the GitLab Workspace to discover gitlab-group integrations.

export const integrations = {
  /** List every Integration CR in the cluster (raw CRD objects). */
  list: () => get<IntegrationResource[]>('/integrations'),

  /** List only the gitlab-group integrations. */
  gitlabGroups: async (): Promise<IntegrationResource[]> => {
    const all = await get<IntegrationResource[]>('/integrations');
    return all.filter((i) => i.spec?.kind === 'gitlab-group');
  },

  /**
   * List every integration that can back a Mission Control board workspace:
   * a gitlab-group (many projects) OR a single gitlab-project. Both are
   * first-class workspaces — the BFF re-scopes the /group/* read routes by kind.
   */
  gitlabWorkspaces: async (): Promise<IntegrationResource[]> => {
    const all = await get<IntegrationResource[]>('/integrations');
    return all.filter((i) => i.spec?.kind === 'gitlab-group' || i.spec?.kind === 'gitlab-project');
  },

  get: (ns: string, name: string) =>
    get<IntegrationResource>(`/integrations/${ns}/${name}`),
};

// ── User-scoped Workspace Discovery (OIDC) ──
// Multi-tenant workspace discovery: returns groups + standalone projects the
// user has Developer+ access to (based on their GitLab OIDC token).

export interface WorkspaceProject {
  id: number;
  name: string;
  path: string;
  pathWithNamespace: string;
  webUrl: string;
  avatarUrl?: string;
  description?: string;
  defaultBranch?: string;
  visibility?: string;
  lastActivityAt?: string;
  starCount: number;
  forksCount: number;
  openIssuesCount: number;
  topics?: string[];
  archived: boolean;
  starred: boolean;
  namespaceKind?: string;
  namespacePath?: string;
}

export interface WorkspaceGroup {
  id: number;
  name: string;
  fullPath: string;
  webUrl: string;
  avatarUrl?: string;
  description?: string;
  parentId?: number;
  subgroups?: WorkspaceGroup[];
  projects?: WorkspaceProject[];
}

export interface WorkspacesResponse {
  groups: WorkspaceGroup[];
  starred: WorkspaceProject[];
  projects: WorkspaceProject[];
}

export const workspaces = {
  /** Discover all accessible workspaces (groups with subgroups + projects, starred). */
  list: () => get<WorkspacesResponse>('/workspaces'),
};

// ── GitLab Group Workspace (gitlab-group Integration) ──
// Group-wide observability across every project in a group, backed by a single
// group access token. Group-level reads (projects/issues/MRs/labels/members) are
// not agent-scoped — the integration is identified by {ns}/{name}. Per-card
// actions reuse the work-board handlers via a ?project=<id> query param that
// pins the action to the project the aggregated card belongs to.

export interface GroupIssueFilter {
  labels?: string;
  state?: string;
  search?: string;
  author_username?: string;
  assignee_username?: string;
  milestone?: string;
  order_by?: string;
  sort?: string;
  page?: number;
  per_page?: number;
}

export interface GroupMRFilter extends GroupIssueFilter {
  reviewer_username?: string;
  wip?: string;
  source_branch?: string;
  target_branch?: string;
}

function qs(obj?: Record<string, unknown>): string {
  if (!obj) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const gitlabGroup = {
  /** List the projects in the group (newest-activity first). */
  projects: (ns: string, intg: string, opts?: { search?: string; per_page?: number; page?: number }) =>
    get<GitLabProject[]>(`/integrations/${ns}/${intg}/group/projects${qs(opts)}`),

  /** List issues across the whole group (the group-aggregated board backbone). */
  issues: (ns: string, intg: string, opts?: GroupIssueFilter) =>
    get<GitGroupIssue[]>(`/integrations/${ns}/${intg}/group/issues${qs(opts as Record<string, unknown>)}`),

  /** List merge requests across the whole group. */
  mergeRequests: (ns: string, intg: string, opts?: GroupMRFilter) =>
    get<GitGroupMergeRequest[]>(`/integrations/${ns}/${intg}/group/merge_requests${qs(opts as Record<string, unknown>)}`),

  /** List the group's labels (with issue/MR counts). */
  labels: (ns: string, intg: string) =>
    get<GitLabel[]>(`/integrations/${ns}/${intg}/group/labels`),

  /** List group members (for author/assignee resolution + filters). */
  members: (ns: string, intg: string) =>
    get<GitMember[]>(`/integrations/${ns}/${intg}/group/members`),

  /**
   * Server-side run↔card join + trace cross-links: one entry per (project, iid)
   * work item, the most-recent AgentRun executing it. Replaces shipping every
   * AgentRun to the browser and re-deriving the join client-side.
   */
  runs: (ns: string, intg: string) =>
    get<GroupRunJoin[]>(`/integrations/${ns}/${intg}/group/runs`),

  // ── DevOps enrichment: group-wide CI/CD health + planning ──

  /** Latest pipeline per project across the group (CI/CD health backbone). */
  pipelines: (ns: string, intg: string) =>
    get<GroupProjectPipelineHealth[]>(`/integrations/${ns}/${intg}/group/pipelines`),

  /** Group milestones (delivery planning). */
  milestones: (ns: string, intg: string, opts?: { state?: string; search?: string }) =>
    get<GitMilestone[]>(`/integrations/${ns}/${intg}/group/milestones${qs(opts)}`),

  // ── DevOps enrichment: per-project drill-down (group token, numeric id) ──

  projectDetail: (ns: string, intg: string, project: number) =>
    get<GitProjectDetail>(`/integrations/${ns}/${intg}/group/projects/${project}`),

  projectPipelines: (ns: string, intg: string, project: number, opts?: { ref?: string; status?: string; per_page?: number }) =>
    get<GitPipelineLite[]>(`/integrations/${ns}/${intg}/group/projects/${project}/pipelines${qs(opts)}`),

  projectCommits: (ns: string, intg: string, project: number, opts?: { ref_name?: string; per_page?: number }) =>
    get<GitCommit[]>(`/integrations/${ns}/${intg}/group/projects/${project}/commits${qs(opts)}`),

  projectBranches: (ns: string, intg: string, project: number) =>
    get<GitBranch[]>(`/integrations/${ns}/${intg}/group/projects/${project}/branches`),

  projectLanguages: (ns: string, intg: string, project: number) =>
    get<GitLanguages>(`/integrations/${ns}/${intg}/group/projects/${project}/languages`),

  projectReleases: (ns: string, intg: string, project: number) =>
    get<GitRelease[]>(`/integrations/${ns}/${intg}/group/projects/${project}/releases`),

  projectContributors: (ns: string, intg: string, project: number) =>
    get<GitContributor[]>(`/integrations/${ns}/${intg}/group/projects/${project}/contributors`),

  // ── DevOps enrichment: deeper detail (CI jobs/logs, issue body & notes) ──

  projectIssue: (ns: string, intg: string, project: number, iid: number) =>
    get<GitGroupIssue>(`/integrations/${ns}/${intg}/group/projects/${project}/issues/${iid}`),

  projectIssueNotes: (ns: string, intg: string, project: number, iid: number) =>
    get<GitNote[]>(`/integrations/${ns}/${intg}/group/projects/${project}/issues/${iid}/notes`),

  /** Post a note to an issue (e.g. record review feedback the re-fired PM reads). */
  addProjectIssueNote: (ns: string, intg: string, project: number, iid: number, body: string) =>
    post<GitNote>(`/integrations/${ns}/${intg}/group/projects/${project}/issues/${iid}/notes`, { body }),

  /** Update issue description/title. PUT body: { description?: string, title?: string } */
  updateProjectIssue: (ns: string, intg: string, project: number, iid: number, body: { description?: string; title?: string }) =>
    put<GitGroupIssue>(`/integrations/${ns}/${intg}/group/projects/${project}/issues/${iid}`, body),

  /** Plan refinement: prompt agent with issue context + feedback, post response as note. */
  refineIssue: (ns: string, intg: string, project: number, iid: number, feedback: string, agent: string) =>
    post<{ output: string; noteId: number }>(`/integrations/${ns}/${intg}/group/projects/${project}/issues/${iid}/refine`, { feedback, agent }),

  /** Merge requests that will close this issue when merged (GitLab closed_by).
   *  The authoritative issue→MR link for the work-board gate. */
  projectIssueClosedBy: (ns: string, intg: string, project: number, iid: number) =>
    get<GitGroupMergeRequest[]>(`/integrations/${ns}/${intg}/group/projects/${project}/issues/${iid}/closed_by`),

  projectPipelineJobs: (ns: string, intg: string, project: number, pipelineID: number) =>
    get<GitJob[]>(`/integrations/${ns}/${intg}/group/projects/${project}/pipelines/${pipelineID}/jobs`),

  projectJobTrace: (ns: string, intg: string, project: number, jobID: number) =>
    getText(`/integrations/${ns}/${intg}/group/projects/${project}/jobs/${jobID}/trace`),

  // ── Per-card actions (require the owning project id) ──

  mergeRequest: (ns: string, intg: string, project: number, iid: number) =>
    get<GitMergeRequestDetail>(`/integrations/${ns}/${intg}/mergerequests/${iid}?project=${project}`),

  mergeRequestChanges: (ns: string, intg: string, project: number, iid: number) =>
    get<GitMergeRequestDetail>(`/integrations/${ns}/${intg}/mergerequests/${iid}/changes?project=${project}`),

  mergeRequestNotes: (ns: string, intg: string, project: number, iid: number) =>
    get<GitNote[]>(`/integrations/${ns}/${intg}/mergerequests/${iid}/notes?project=${project}`),

  addMergeRequestNote: (ns: string, intg: string, project: number, iid: number, body: string) =>
    post<GitNote>(`/integrations/${ns}/${intg}/mergerequests/${iid}/notes?project=${project}`, { body }),

  mergeRequestPipelines: (ns: string, intg: string, project: number, iid: number) =>
    get<GitPipeline[]>(`/integrations/${ns}/${intg}/mergerequests/${iid}/pipelines?project=${project}`),

  merge: (ns: string, intg: string, project: number, iid: number, opts?: Record<string, unknown>) =>
    put<GitMergeRequestDetail>(`/integrations/${ns}/${intg}/mergerequests/${iid}/merge?project=${project}`, opts),

  updateIssueLabels: (
    ns: string, intg: string, project: number, iid: number,
    change: { add_labels?: string; remove_labels?: string; labels?: string },
  ) => put<GitBoardIssue>(`/integrations/${ns}/${intg}/issues/${iid}/labels?project=${project}`, change),
};

// ── Kubernetes ──

export const kubernetes = {
  namespaces: () => get<NamespaceInfo[]>('/kubernetes/namespaces'),
  pods: (ns: string) => get<PodInfo[]>(`/kubernetes/namespaces/${ns}/pods`),
};

// ── Kubernetes Resource Browser ──

export const kubernetesBrowse = {
  namespaces: () => get<K8sNamespace[]>('/kubernetes/browse/namespaces'),
  namespaceSummary: (ns: string) => get<K8sNamespaceSummary>(`/kubernetes/browse/namespaces/${ns}/summary`),
  pods: (ns: string) => get<K8sPod[]>(`/kubernetes/browse/namespaces/${ns}/pods`),
  deployments: (ns: string) => get<K8sDeployment[]>(`/kubernetes/browse/namespaces/${ns}/deployments`),
  statefulsets: (ns: string) => get<K8sStatefulSet[]>(`/kubernetes/browse/namespaces/${ns}/statefulsets`),
  daemonsets: (ns: string) => get<K8sDaemonSet[]>(`/kubernetes/browse/namespaces/${ns}/daemonsets`),
  jobs: (ns: string) => get<K8sJob[]>(`/kubernetes/browse/namespaces/${ns}/jobs`),
  cronjobs: (ns: string) => get<K8sCronJob[]>(`/kubernetes/browse/namespaces/${ns}/cronjobs`),
  services: (ns: string) => get<K8sService[]>(`/kubernetes/browse/namespaces/${ns}/services`),
  ingresses: (ns: string) => get<K8sIngress[]>(`/kubernetes/browse/namespaces/${ns}/ingresses`),
  configmaps: (ns: string) => get<K8sConfigMap[]>(`/kubernetes/browse/namespaces/${ns}/configmaps`),
  secrets: (ns: string) => get<K8sSecret[]>(`/kubernetes/browse/namespaces/${ns}/secrets`),
  events: (ns: string) => get<K8sEvent[]>(`/kubernetes/browse/namespaces/${ns}/events`),
};

// ── Permission / Question replies ──

export const control = {
  replyPermission: (ns: string, name: string, permId: string, response: string) =>
    post<{ ok: boolean }>(`/agents/${ns}/${name}/permission/${permId}/reply`, { response }),

  replyQuestion: (ns: string, name: string, qId: string, answers: string[][]) =>
    post<{ ok: boolean }>(`/agents/${ns}/${name}/question/${qId}/reply`, { answers }),
};

// ── Memory (agentops-memory) ──

export const memory = {
  /** Check if memory is enabled for an agent */
  enabled: (ns: string, name: string) =>
    get<MemoryEnabledResponse>(`/agents/${ns}/${name}/memory/enabled`),

  /** List recent observations for an agent */
  listObservations: (ns: string, name: string, opts?: { limit?: number; type?: string; scope?: string }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.type) params.set('type', opts.type);
    if (opts?.scope) params.set('scope', opts.scope);
    const qs = params.toString();
    return get<MemoryObservation[]>(`/agents/${ns}/${name}/memory/observations${qs ? `?${qs}` : ''}`);
  },

  /** Get full observation by ID */
  getObservation: (ns: string, name: string, id: number) =>
    get<MemoryObservation>(`/agents/${ns}/${name}/memory/observations/${id}`),

  /** Create a new observation ("Remember this") */
  createObservation: (ns: string, name: string, obs: {
    type: string;
    title: string;
    content: string;
    tags?: string[];
    scope?: string;
    topic_key?: string;
  }) => post<MemoryObservation>(`/agents/${ns}/${name}/memory/observations`, obs),

  /** Update an observation */
  updateObservation: (ns: string, name: string, id: number, updates: {
    title?: string;
    content?: string;
    type?: string;
    tags?: string[];
  }) => patch<MemoryObservation>(`/agents/${ns}/${name}/memory/observations/${id}`, updates),

  /** Delete an observation */
  deleteObservation: (ns: string, name: string, id: number, hard?: boolean) =>
    del<{ ok: boolean }>(`/agents/${ns}/${name}/memory/observations/${id}${hard ? '?hard=true' : ''}`),

  /** Full-text search across agent memories */
  search: (ns: string, name: string, query: string, opts?: { limit?: number; type?: string }) => {
    const params = new URLSearchParams({ q: query });
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.type) params.set('type', opts.type);
    return get<MemorySearchResult[]>(`/agents/${ns}/${name}/memory/search?${params.toString()}`);
  },

  /** Get recent context (sessions + observations) */
  context: (ns: string, name: string) =>
    get<MemoryContext>(`/agents/${ns}/${name}/memory/context`),

  /** Get memory stats */
  stats: (ns: string, name: string) =>
    get<MemoryStats>(`/agents/${ns}/${name}/memory/stats`),

  /** List recent sessions (work periods) */
  sessions: (ns: string, name: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : '';
    return get<MemorySession[]>(`/agents/${ns}/${name}/memory/sessions${qs}`);
  },

  /** Timeline around a specific observation */
  timeline: (ns: string, name: string, observationId: number, opts?: { before?: number; after?: number }) => {
    const params = new URLSearchParams({ observation_id: String(observationId) });
    if (opts?.before) params.set('before', String(opts.before));
    if (opts?.after) params.set('after', String(opts.after));
    return get<MemoryObservation[]>(`/agents/${ns}/${name}/memory/timeline?${params.toString()}`);
  },

  /** AI-assisted extraction: sends working memory to agent's model, returns structured observation */
  extract: (ns: string, name: string, opts?: { focus?: string; type?: string }) =>
    post<{ type: string; title: string; content: string; tags: string[] }>(
      `/agents/${ns}/${name}/memory/extract`,
      opts ?? {},
    ),
};

// ── Traces (Tempo proxy) ──

export const traces = {
  /** Get a single trace by ID from Tempo */
  get: (traceID: string) =>
    get<TempoTraceResponse>(`/traces/${traceID}`),

  /** Search traces with agent-scoped filters.
   *  Uses Tempo's TraceQL search API.
   *  @param agentName - filter by agent.name resource attribute
   *  @param limit - max number of results (default 20)
   *  @param start - start time as unix seconds
   *  @param end - end time as unix seconds
   */
  search: (opts?: { agentName?: string; limit?: number; start?: number; end?: number }) => {
    const params = new URLSearchParams();
    // Build a TraceQL query — always select agent.name and agent.mode so the sidebar can display them.
    // Filter duration > 1ms to exclude health/status probe noise from Tempo results.
    if (opts?.agentName) {
      params.set('q', `{ resource.agent.name = "${opts.agentName}" && duration > 1ms } | select(resource.agent.name, resource.agent.mode)`);
    } else {
      params.set('q', `{ resource.agent.name =~ ".+" && duration > 1ms } | select(resource.agent.name, resource.agent.mode)`);
    }
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.start) params.set('start', String(opts.start));
    if (opts?.end) params.set('end', String(opts.end));
    // Cache-bust: prevent browser HTTP cache from serving stale trace results
    params.set('_t', String(Date.now()));
    const qs = params.toString();
    return get<TempoSearchResponse>(`/traces${qs ? `?${qs}` : ''}`);
  },
};

// ── Global SSE connection ──

export function connectGlobalSSE(
  onEvent: (eventType: string, data: unknown) => void,
  onError?: (error: Event) => void,
): EventSource {
  const es = new EventSource(`${BASE}/events`);

  // Named event types from the multiplexer
  for (const type of [
    'connected',
    'agent.event',
    'resource.changed',
    'heartbeat',
  ]) {
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        onEvent(type, data);
      } catch {
        onEvent(type, e.data);
      }
    });
  }

  if (onError) {
    es.onerror = onError;
  }

  return es;
}
