// API response types — mirrors K8s CRDs exposed by the console backend

// ---- Agent CR ----

export interface AgentMemoryConfig {
  serverRef: string
  project?: string
  contextLimit?: number
  autoSummarize?: boolean
  autoSave?: boolean
  autoSearch?: boolean
}

export interface AgentStorageConfig {
  size: string
  storageClass?: string
}

export interface AgentResourceRef {
  name: string
  readOnly?: boolean
  autoContext?: boolean
}

export interface AgentResourceRequirements {
  requests?: { cpu?: string; memory?: string }
  limits?: { cpu?: string; memory?: string }
}

export interface AgentDelegation {
  team: string[]
  maxFanOut?: number
  strategy?: string
  preferParallel?: boolean
}

export interface AgentSpec {
  mode: "daemon" | "task"
  image?: string
  imagePullPolicy?: string
  model: string
  primaryProvider?: string
  titleModel?: string
  providers: Array<{ name: string; apiKeySecret: { name: string; key: string } }>
  fallbackModels?: string[]
  systemPrompt?: string
  builtinTools?: string[]
  temperature?: number
  maxOutputTokens?: number
  maxSteps?: number
  toolRefs?: Array<{ oci?: object; configMap?: object; inline?: object }>
  permissionTools?: string[]
  enableQuestionTool?: boolean
  env?: Record<string, string>
  secrets?: Array<{ name: string; secretKeyRef: { name: string; key: string } }>
  storage?: AgentStorageConfig
  tools?: Array<{ name: string; permissions?: object; directTools?: string[]; autoContext?: boolean }>
  toolHooks?: {
    blockedCommands?: string[]
    allowedPaths?: string[]
    auditTools?: string[]
    memorySaveRules?: Array<{ tool: string; matchOutput?: string; type?: string; scope?: string }>
    contextInjectTools?: Array<{ tool: string; query?: string; limit?: number }>
  }
  contextFiles?: Array<{ path: string; configMapRef: { name: string; key: string } }>
  concurrency?: { maxRuns?: number; policy?: string }
  schedule?: string
  schedulePrompt?: string
  networkPolicy?: { enabled: boolean }
  resources?: AgentResourceRequirements
  serviceAccountName?: string
  timeout?: string
  delegation?: AgentDelegation
  memory?: AgentMemoryConfig
  resourceBindings?: AgentResourceRef[]
}

export interface AgentStatus {
  phase: string
  readyReplicas: number
  serviceURL?: string
  model?: string
  conditions?: Array<{
    type: string
    status: string
    reason?: string
    message?: string
    lastTransitionTime?: string
  }>
}

/** Flat agent response from GET /agents (backend flattens CRD fields). */
export interface AgentResponse {
  name: string
  namespace: string
  mode: string
  model: string
  image: string
  phase: string
  readyReplicas: number
  schedule?: string
  delegation?: AgentDelegation
}

/** Full CRD shape returned by GET /agents/:ns/:name (raw K8s object). */
export interface AgentCRD {
  metadata: {
    name: string
    namespace: string
    creationTimestamp: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec: AgentSpec
  status?: AgentStatus
}

/** Operator-generated runtime config from GET /agents/:ns/:name/config. */
export interface AgentConfig {
  name: string
  namespace: string
  model: string
  systemPrompt: string
  platformProtocol: string
  memory?: {
    serverURL: string
    project: string
    contextLimit: number
    autoSummarize: boolean
    autoSave: boolean
    autoSearch: boolean
  }
  delegation?: {
    strategy: string
    preferParallel: boolean
    maxFanOut: number
  }
  resources?: Array<{
    name: string
    url: string
    type: string
    defaultBranch: string
    readOnly: boolean
    autoContext: boolean
  }>
}

// ---- AgentRun CR ----

export interface AgentRunResponse {
  metadata: {
    name: string
    namespace: string
    creationTimestamp: string
    labels?: Record<string, string>
    /** Annotations — includes work-board join keys stamped by the
     *  gitlab-label channel: agentops.dev/gitlab-iid|gitlab-target|gitlab-project. */
    annotations?: Record<string, string>
  }
  spec: {
    agentRef: string
    prompt: string
    source?: string
    sourceRef?: string
    git?: {
      resourceRef: string
      branch: string
      baseBranch?: string
    }
    /** Optional caller hint for the run-level outcome. The executing agent
     *  finalizes the authoritative value into status.outcome.intent. */
    outcome?: {
      intent?: AgentRunIntent
    }
  }
  status?: {
    phase: string
    output?: string
    toolCalls?: number
    tokensUsed?: number
    cost?: string
    model?: string
    traceID?: string
    startTime?: string
    completionTime?: string
    error?: string
    /** Structured outcome written by the executing runtime at end-of-task.
     *  Replaces the legacy flat pullRequestURL/commits/branch fields. */
    outcome?: AgentRunOutcome
  }
}

/** Run-level intent classifier — keep in sync with agentops-core
 *  api/v1alpha1.AgentRunIntent. */
export type AgentRunIntent = 'change' | 'plan' | 'incident' | 'discovery' | 'noop'

/** Concrete artifact produced by a run. */
export interface AgentRunArtifact {
  kind: 'pr' | 'mr' | 'issue' | 'memory' | 'commit'
  /** Forge provider hint (github, gitlab, gitea, codeberg, bitbucket). */
  provider?: string
  /** Full URL when the artifact has one (PR/MR/Issue link). */
  url?: string
  /** Git ref (branch / commit sha) or memory note ID. */
  ref?: string
  /** Short human-readable title. */
  title?: string
}

/** status.outcome on AgentRun: intent + artifacts + summary. */
export interface AgentRunOutcome {
  intent?: AgentRunIntent
  artifacts?: AgentRunArtifact[]
  summary?: string
}

// ---- Channel CR ----

export interface ChannelResponse {
  metadata: {
    name: string
    namespace: string
    creationTimestamp: string
  }
  spec: {
    type: string
    agentRef: string
    webhook?: { path?: string }
    config?: Record<string, string>
  }
  status?: {
    phase: string
    ready: boolean
  }
}

// ---- AgentTool CR ----

export type AgentToolSourceType = 'oci' | 'configMap' | 'inline' | 'mcpServer' | 'mcpEndpoint' | 'skill';

export interface AgentToolResponse {
  metadata: {
    name: string
    namespace: string
    creationTimestamp: string
  }
  spec: {
    description?: string
    category?: string
    oci?: { ref: string; digest?: string; pullPolicy?: string }
    configMap?: { name: string; key: string }
    inline?: { content: string }
    mcpServer?: { image: string; port?: number; command?: string[]; env?: Record<string, string>; serviceAccountName?: string }
    mcpEndpoint?: { url: string; transport?: string; headers?: Record<string, string> }
    skill?: { ref: string; digest?: string; pullPolicy?: string }
    defaultPermissions?: { requireApproval?: boolean; mode?: string; rules?: string[] }
  }
  status?: {
    phase: string
    sourceType?: AgentToolSourceType
    serviceURL?: string
    conditions?: Array<{
      type: string
      status: string
      reason?: string
      message?: string
      lastTransitionTime?: string
    }>
  }
}

// ---- AgentResource CR ----

export type AgentResourceKind =
  | 'github-repo'
  | 'github-org'
  | 'gitlab-project'
  | 'gitlab-group'
  | 'git-repo'
  | 's3-bucket'
  | 'documentation'
  | 'kubernetes-cluster';

export interface AgentResourceBinding {
  name: string
  namespace: string
  kind: AgentResourceKind
  displayName: string
  description?: string
  phase: string
  readOnly: boolean
  autoContext: boolean
  hasCredentials: boolean
  github?: {
    owner: string
    repo: string
    defaultBranch?: string
    apiURL?: string
  }
  githubOrg?: {
    org: string
    repoFilter?: string[]
    apiURL?: string
  }
  gitlab?: {
    baseURL: string
    project: string
    defaultBranch?: string
  }
  gitlabGroup?: {
    baseURL: string
    group: string
    projects?: string[]
  }
}

/** Check if a resource kind supports file/commit/branch/MR/issue browsing */
export function isBrowsableResource(kind: AgentResourceKind): boolean {
  return kind === 'github-repo' || kind === 'gitlab-project';
}

/** Get the display icon type for a resource kind */
export function resourceKindIcon(kind: AgentResourceKind): 'github' | 'gitlab' | 'git' | 's3' | 'docs' | 'kubernetes' {
  switch (kind) {
    case 'github-repo':
    case 'github-org':
      return 'github';
    case 'gitlab-project':
    case 'gitlab-group':
      return 'gitlab';
    case 'git-repo':
      return 'git';
    case 's3-bucket':
      return 's3';
    case 'documentation':
      return 'docs';
    case 'kubernetes-cluster':
      return 'kubernetes';
  }
}

// ---- Git Forge Browser Types ----

export interface GitFile {
  name: string
  path: string
  type: 'file' | 'dir' | 'tree' | 'blob' | 'submodule' | 'symlink' // GitHub uses file/dir, GitLab uses tree/blob
  size?: number
  sha?: string
  id?: string // GitLab
}

export interface GitCommit {
  sha?: string         // GitHub
  id?: string          // GitLab
  short_id?: string    // GitLab
  message: string
  title?: string       // GitLab
  author_name?: string // GitLab
  authored_date?: string // GitLab
  committed_date?: string // GitLab
  commit?: {           // GitHub nested
    author: { name: string; email: string; date: string }
    committer: { name: string; email: string; date: string }
    message: string
  }
  author?: {           // GitHub top-level
    login?: string
    avatar_url?: string
  }
}

export interface GitBranch {
  name: string
  commit?: { sha?: string; id?: string }
  protected?: boolean
  default?: boolean   // GitLab
}

export interface GitMergeRequest {
  // Common
  title: string
  state: string
  // GitHub PR fields
  number?: number
  html_url?: string
  user?: { login: string; avatar_url?: string }
  created_at?: string
  updated_at?: string
  draft?: boolean
  // GitLab MR fields
  iid?: number
  web_url?: string
  author?: { username: string; avatar_url?: string }
  source_branch?: string
  target_branch?: string
}

export interface GitIssue {
  // Common
  title: string
  state: string
  // GitHub
  number?: number
  html_url?: string
  user?: { login: string; avatar_url?: string }
  labels?: Array<{ name: string; color?: string }>
  created_at?: string
  updated_at?: string
  // GitLab
  iid?: number
  web_url?: string
  author?: { username: string; avatar_url?: string }
}

export interface GitPipeline {
  // GitLab pipeline (GET /projects/:id/pipelines)
  id: number
  iid?: number
  status: string          // created, pending, running, success, failed, canceled, skipped, manual
  ref?: string
  sha?: string
  source?: string
  web_url?: string
  created_at?: string
  updated_at?: string
}

// ---- Work board (GitLab label-driven) ----

/** An issue as returned by the GitLab REST list endpoint (labels are strings). */
export interface GitBoardIssue {
  iid: number
  title: string
  description?: string
  state: string
  web_url?: string
  labels?: string[]
  author?: { username: string; name?: string; avatar_url?: string }
  assignees?: Array<{ username: string; name?: string; avatar_url?: string }>
  milestone?: { id: number; iid?: number; title: string; state?: string; due_date?: string; web_url?: string } | null
  created_at?: string
  updated_at?: string
}

/** A CI job within a pipeline (GET /projects/:id/pipelines/:pid/jobs). */
export interface GitJob {
  id: number
  name: string
  stage?: string
  status: string
  ref?: string
  web_url?: string
  duration?: number
  queued_duration?: number
  created_at?: string
  started_at?: string
  finished_at?: string
  allow_failure?: boolean
  failure_reason?: string
}

/** A single file diff within a merge request's changes. */
export interface GitDiffChange {
  old_path: string
  new_path: string
  new_file?: boolean
  renamed_file?: boolean
  deleted_file?: boolean
  diff: string
}

/** Full merge request with diff + merge-status fields (GET .../changes). */
export interface GitMergeRequestDetail extends GitMergeRequest {
  description?: string
  labels?: string[]
  sha?: string
  merge_status?: string
  detailed_merge_status?: string
  has_conflicts?: boolean
  changes_count?: string
  changes?: GitDiffChange[]
  diff_refs?: { base_sha?: string; head_sha?: string; start_sha?: string }
}

/** A discussion note on a merge request. */
export interface GitNote {
  id: number
  body: string
  system?: boolean
  created_at?: string
  updated_at?: string
  author?: { username: string; name?: string; avatar_url?: string }
}

// ---- GitLab group workspace (gitlab-group integration, group-wide) ----

/** A project within a GitLab group (GET /groups/:id/projects). */
export interface GitLabProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  description?: string
  web_url?: string
  avatar_url?: string
  default_branch?: string
  star_count?: number
  forks_count?: number
  open_issues_count?: number
  last_activity_at?: string
  archived?: boolean
  visibility?: string
  namespace?: { id: number; name: string; path: string; full_path?: string }
  statistics?: { commit_count?: number; repository_size?: number; storage_size?: number; job_artifacts_size?: number }
  topics?: string[]
  created_at?: string
  empty_repo?: boolean
}

/** Full project detail (GET /projects/:id?statistics=true) for the drill-down panel. */
export interface GitProjectDetail extends GitLabProject {
  tag_list?: string[]
  license?: { key?: string; name?: string; nickname?: string } | null
  readme_url?: string
  ci_config_path?: string
  open_issues_count?: number
  creator_id?: number
}

/** Language → percentage map (GET /projects/:id/languages). */
export type GitLanguages = Record<string, number>

/** A project release (GET /projects/:id/releases). */
export interface GitRelease {
  name?: string
  tag_name: string
  description?: string
  created_at?: string
  released_at?: string
  author?: { username: string; name?: string; avatar_url?: string }
  commit?: { id?: string; short_id?: string; title?: string }
  _links?: { self?: string }
}

/** A repository contributor (GET /projects/:id/repository/contributors). */
export interface GitContributor {
  name: string
  email?: string
  commits: number
  additions?: number
  deletions?: number
}

/** A milestone (GET /groups/:id/milestones). */
export interface GitMilestone {
  id: number
  iid?: number
  title: string
  description?: string
  state: string
  due_date?: string
  start_date?: string
  web_url?: string
  expired?: boolean
}

/** A trimmed pipeline (latest-per-project CI/CD health). */
export interface GitPipelineLite {
  id: number
  iid?: number
  status: string
  ref?: string
  sha?: string
  source?: string
  web_url?: string
  created_at?: string
  updated_at?: string
}

/** One project paired with its most-recent pipeline (GET /group/pipelines). */
export interface GroupProjectPipelineHealth {
  project_id: number
  project_name: string
  project_path: string
  web_url?: string
  default_branch?: string
  pipeline: GitPipelineLite | null
}

/**
 * A group-aggregated issue. Same shape as a board issue but always carries the
 * owning project_id (the key the board uses to route per-card actions back to
 * the right project via ?project=).
 */
export interface GitGroupIssue extends GitBoardIssue {
  id?: number
  project_id: number
  references?: { short?: string; relative?: string; full?: string }
}

/** A group-aggregated merge request (GET /groups/:id/merge_requests). */
export interface GitGroupMergeRequest extends GitMergeRequest {
  id?: number
  project_id: number
  labels?: string[]
  references?: { short?: string; relative?: string; full?: string }
  merge_status?: string
  detailed_merge_status?: string
  has_conflicts?: boolean
  draft?: boolean
  user_notes_count?: number
  pipeline?: { id?: number; status?: string; web_url?: string } | null
  head_pipeline?: { id?: number; status?: string; web_url?: string } | null
}

/** A GitLab label definition (group-level). */
export interface GitLabel {
  id: number
  name: string
  color?: string
  text_color?: string
  description?: string
  open_issues_count?: number
  open_merge_requests_count?: number
}

/** A GitLab group member. */
export interface GitMember {
  id: number
  username: string
  name?: string
  avatar_url?: string
  web_url?: string
  access_level?: number
  state?: string
}

/**
 * An Integration CR (raw, as returned by GET /integrations). Only the fields the
 * console consumes are typed; the gitlab-group config powers the workspace.
 */
export interface IntegrationResource {
  metadata: {
    name: string
    namespace: string
    creationTimestamp?: string
  }
  spec: {
    kind: string
    displayName?: string
    description?: string
    gitlabGroup?: {
      baseURL: string
      group: string
      projects?: string[]
      readOnly?: boolean
    }
    // A single gitlab-project workspace (equally first-class as a group board).
    gitlab?: {
      baseURL: string
      project: string
      defaultBranch?: string
    }
  }
  status?: {
    phase?: string
    message?: string
  }
}

/** A trimmed artifact in a GroupRunJoin (mirrors AgentRunArtifact). */
export interface GroupRunArtifact {
  kind: string
  url?: string
  ref?: string
  title?: string
}

/**
 * The merge-request + CI slice attached to a run join (collapses the
 * MR↔pipeline↔job relationship the board needs). Matched server-side on
 * source_branch == the run's feature branch.
 */
export interface GroupRunMR {
  iid: number
  projectID: number
  title?: string
  state?: string                 // opened | merged | closed | locked
  webURL?: string
  sourceBranch?: string
  targetBranch?: string
  draft?: boolean
  hasConflicts?: boolean
  detailedMergeStatus?: string
  pipelineID?: number
  pipelineStatus?: string        // success | failed | running | pending | …
  pipelineWebURL?: string
}

/**
 * Server-side run↔card join (GET /integrations/{ns}/{name}/group/runs). One
 * entry per (project, iid) work item — the most-recent AgentRun executing it,
 * with its Tempo traceID for cross-linking a card to its trace waterfall.
 */
export interface GroupRunJoin {
  iid: string
  project?: string
  target?: string
  trigger?: string
  run: string
  namespace: string
  agentRef: string
  phase: string
  created?: string
  traceID?: string
  branch?: string
  intent?: AgentRunIntent
  summary?: string
  artifacts?: GroupRunArtifact[]
  toolCalls?: number
  tokensUsed?: number
  model?: string
  /** Live MR + head-pipeline CI state, joined on branch (delivery edge). */
  mr?: GroupRunMR
  /** Console-dispatched CI-fix runs already spent on this work item's MR. */
  ciFixAttempts?: number
}

// ---- Resource Context (per-turn dynamic context sent to runtime) ----

export interface ResourceContext {
  resource_name: string        // AgentResource name
  kind: string                 // e.g. "github-repo"
  item_type: string            // file, commit, branch, issue, merge_request
  path?: string                // file path or branch name
  ref?: string                 // git ref
  title?: string               // issue/MR title
  number?: number              // issue/MR number
  sha?: string                 // commit SHA
  url?: string                 // web URL for the item
  description?: string         // extra description text
}

/** Unique key for a selected resource item (for deduplication) */
export function resourceContextKey(ctx: ResourceContext): string {
  // Kubernetes resources use kind=kubernetes
  if (ctx.kind === 'kubernetes') {
    return `k8s:${ctx.item_type}:${ctx.path || ctx.title || ''}`;
  }
  switch (ctx.item_type) {
    case 'file':
      return `${ctx.resource_name}:file:${ctx.path}:${ctx.ref || ''}`;
    case 'commit':
      return `${ctx.resource_name}:commit:${ctx.sha}`;
    case 'branch':
      return `${ctx.resource_name}:branch:${ctx.path}`;
    case 'issue':
      return `${ctx.resource_name}:issue:${ctx.number}`;
    case 'merge_request':
      return `${ctx.resource_name}:mr:${ctx.number}`;
    default:
      return `${ctx.resource_name}:${ctx.item_type}:${ctx.path || ctx.sha || ctx.number}`;
  }
}

// ---- Session (runtime token usage tracking) ----

// ---- Runtime Messages ----
// Mirrors the Go serializableMessage / serializablePartOK / serializableToolOutput types.

export interface RuntimeToolOutput {
  type: "text" | "error" | "media"
  text?: string
  error?: string
  data?: string
  media_type?: string
}

export interface RuntimeMessagePart {
  type: "text" | "reasoning" | "file" | "tool-call" | "tool-result" | "unknown"
  // text / reasoning
  text?: string
  // file
  filename?: string
  data?: string
  media_type?: string
  // tool-call
  tool_call_id?: string
  tool_name?: string
  input?: string
  provider_executed?: boolean
  // tool-result
  output?: RuntimeToolOutput
  metadata?: string // ClientMetadata JSON — renderer hints, duration, etc.
}

export interface RuntimeMessage {
  role: "user" | "assistant" | "tool"
  content: RuntimeMessagePart[]
}

// ---- Kubernetes ----

export interface NamespaceInfo {
  name: string
  agents: number
  runs: number
  channels: number
  agentTools: number
}

export interface PodInfo {
  name: string
  namespace: string
  phase: string
  ready: boolean
  restarts: number
  age: string
  containers: Array<{
    name: string
    image: string
    ready: boolean
  }>
}

// ---- Kubernetes Resource Browser Types ----

export interface K8sNamespace {
  name: string
  status: string
  age: string
}

export interface K8sNamespaceSummary {
  pods: number
  deployments: number
  statefulSets: number
  daemonSets: number
  jobs: number
  cronJobs: number
  services: number
  ingresses: number
  configMaps: number
  secrets: number
}

export interface K8sPod {
  name: string
  namespace: string
  phase: string
  ready: string
  restarts: number
  node: string
  age: string
  ip?: string
  containers: Array<{
    name: string
    image: string
    ready: boolean
    state: string
    reason?: string
  }>
  labels?: Record<string, string>
}

export interface K8sDeployment {
  name: string
  namespace: string
  ready: string
  upToDate: number
  available: number
  age: string
  images: string[]
  labels?: Record<string, string>
}

export interface K8sStatefulSet {
  name: string
  namespace: string
  ready: string
  age: string
  images: string[]
  labels?: Record<string, string>
}

export interface K8sDaemonSet {
  name: string
  namespace: string
  desired: number
  current: number
  ready: number
  available: number
  age: string
  labels?: Record<string, string>
}

export interface K8sJob {
  name: string
  namespace: string
  status: string
  succeeded: number
  failed: number
  age: string
  duration?: string
  labels?: Record<string, string>
}

export interface K8sCronJob {
  name: string
  namespace: string
  schedule: string
  suspend: boolean
  active: number
  lastSchedule?: string
  age: string
}

export interface K8sService {
  name: string
  namespace: string
  type: string
  clusterIP: string
  externalIP?: string
  ports: Array<{
    port: number
    targetPort: string
    protocol: string
    name?: string
  }>
  age: string
  selector?: Record<string, string>
  labels?: Record<string, string>
}

export interface K8sIngress {
  name: string
  namespace: string
  class?: string
  hosts: Array<{ host: string; path?: string }>
  tls: boolean
  age: string
  labels?: Record<string, string>
}

export interface K8sConfigMap {
  name: string
  namespace: string
  keys: string[]
  age: string
}

export interface K8sSecret {
  name: string
  namespace: string
  type: string
  keys: string[]
  age: string
}

export interface K8sEvent {
  type: string
  reason: string
  object: string
  message: string
  count: number
  firstSeen: string
  lastSeen: string
  source?: string
}

/** Kubernetes resource kind identifier for the browser */
export type K8sResourceKind =
  | 'pods'
  | 'deployments'
  | 'statefulsets'
  | 'daemonsets'
  | 'jobs'
  | 'cronjobs'
  | 'services'
  | 'ingresses'
  | 'configmaps'
  | 'secrets'
  | 'events';

// ---- Runtime Status ----

export interface RuntimeStatus {
  busy: boolean
  output: string
  model: string
  steps: number
  messages?: number
  turns?: number
  memory_enabled?: boolean
  context_budget?: import('./fep').ContextBudget
}

// ---- Memory (agentops-memory) ----

export interface MemoryEnabledResponse {
  enabled: boolean
  project: string
}

export type MemoryObservationType =
  | 'decision'
  | 'architecture'
  | 'bugfix'
  | 'pattern'
  | 'config'
  | 'discovery'
  | 'learning'
  | 'preference'
  | string  // Custom types allowed

export interface MemoryObservation {
  id: number
  session_id: string
  type: MemoryObservationType
  title: string
  content: string
  tags?: string[]
  project: string
  scope: string
  topic_key?: string
  normalized_hash?: string
  revision_count: number
  duplicate_count: number
  last_seen_at?: string
  promoted_to?: string
  created_at: string
  updated_at: string
}

export interface MemorySearchResult {
  id: number
  type: MemoryObservationType
  title: string
  content: string
  rank: number
  topic_key?: string
}

export interface MemorySession {
  id: string
  project: string
  started_at: string
  ended_at?: string
  summary?: string
  message_count: number
}

export interface MemoryContext {
  recent_observations: Array<{
    type: string
    title: string
    content: string
  }>
  recent_sessions: Array<{
    summary: string
  }>
}

export interface MemoryStats {
  total_sessions: number
  total_observations: number
  projects: string[]
}

// ---- Tempo Trace Types ----

/** A span from a Tempo trace response. */
export interface TraceSpan {
  traceID: string
  spanID: string
  parentSpanID?: string
  operationName: string
  serviceName?: string
  processID?: string
  startTime: number       // microseconds since epoch
  duration: number        // microseconds
  tags?: Array<{ key: string; type: string; value: unknown }>
  logs?: Array<{ timestamp: number; fields: Array<{ key: string; type?: string; value: unknown }> }>
  links?: Array<TraceSpanLink>
  status?: { code: number; message?: string }
}

/** A span link — used for cross-agent trace delegation. */
export interface TraceSpanLink {
  traceID: string
  spanID: string
  tags?: Array<{ key: string; type: string; value: unknown }>
}

/** A process/service in a Tempo trace. */
export interface TraceProcess {
  serviceName: string
  tags?: Array<{ key: string; type: string; value: unknown }>
}

/** Full trace response from Tempo (Jaeger format). */
export interface TempoTraceResponse {
  batches?: unknown[]   // OTLP format
  // Jaeger-compatible format (returned by Tempo by default):
  data?: Array<{
    traceID: string
    spans: TraceSpan[]
    processes: Record<string, TraceProcess>
  }>
}

/** A trace summary from Tempo search results, enriched by the BFF with delegation data. */
export interface TraceSearchResult {
  traceID: string
  rootServiceName?: string
  rootTraceName?: string
  startTimeUnixNano?: string
  durationMs?: number
  /** Tempo returns both spanSet (singular) and spanSets (plural) */
  spanSet?: {
    spans: Array<{
      spanID: string
      startTimeUnixNano: string
      durationNanos: string
      attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>
    }>
    matched?: number
  }
  spanSets?: Array<{
    spans: Array<{
      spanID: string
      startTimeUnixNano: string
      durationNanos: string
      attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>
    }>
    matched?: number
  }>
  // ── Delegation enrichment (from BFF AgentRun CRD lookup) ──
  /** Parent trace ID if this trace was created via delegation (source=agent) */
  parentTraceID?: string
  /** Name of the parent agent that delegated to this agent */
  parentAgent?: string
  /** Name of the agent that ran this trace (agentRef from AgentRun) */
  childAgent?: string
  /** Source of the run: "agent", "console", "channel", "schedule" */
  runSource?: string
}

/** Tempo search response envelope. */
export interface TempoSearchResponse {
  traces: TraceSearchResult[]
  metrics?: {
    totalBlocks?: number
    completedJobs?: number
    totalJobs?: number
  }
}
