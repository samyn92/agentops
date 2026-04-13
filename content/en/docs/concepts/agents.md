---
title: "Agents"
linkTitle: "Agents"
weight: 1
description: "Agent CRD, lifecycle modes, delegation, concurrency control, and what the operator creates."
---

An **Agent** is the central CRD in AgentOps. It declares everything the operator needs to run an AI agent as a Kubernetes workload: which model to use, what tools are available, how memory works, who can delegate to it, and what safety guardrails to enforce.

## Agent CRD spec

The Agent CRD (`agents.agents.agentops.io`, short name `ag`) carries the full agent definition. Here is a representative example:

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Agent
metadata:
  name: platform-engineer
  namespace: agents
spec:
  # ── Lifecycle ──
  mode: daemon                    # daemon (always-on) or task (one-shot)

  # ── Model ──
  model: anthropic/claude-sonnet-4-20250514
  fallbackModels:
    - openai/gpt-4o
  titleModel: openai/gpt-4o-mini  # cheap model for auto-titling sessions
  providerRefs:
    - name: anthropic
    - name: openai

  # ── Identity ──
  systemPrompt: |
    You are a senior platform engineer specializing in Kubernetes,
    GitOps, and infrastructure automation.
  contextFiles:
    - configMapRef:
        name: platform-context
        key: AGENTS.md

  # ── Built-in tools ──
  builtinTools:
    - bash
    - read
    - edit
    - write
    - grep
    - glob
    - fetch

  # ── External tools (AgentTool CRs) ──
  tools:
    - name: kubectl
      permissions:
        mode: deny
        rules: ["kubectl_delete", "kubectl_scale"]
    - name: flux
    - name: git

  # ── Memory ──
  memory:
    serverRef: agentops-memory         # service name or AgentTool CR
    project: platform-engineer
    contextLimit: 5                    # observations injected per turn
    windowSize: 20                     # working memory sliding window
    autoSummarize: true
    autoSave: true
    autoSearch: true

  # ── Discovery & delegation ──
  discovery:
    description: "Kubernetes and GitOps specialist. Handles cluster operations, Helm releases, Flux reconciliation, and infrastructure debugging."
    tags: ["kubernetes", "gitops", "infrastructure"]
    scope: namespace                   # namespace | explicit | hidden
    # allowedCallers: [...]            # only used with scope: explicit

  # ── Safety ──
  toolHooks:
    blockedCommands:
      - "rm -rf /"
      - "kubectl delete namespace"
    allowedPaths:
      - "/workspace"
      - "/tmp"
  maxSteps: 100                        # safety limit on agent loop iterations
  timeout: "10m"                       # per-prompt timeout

  # ── Infrastructure ──
  image: ghcr.io/samyn92/agent-runtime-fantasy:latest
  resources:
    requests:
      memory: "256Mi"
      cpu: "100m"
    limits:
      memory: "1Gi"
  storage:
    size: "10Gi"
  env:
    LOG_LEVEL: "info"
  secrets:
    - name: GITHUB_TOKEN
      secretRef:
        name: agent-tokens
        key: github-token
```

### Spec reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `daemon` / `task` | required | Lifecycle mode. Daemon = Deployment, task = Job template. |
| `model` | string | required | Primary model in `provider/model` format. |
| `fallbackModels` | []string | `[]` | Tried in order if the primary model fails. |
| `titleModel` | string | primary model | Cheap model for auto-titling daemon sessions. |
| `providers` | -- | -- | _Removed._ Use `providerRefs` to reference Provider CRs. |
| `providerRefs` | []ProviderBinding | required (min 1) | References to [Provider]({{< relref "providers" >}}) CRs with optional per-agent call default overrides. |
| `systemPrompt` | string | `""` | Injected at the start of every session. |
| `contextFiles` | []ContextFileRef | `[]` | ConfigMap-backed context files (e.g. AGENTS.md). |
| `builtinTools` | []string | all defaults | Built-in Fantasy tools: `bash`, `read`, `edit`, `write`, `grep`, `ls`, `glob`, `fetch`. Set to `[]` to disable all. |
| `tools` | []AgentToolBinding | `[]` | References to AgentTool CRs with optional permission overrides. |
| `permissionTools` | []string | `[]` | Tools requiring user approval before execution. |
| `enableQuestionTool` | bool | `false` | Allow the agent to ask interactive questions. |
| `memory` | MemorySpec | nil | Memory configuration (see [Memory]({{< relref "memory" >}})). |
| `discovery` | DiscoverySpec | nil | Controls delegation visibility and access. |
| `toolHooks` | ToolHooksSpec | nil | Blocked commands, allowed paths, audit tools, memory save rules. |
| `maxSteps` | int | `100` | Maximum agent loop iterations (prevents infinite loops). |
| `timeout` | string | `"10m"` | Per-prompt timeout for daemons, job timeout for tasks. |
| `image` | string | `ghcr.io/samyn92/agent-runtime-fantasy:latest` | Runtime container image. |
| `resources` | ResourceRequirements | nil | CPU/memory requests and limits. |
| `storage` | StorageSpec | nil | PVC config for daemon agents (ignored for tasks). |
| `concurrency` | ConcurrencySpec | nil | Controls parallel AgentRun execution. |
| `networkPolicy` | NetworkPolicySpec | nil | Whether to create a NetworkPolicy for this agent. |
| `schedule` | string | `""` | Cron expression for periodic AgentRuns. |
| `schedulePrompt` | string | `""` | Prompt used when schedule triggers a run. |
| `resourceBindings` | []AgentResourceBinding | `[]` | External resources (repos, buckets) bound to this agent. |

## Lifecycle modes

### Daemon mode

A daemon agent is a **long-running Deployment** with a Service and optional PVC. It stays up, accepts prompts via HTTP POST on port 4096, and maintains a conversation session with working memory.

The operator creates:
- **Deployment** (1 replica) with the Fantasy runtime container
- **Service** (ClusterIP, port 4096) for receiving prompts
- **PVC** (if `storage` is set) mounted at `/data` for checkpoints
- **ConfigMap** containing the rendered system prompt
- **ServiceAccount** with RBAC scoped to the agent's needs
- **NetworkPolicy** (if enabled)
- **MCP gateway sidecar** (if tools with `mcpServer`/`mcpEndpoint` sources are bound)
- **Init containers** for OCI tool pulling (one per OCI-sourced AgentTool)

When an AgentRun targets a daemon agent, the operator sends the prompt via HTTP POST to the agent's service. The runtime processes it within the existing session context.

### Task mode

A task agent is a **Job template**. It does not create any Deployment at startup. Instead, each AgentRun creates a new Kubernetes Job:

1. An AgentRun CR is created (by a Channel, delegation, schedule, or the console).
2. The operator resolves the referenced Agent and builds a Job spec from it.
3. The Job runs: the runtime receives the prompt, processes it, writes output to `status.output`, and exits.
4. The operator updates the AgentRun status with output, token usage, cost, and trace ID.

Task agents are ideal for batch work, CI/CD integration, and delegation targets.

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentRun
metadata:
  name: review-pr-42
  namespace: agents
spec:
  agentRef: code-reviewer        # references an Agent CR (task mode)
  prompt: "Review PR #42 on samyn92/agentops-core"
  source: channel                # who created this: channel, agent, schedule, console
  sourceRef: github-prs
  git:
    resourceRef: agentops-core   # AgentResource CR (github-repo)
    branch: feature/new-crd
    baseBranch: main
```

### AgentRun status

The AgentRun status captures the full execution record:

| Field | Description |
|-------|-------------|
| `phase` | `Pending` -> `Queued` -> `Running` -> `Succeeded` / `Failed` |
| `mode` | Inherited from the target agent (`daemon` or `task`) |
| `jobName` | Kubernetes Job name (task mode only) |
| `output` | Textual output from the agent |
| `toolCalls` | Number of tool calls made |
| `tokensUsed` | Total tokens consumed |
| `cost` | Estimated cost in USD |
| `model` | Actual model used (may differ from primary if fallback triggered) |
| `traceID` | OpenTelemetry trace ID (hex-encoded 128-bit) |
| `pullRequestURL` | PR/MR URL (when `spec.git` is set) |
| `commits` | Number of commits pushed |
| `branch` | Git branch the agent worked on |

### Git workspace support

When `spec.git` is set on an AgentRun, the operator configures the Job to:

1. Clone the repository referenced by the AgentResource CR (`resourceRef`).
2. Check out or create the feature branch (`branch`).
3. Make the workspace available to the runtime at `/workspace`.
4. The agent works on the branch, can commit, push, and create PRs/MRs using git and GitHub/GitLab MCP tools.

## Discovery and delegation

Agents can discover and delegate work to other task agents. This enables multi-agent architectures where a daemon orchestrator delegates specialized subtasks to purpose-built task agents.

### Discovery scope

The `discovery.scope` field controls who can see this agent in the `list_task_agents` runtime tool:

| Scope | Behavior |
|-------|----------|
| `namespace` (default) | Visible to all agents in the same namespace |
| `explicit` | Visible only to agents listed in `allowedCallers` |
| `hidden` | Never appears in `list_task_agents` |

### How delegation works

1. The orchestrator agent calls the `list_task_agents` built-in tool, optionally filtering by tags.
2. The runtime queries the Kubernetes API for Agent CRs with `mode: task` and compatible discovery scope.
3. The orchestrator selects a specialist and calls the `run_agent` built-in tool with a prompt.
4. The runtime creates an AgentRun CR. The operator creates a Job.
5. The orchestrator can poll or wait for the AgentRun to complete, then reads `status.output`.

### Tags

Tags on `discovery.tags` allow agents to advertise their specialization:

```yaml
discovery:
  description: "Security scanner and CVE analyst."
  tags: ["security", "scanning", "cve"]
  scope: namespace
```

Other agents can filter by tags when discovering specialists, narrowing results to the right domain.

## Concurrency control

The `concurrency` spec controls how many AgentRuns can execute in parallel for a given agent, and what happens when the limit is reached:

```yaml
concurrency:
  maxRuns: 3
  policy: queue    # queue | reject | replace
```

| Policy | Behavior |
|--------|----------|
| `queue` (default) | New runs enter `Queued` phase, start when a slot opens |
| `reject` | New runs immediately fail with a concurrency error |
| `replace` | The oldest running AgentRun is cancelled, new one starts |

The operator tracks active runs using labels on AgentRun resources. The label `agents.agentops.io/agent-ref` on each AgentRun maps it to its parent Agent, enabling efficient counting without list-all queries.

## What the operator creates

For each Agent CR, the operator reconciles the following Kubernetes resources:

| Resource | Daemon | Task | Purpose |
|----------|--------|------|---------|
| Deployment | yes | no | Long-running agent pod |
| Job | no | per-run | One-shot execution per AgentRun |
| Service | yes | no | ClusterIP on port 4096 |
| PVC | if `storage` set | no | Persistent workspace + checkpoints |
| ConfigMap | yes | yes | Rendered system prompt + context files |
| ServiceAccount | yes | yes | Per-agent identity for RBAC |
| Role + RoleBinding | yes | yes | Scoped permissions (e.g. list agents for delegation) |
| NetworkPolicy | if enabled | if enabled | Network isolation |
| MCP gateway sidecar | if needed | if needed | Permission-enforcing proxy for MCP server/endpoint tools |
| Init containers | if OCI tools | if OCI tools | Pull OCI tool artifacts via crane |

### Status conditions

The operator sets conditions on the Agent status to indicate readiness:

| Condition | Meaning |
|-----------|---------|
| `Ready` | Agent is fully operational |
| `ToolsReady` | All bound AgentTools are in Ready phase |
| `ProvidersReady` | All LLM provider secrets are resolved |
| `ResourcesReady` | All resource bindings are resolved |

```
$ kubectl get agents -n agents
NAME                 MODE     MODEL                                  PHASE     AGE
platform-engineer    daemon   anthropic/claude-sonnet-4-20250514     Running   5d
code-reviewer        task     anthropic/claude-sonnet-4-20250514     Ready     3d
security-scanner     task     openai/gpt-4o                          Ready     2d
```
