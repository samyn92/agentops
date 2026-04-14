---
title: "CRD Reference"
linkTitle: "CRD Reference"
weight: 1
description: "Complete specification for all AgentOps Custom Resource Definitions."
---

All CRDs belong to the API group `agents.agentops.io/v1alpha1`. The operator installs them automatically via the Helm chart.

```bash
kubectl get crds | grep agentops
```

```
agents.agents.agentops.io
agentruns.agents.agentops.io
agenttools.agents.agentops.io
agentresources.agents.agentops.io
channels.agents.agentops.io
providers.agents.agentops.io
```

---

## Agent

Defines an AI agent workload. The `mode` field determines the lifecycle: **daemon** creates a Deployment + PVC + Service (always running), **task** creates a Job template (one prompt, exits).

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Agent
metadata:
  name: my-agent
  namespace: agents
```

**Short name:** `ag`

### spec

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mode` | `daemon` \| `task` | Yes | -- | Agent lifecycle mode. |
| `model` | string | Yes | -- | Primary model in `provider/model` format (e.g. `anthropic/claude-sonnet-4-20250514`). |
| `providerRefs` | []ProviderBinding | Yes (min 1) | -- | References to Provider CRs. See [Provider](#provider). |
| `providers` | []ProviderRef | No | -- | **Deprecated.** Inline LLM providers with API key secret references. Use `providerRefs` instead. |
| `image` | string | No | `ghcr.io/samyn92/agent-runtime-fantasy:latest` | Container image for the Fantasy agent runtime. |
| `imagePullPolicy` | `Always` \| `IfNotPresent` \| `Never` | No | `IfNotPresent` | Image pull policy. |
| `primaryProvider` | string | No | -- | Preferred provider name when the model string has no provider prefix. |
| `titleModel` | string | No | -- | Fast/cheap model for auto-titling sessions (daemon only). |
| `fallbackModels` | []string | No | -- | Fallback models tried in order if the primary fails. |
| `systemPrompt` | string | No | -- | System prompt injected at the start of every session. |
| `contextFiles` | []ContextFileRef | No | -- | Context files loaded from ConfigMaps (e.g. AGENTS.md). |
| `builtinTools` | []string | No | all defaults | Built-in tools to enable: `bash`, `read`, `edit`, `write`, `grep`, `ls`, `glob`, `fetch`. Set to `[]` to disable all. |
| `tools` | []AgentToolBinding | No | -- | Tool bindings referencing AgentTool CRs. |
| `permissionTools` | []string | No | -- | Tools requiring user approval before execution. |
| `enableQuestionTool` | bool | No | `false` | Enable the built-in "question" tool for interactive questions. |
| `env` | map[string]string | No | -- | Plain-text environment variables. |
| `secrets` | []SecretEnvVar | No | -- | Secret-backed environment variables. |
| `memory` | MemorySpec | No | -- | Memory configuration for agentops-memory integration. |
| `storage` | StorageSpec | No | -- | Persistent storage for daemon agents (PVC, RWO). Ignored for task mode. |
| `resourceBindings` | []AgentResourceBinding | No | -- | External resources bound to this agent. |
| `discovery` | DiscoverySpec | No | -- | Controls visibility to other agents and delegation access. |
| `toolHooks` | ToolHooksSpec | No | -- | Defense-in-depth runtime constraints on tool calls. |
| `concurrency` | ConcurrencySpec | No | -- | Concurrency control for parallel AgentRun execution. |
| `resources` | corev1.ResourceRequirements | No | -- | Compute resources for the agent container. |
| `serviceAccountName` | string | No | -- | ServiceAccount for the agent pod. |
| `timeout` | string | No | `10m` | Task job timeout or per-prompt timeout for daemons. |
| `maxSteps` | int | No | `100` | Maximum agent loop steps (safety limit). |
| `temperature` | float64 | No | -- | Temperature for model calls (0.0 - 2.0). |
| `maxOutputTokens` | int64 | No | -- | Maximum output tokens per model call. |
| `schedule` | string | No | -- | Cron schedule for creating periodic AgentRuns. |
| `schedulePrompt` | string | No | -- | Prompt used when schedule triggers an AgentRun. |
| `networkPolicy` | NetworkPolicySpec | No | -- | Network policy configuration. |

### spec.providerRefs[]

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Name of a Provider CR in the same namespace. |
| `overrides` | ProviderCallDefaults | No | Per-agent overrides for the provider's default call options. |

### spec.memory

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `serverRef` | string | Yes | -- | Reference to the memory server (AgentTool CR name or service name). |
| `project` | string | No | Agent CR name | Project name for scoping memories. |
| `contextLimit` | int | No | `5` | Number of recent context entries injected per turn (0-50). |
| `autoSummarize` | bool | No | `true` | Enable auto-summarization at session end. |
| `autoSave` | bool | No | `true` | Allow the agent to save memories via `mem_save`. |
| `autoSearch` | bool | No | `true` | Allow the agent to search memories via `mem_search`. |

### spec.discovery

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `description` | string | No | -- | Short description shown to other agents (max 500 chars). |
| `tags` | []string | No | -- | Tags for categorization and filtering (max 20). |
| `scope` | `namespace` \| `explicit` \| `hidden` | No | `namespace` | Visibility in `list_task_agents`. |
| `allowedCallers` | []string | No | -- | Agent names allowed to delegate (only when scope is `explicit`). |

### spec.concurrency

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `maxRuns` | int | No | `1` | Maximum concurrent runs. |
| `policy` | `queue` \| `reject` \| `replace` | No | `queue` | Policy when at max concurrency. |

### spec.toolHooks

| Field | Type | Description |
|-------|------|-------------|
| `blockedCommands` | []string | Patterns blocked in bash commands (substring match). |
| `allowedPaths` | []string | Restrict file tool paths to these prefixes. |
| `auditTools` | []string | Tools to audit-log via afterToolCall hook. |
| `memorySaveRules` | []MemorySaveRuleSpec | Declarative rules for auto-saving tool results as observations. |
| `contextInjectTools` | []ContextInjectRuleSpec | Pre-execution memory queries before matched tools run. |

### status

| Field | Type | Description |
|-------|------|-------------|
| `phase` | `Pending` \| `Running` \| `Ready` \| `Failed` | Current phase (Running = daemon, Ready = task). |
| `serviceURL` | string | Service URL for daemon agents (e.g. `http://agent.ns.svc:4096`). |
| `readyReplicas` | int32 | Number of ready replicas (daemon only). |
| `storagePVC` | string | Name of the PVC created for daemon agents. |
| `activeModel` | string | Currently active model (may differ if fallback triggered). |
| `conditions` | []Condition | Standard conditions: `Ready`, `ToolsReady`, `ProvidersReady`, `ResourcesReady`. |

---

## AgentRun

Tracks one execution of an Agent. Created by Channels, the `run_agent` delegation tool, schedules, or the console.

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentRun
metadata:
  name: my-run-abc123
  namespace: agents
```

**Short name:** `ar`

### spec

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `agentRef` | string | Yes | -- | Name of the Agent CR to run. |
| `prompt` | string | Yes | -- | Prompt to send to the agent. |
| `source` | `channel` \| `agent` \| `schedule` \| `console` | Yes | -- | What created this run. |
| `sourceRef` | string | No | -- | Name of the source (Channel name, agent name, or "schedule"). |
| `git` | AgentRunGitSpec | No | -- | Git workspace configuration for task agents. |

### spec.git

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `resourceRef` | string | Yes | -- | AgentResource CR name providing the repository URL and credentials. |
| `branch` | string | Yes | -- | Feature branch to work on. Created from baseBranch if it doesn't exist. |
| `baseBranch` | string | No | repo default | Base branch for the PR/MR target. |

### status

| Field | Type | Description |
|-------|------|-------------|
| `phase` | `Pending` \| `Queued` \| `Running` \| `Succeeded` \| `Failed` | Current phase. |
| `mode` | `daemon` \| `task` | Mode inherited from the target agent. |
| `output` | string | Textual output from the agent run. |
| `startTime` | Time | When execution started. |
| `completionTime` | Time | When execution completed. |
| `jobName` | string | Job name (task mode only). |
| `toolCalls` | int | Number of tool calls made. |
| `tokensUsed` | int | Total tokens consumed. |
| `cost` | string | Estimated cost in USD. |
| `model` | string | Actual model used. |
| `traceID` | string | OpenTelemetry trace ID (hex-encoded 128-bit). |
| `pullRequestURL` | string | PR/MR URL (when `spec.git` is set). |
| `commits` | int | Number of commits pushed. |
| `branch` | string | Git branch the agent worked on. |
| `conditions` | []Condition | Standard conditions: `Complete`. |

---

## AgentTool

Unified tool catalog entry. Defines a tool by what it does, not how it's delivered. Exactly one source block must be set.

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: kubectl
  namespace: agents
```

**Short name:** `agtool`

### spec

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | No | Human-friendly description shown in the console UI. |
| `category` | string | No | Category for console UI grouping (e.g. `infrastructure`, `coding`, `data`). |
| `uiHint` | string | No | Branded card renderer hint. Known values: `kubernetes-resources`, `helm-release`, `terminal`, `code`, `diff`, `file-tree`, `search-results`, `file-created`, `web-fetch`, `agent-run`. |
| `defaultPermissions` | ToolPermissions | No | Default permission configuration for this tool. |

### Source blocks (exactly one required)

#### spec.oci

OCI artifact containing an MCP tool server binary. Pulled via crane init container, launched as stdio MCP server.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ref` | string | Yes | Full OCI reference (e.g. `ghcr.io/samyn92/agent-tools/kubectl:0.3.3`). |
| `digest` | string | No | Optional digest for pinning. |
| `pullPolicy` | `Always` \| `IfNotPresent` \| `Never` | No | Pull policy. |
| `pullSecret` | SecretKeyRef | No | Pull secret for private registries. |

#### spec.configMap

Tool script mounted from a ConfigMap at `/tools/<name>`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | ConfigMap name. |
| `key` | string | Yes | Key within the ConfigMap. |

#### spec.inline

Inline tool content (< 4KB, prototyping only). Operator creates a ConfigMap, mounted at `/tools/<name>`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Tool script content. |

#### spec.mcpServer

MCP server deployed by the operator as a Deployment + Service. Agents connect via the gateway sidecar.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `image` | string | Yes | -- | Container image for the MCP server. |
| `port` | int32 | No | `8080` | Port the MCP server listens on. |
| `command` | []string | No | -- | Override command for the container. |
| `env` | map[string]string | No | -- | Plain-text environment variables. |
| `secrets` | []SecretEnvVar | No | -- | Secret-backed environment variables. |
| `serviceAccountName` | string | No | -- | ServiceAccount for the MCP server pod. |
| `resources` | ResourceRequirements | No | -- | Compute resources. |
| `healthCheck` | MCPHealthCheck | No | -- | Health check configuration. |

#### spec.mcpEndpoint

External MCP endpoint. Operator health-checks, agents connect via the gateway sidecar.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | -- | URL of the external MCP server. |
| `transport` | `sse` \| `streamable-http` | No | `sse` | Transport type. |
| `headers` | map[string]string | No | -- | Static headers. |
| `oauth` | MCPOAuthConfig | No | -- | OAuth configuration. |
| `healthCheck` | MCPHealthCheck | No | -- | Health check configuration. |

#### spec.skill

OCI artifact containing skill markdown (system prompt extensions). Pulled via crane init container, mounted as context files.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ref` | string | Yes | Full OCI reference for the skill package. |
| `digest` | string | No | Optional digest for pinning. |
| `pullPolicy` | `Always` \| `IfNotPresent` \| `Never` | No | Pull policy. |
| `pullSecret` | SecretKeyRef | No | Pull secret for private registries. |

### status

| Field | Type | Description |
|-------|------|-------------|
| `phase` | `Pending` \| `Deploying` \| `Ready` \| `Failed` | Current phase. `Deploying` applies to mcpServer source only. |
| `sourceType` | string | Detected source type: `oci`, `configMap`, `inline`, `mcpServer`, `mcpEndpoint`, `skill`. |
| `serviceURL` | string | Service URL for mcpServer/mcpEndpoint sources. |
| `tools` | []DiscoveredTool | MCP tools discovered via ListTools introspection. |
| `conditions` | []Condition | Standard conditions: `Ready`. |

---

## AgentResource

Declarative catalog entry for an external resource (Git repo, GitLab group, S3 bucket, documentation) that agents can work with. Agents bind to resources via `spec.resourceBindings`, and users can select them in the console UI to scope prompts.

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentResource
metadata:
  name: my-repo
  namespace: agents
```

**Short name:** `ares`

### spec

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `github-repo` \| `github-org` \| `gitlab-project` \| `gitlab-group` \| `git-repo` \| `s3-bucket` \| `documentation` | Yes | Kind of resource. |
| `displayName` | string | Yes | Human-friendly display name shown in the console UI. |
| `description` | string | No | Optional description for UI tooltips. |
| `credentials` | SecretKeyRef | No | Credentials for accessing the resource. |

### Kind-specific configuration

Exactly one of the following blocks must be set, matching the `kind` field.

#### spec.github (kind: github-repo)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | Yes | Repository owner (user or org). |
| `repo` | string | Yes | Repository name. |
| `defaultBranch` | string | No | Default branch (uses repo default if unset). |
| `apiURL` | string | No | GitHub API base URL (for GitHub Enterprise). |

#### spec.githubOrg (kind: github-org)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `org` | string | Yes | Organization name. |
| `repoFilter` | []string | No | Glob patterns to include specific repos. |
| `apiURL` | string | No | GitHub API base URL. |

#### spec.gitlab (kind: gitlab-project)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseURL` | string | Yes | GitLab base URL (e.g. `https://gitlab.com`). |
| `project` | string | Yes | Project path (e.g. `group/subgroup/project`). |
| `defaultBranch` | string | No | Default branch. |

#### spec.gitlabGroup (kind: gitlab-group)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseURL` | string | Yes | GitLab base URL. |
| `group` | string | Yes | Group path (e.g. `myorg` or `myorg/subgroup`). |
| `projects` | []string | No | Filter to specific projects. |

#### spec.git (kind: git-repo)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Git clone URL (HTTPS or SSH). |
| `branch` | string | No | Default branch. |
| `sshKeySecret` | SecretKeyRef | No | SSH private key secret. |

#### spec.s3 (kind: s3-bucket)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucket` | string | Yes | Bucket name. |
| `region` | string | No | AWS region. |
| `endpoint` | string | No | Endpoint URL for S3-compatible storage (e.g. MinIO). |
| `prefix` | string | No | Prefix to scope access within the bucket. |

#### spec.documentation (kind: documentation)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `urls` | []string | No | URLs to documentation pages. |
| `configMapRef` | SecretKeyRef | No | ConfigMap containing documentation content. |

### status

| Field | Type | Description |
|-------|------|-------------|
| `phase` | `Pending` \| `Ready` \| `Failed` | Current phase. |
| `conditions` | []Condition | Standard conditions: `Ready`. |

---

## Channel

Universal external ingress. Bridges external platforms to Agents. Supports chat platforms (Telegram, Slack, Discord) and event-driven webhooks (GitHub, GitLab, generic webhook).

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Channel
metadata:
  name: my-webhook
  namespace: agents
```

**Short name:** `ch`

### spec

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `telegram` \| `slack` \| `discord` \| `gitlab` \| `github` \| `webhook` | Yes | -- | Channel type. |
| `agentRef` | string | Yes | -- | Name of the Agent CR to target. |
| `image` | string | Yes | -- | Container image for the channel bridge. |
| `imagePullPolicy` | `Always` \| `IfNotPresent` \| `Never` | No | `IfNotPresent` | Image pull policy. |
| `replicas` | int32 | No | `1` | Number of replicas for the channel bridge. |
| `resources` | ResourceRequirements | No | -- | Compute resources for the channel container. |
| `prompt` | string | No | -- | Go `text/template` rendered with event data. Required for event-driven types. |
| `webhook` | WebhookIngressConfig | No | -- | Webhook ingress configuration (host, TLS). |

### Platform configuration (exactly one, matching type)

#### spec.telegram

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botTokenSecret` | SecretKeyRef | Yes | Secret containing the bot token. |
| `allowedUsers` | []string | No | Allowed Telegram user IDs. |
| `allowedChats` | []string | No | Allowed Telegram chat IDs. |

#### spec.slack

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botTokenSecret` | SecretKeyRef | Yes | Secret containing the bot token. |
| `allowedChannels` | []string | No | Allowed Slack channel IDs. |

#### spec.discord

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botTokenSecret` | SecretKeyRef | Yes | Secret containing the bot token. |
| `allowedChannels` | []string | No | Allowed Discord channel IDs. |

#### spec.gitlab

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `events` | []string | Yes | GitLab webhook events (e.g. `Issue Hook`). |
| `actions` | []string | No | Filter by action (e.g. `open`). |
| `labels` | []string | No | Filter by labels on the object. |
| `secret` | SecretKeyRef | Yes | Webhook secret for signature verification. |

#### spec.github

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `events` | []string | Yes | GitHub webhook events (e.g. `pull_request`). |
| `actions` | []string | No | Filter by action (e.g. `opened`, `synchronize`). |
| `labels` | []string | No | Filter by labels on the object. |
| `secret` | SecretKeyRef | Yes | Webhook secret for signature verification. |

#### spec.webhookConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `secret` | SecretKeyRef | No | Optional HMAC secret for signature verification. |

### spec.webhook (ingress)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | string | Yes | Hostname for the ingress. |
| `path` | string | No | Path (defaults to `/`). |
| `ingressClassName` | string | No | Ingress class name. |
| `tls.clusterIssuer` | string | No | cert-manager cluster issuer name. |

### status

| Field | Type | Description |
|-------|------|-------------|
| `phase` | `Pending` \| `Ready` \| `Failed` | Current phase. |
| `serviceURL` | string | Internal service URL. |
| `webhookURL` | string | External webhook URL (if ingress configured). |
| `conditions` | []Condition | Standard conditions: `Ready`. |

---

## Provider

Shared LLM provider configuration. Extracts provider type, credentials, endpoint, and per-call defaults into a reusable resource that multiple agents can reference via `spec.providerRefs`. The operator validates the referenced Secret on reconcile and reports readiness via status conditions.

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Provider
metadata:
  name: my-provider
  namespace: agents
```

**Short name:** `prov`

### spec

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `anthropic` \| `openai` \| `google` \| `azure` \| `bedrock` \| `openrouter` \| `openaicompat` | Yes | -- | Fantasy SDK backend. |
| `apiKeySecret` | SecretKeyRef | Yes | -- | Secret containing the API key. |
| `endpoint` | ProviderEndpoint | No | -- | API endpoint overrides. |
| `config` | ProviderConfig | No | -- | Type-specific configuration. |
| `defaults` | ProviderCallDefaults | No | -- | Default per-call options for all agents using this provider. |

### spec.endpoint

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `baseURL` | string | No | SDK default | Base URL override. Required for `openaicompat`. |
| `headers` | map[string]string | No | -- | Custom HTTP headers injected into every API request. |

### spec.config

Only fields relevant to `spec.type` are used; others are ignored.

| Field | Type | Applies to | Description |
|-------|------|------------|-------------|
| `organization` | string | `openai` | OpenAI organization ID (sets `OpenAI-Organization` header). |
| `project` | string | `openai` | OpenAI project ID (sets `OpenAI-Project` header). |
| `useResponsesAPI` | bool | `openai`, `azure`, `openaicompat` | Use the OpenAI Responses API. |
| `azureAPIVersion` | string | `azure` | Azure OpenAI API version (default: `2025-01-01-preview`). |
| `vertex` | VertexConfig | `anthropic`, `google` | Vertex AI configuration. |
| `bedrock` | bool | `anthropic`, `bedrock` | Enable AWS Bedrock mode. |

### spec.config.vertex

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project` | string | Yes | GCP project ID. |
| `location` | string | Yes | GCP region (e.g. `us-central1`). |

### spec.defaults

Per-call options applied to every agent using this provider. Agents can override these via `providerRefs[].overrides`. Only the block matching `spec.type` is used.

| Field | Type | Applies to | Description |
|-------|------|------------|-------------|
| `anthropic` | AnthropicCallDefaults | `anthropic`, `bedrock` | Anthropic-specific call defaults. |
| `openai` | OpenAICallDefaults | `openai`, `azure`, `openaicompat` | OpenAI-specific call defaults. |
| `google` | GoogleCallDefaults | `google` | Google-specific call defaults. |

### spec.defaults.anthropic

| Field | Type | Description |
|-------|------|-------------|
| `effort` | `low` \| `medium` \| `high` \| `max` | Extended thinking effort level. |
| `thinkingBudgetTokens` | int64 | Maximum tokens for extended thinking. |
| `disableParallelToolUse` | bool | Disable parallel tool calls. |

### spec.defaults.openai

| Field | Type | Description |
|-------|------|-------------|
| `reasoningEffort` | `low` \| `medium` \| `high` | Reasoning effort for o-series models. |
| `serviceTier` | string | OpenAI service tier (e.g. `auto`, `flex`). |

### spec.defaults.google

| Field | Type | Description |
|-------|------|-------------|
| `thinkingLevel` | `LOW` \| `MEDIUM` \| `HIGH` \| `MINIMAL` | Gemini thinking level. |
| `thinkingBudgetTokens` | int64 | Maximum tokens for thinking. Mutually exclusive with `thinkingLevel`. |
| `safetySettings` | []GoogleSafetySetting | Content safety thresholds. |

### spec.defaults.google.safetySettings[]

| Field | Type | Description |
|-------|------|-------------|
| `category` | string | Harm category (e.g. `HARM_CATEGORY_HATE_SPEECH`, `HARM_CATEGORY_DANGEROUS_CONTENT`). |
| `threshold` | string | Block threshold (e.g. `BLOCK_NONE`, `BLOCK_ONLY_HIGH`, `BLOCK_MEDIUM_AND_ABOVE`). |

### status

| Field | Type | Description |
|-------|------|-------------|
| `phase` | `Pending` \| `Ready` \| `Failed` | Current phase. `Ready` when the referenced Secret exists and contains the expected key. |
| `message` | string | Human-readable status message. |
| `boundAgents` | int | Number of Agent CRs referencing this provider via `providerRefs`. |
| `conditions` | []Condition | Standard conditions: `Ready`. |

---

## Shared types

### SecretKeyRef

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Name of the Secret. |
| `key` | string | Key within the Secret. |

### SecretEnvVar

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Environment variable name. |
| `secretRef` | SecretKeyRef | Reference to the secret key. |

### AgentToolBinding

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Name of the AgentTool CR. |
| `permissions` | MCPPermissions | Override permissions from AgentTool defaults. |
| `directTools` | []string | MCP tools to promote to first-class (mcpServer/mcpEndpoint only). |
| `autoContext` | bool | Auto-inject skill content into every prompt (skill sources only). |

### AgentResourceBinding

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Name of the AgentResource CR to bind. |
| `readOnly` | bool | Mark the resource as read-only (advisory, enforced by runtime). |
| `autoContext` | bool | Auto-inject resource context into every prompt. |

### ProviderBinding

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Name of the Provider CR in the same namespace. |
| `overrides` | ProviderCallDefaults | Per-agent overrides for the provider's call defaults. |
