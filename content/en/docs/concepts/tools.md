---
title: "Tools"
linkTitle: "Tools"
weight: 3
description: "MCP tool servers, OCI artifact distribution, gateway sidecar, and built-in tool servers."
---

Tools extend what an agent can do beyond generating text. AgentOps uses the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) for tool integration. MCP tools are compiled Go binaries that communicate over stdio — no HTTP servers, no network hops for tool calls within the pod.

The **AgentTool** CRD (`agents.agents.agentops.io/agenttools`, short name `agtool`) defines the tool catalog. The operator provisions tools based on their source type, and the Fantasy runtime spawns them at startup.

## AgentTool CRD

The AgentTool CRD supports six source types. Exactly one source block must be set per CR:

| Source | Description | How it's delivered |
|--------|-------------|-------------------|
| `oci` | OCI artifact containing an MCP tool server binary | Init container pulls via crane, runtime spawns on stdio |
| `configMap` | Tool script stored in a ConfigMap | Mounted as a volume at `/tools/<name>` |
| `inline` | Inline tool content (< 4KB, prototyping) | Operator creates a ConfigMap, mounted at `/tools/<name>` |
| `mcpServer` | Operator-deployed MCP server (Deployment + Service) | Agent connects via MCP gateway sidecar |
| `mcpEndpoint` | External MCP server URL | Agent connects via MCP gateway sidecar |
| `skill` | OCI artifact containing skill markdown | Pulled via crane, injected as system prompt context |

### OCI source example

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: kubectl
  namespace: agents
spec:
  description: "Kubernetes kubectl operations with readonly and readwrite modes"
  category: infrastructure
  uiHint: kubernetes-resources
  oci:
    ref: ghcr.io/samyn92/agent-tools/kubectl:1.0.0
    pullPolicy: IfNotPresent
  defaultPermissions:
    mode: deny
    rules:
      - "kubectl_delete"
      - "kubectl_scale"
```

### MCP server source example

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: custom-data-tool
  namespace: agents
spec:
  description: "Custom data processing tool"
  category: data
  mcpServer:
    image: ghcr.io/myorg/data-tool:2.0.0
    port: 8080
    env:
      DATABASE_URL: "postgres://..."
    secrets:
      - name: API_KEY
        secretRef:
          name: data-tool-secrets
          key: api-key
    resources:
      requests:
        memory: "128Mi"
    healthCheck:
      path: /health
      intervalSeconds: 30
```

### MCP endpoint source example

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: external-search
  namespace: agents
spec:
  description: "External search API"
  category: search
  mcpEndpoint:
    url: https://search.example.com/mcp
    transport: streamable-http    # sse | streamable-http
    headers:
      X-Source: agentops
    oauth:
      clientIdSecret:
        name: search-oauth
        key: client-id
      clientSecretSecret:
        name: search-oauth
        key: client-secret
```

### Binding tools to agents

Agents reference AgentTool CRs via `spec.tools` with optional per-agent permission overrides:

```yaml
# In the Agent CR
spec:
  tools:
    - name: kubectl
      permissions:              # override AgentTool defaults
        mode: allow
        rules:
          - "kubectl_get"
          - "kubectl_describe"
          - "kubectl_logs"
    - name: git                 # inherit default permissions
    - name: external-search
      directTools:              # promote specific MCP tools to first-class
        - "web_search"
        - "document_search"
```

## OCI artifact format

MCP tool servers are packaged as OCI artifacts using the `agent-tools` CLI. The artifact structure:

```
OCI Manifest
├── mediaType: application/vnd.oci.image.manifest.v1+json
├── layers[0]:
│   ├── mediaType: application/vnd.agents.io.mcp-tool.v1
│   └── content: tar+gzip archive containing:
│       ├── manifest.json       # tool metadata
│       ├── mcp-kubectl         # compiled binary (or whatever the tool is named)
│       └── kubectl             # co-bundled CLI binary (optional)
```

### manifest.json

Every OCI tool artifact must include a `manifest.json` that describes how to run the tool:

```json
{
  "name": "kubectl",
  "command": "mcp-kubectl",
  "transport": "stdio",
  "description": "Kubernetes kubectl operations with readonly and readwrite modes."
}
```

| Field | Description |
|-------|-------------|
| `name` | Tool server name (used for logging and identification) |
| `command` | Binary name to execute within the extracted directory |
| `transport` | MCP transport type — always `stdio` for OCI tools |
| `description` | Human-readable description |

## How tools are loaded

The operator builds the tool loading pipeline at reconcile time:

```
AgentTool CR (oci source)
       │
       ▼
Operator adds init container to agent pod spec:
  - image: gcr.io/go-containerregistry/crane
  - command: crane export <oci-ref> | tar -xz -C /tools/<name>/
       │
       ▼
Agent pod starts. Runtime reads /tools/<name>/manifest.json
       │
       ▼
Runtime spawns: /tools/<name>/<command> (stdio)
       │
       ▼
MCP client connects over stdin/stdout.
Tool calls flow: Runtime → stdio → MCP server binary → stdio → Runtime
```

For `mcpServer` and `mcpEndpoint` sources, the flow is different — the agent connects via the MCP gateway sidecar over HTTP.

## MCP gateway sidecar

When an agent binds tools with `mcpServer` or `mcpEndpoint` sources, the operator injects an **MCP gateway sidecar** container into the agent pod. The gateway:

1. **Proxies MCP calls** between the runtime and remote MCP servers using Streamable HTTP transport.
2. **Enforces permissions** — the per-agent permission rules (`deny`/`allow` with tool-level rules) are evaluated in the gateway before forwarding.
3. **Health-checks** remote endpoints and reports status to the AgentTool status.
4. **Discovers tools** at startup via MCP `ListTools` introspection and populates `status.tools` on the AgentTool CR.

The gateway image is `ghcr.io/samyn92/mcp-gateway`. It supports two modes:
- **Spawn mode:** Spawns a local MCP server binary and proxies stdio-to-HTTP (used for OCI tools that need HTTP access).
- **Proxy mode:** Forwards to a remote MCP server/endpoint (used for `mcpServer` and `mcpEndpoint` sources).

## Built-in tool servers

AgentOps ships six MCP tool servers in the `agent-tools` repository, all compiled as static Go binaries and distributed as OCI artifacts:

### kubectl (16 tools)

Shells out to the kubectl CLI for maximum compatibility with kubeconfig, auth plugins, and RBAC.

**Readonly tools (always available):**
`kubectl_get`, `kubectl_describe`, `kubectl_logs`, `kubectl_top`, `kubectl_events`, `kubectl_api_resources`, `kubectl_explain`

**Readwrite tools (MODE=readwrite):**
`kubectl_exec`, `kubectl_apply`, `kubectl_delete`, `kubectl_run`, `kubectl_cp`, `kubectl_rollout`, `kubectl_scale`, `kubectl_label`, `kubectl_annotate`

**Co-bundled binary:** The OCI artifact includes the `kubectl` CLI binary alongside the MCP server, so agent pods do not need kubectl pre-installed.

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: kubectl
spec:
  category: infrastructure
  oci:
    ref: ghcr.io/samyn92/agent-tools/kubectl:1.0.0
```

### kube-explore (8 tools)

Intent-based Kubernetes discovery. Uses client-go directly — no kubectl dependency. Each tool answers a high-level question in one call, replacing 3-10 sequential kubectl commands.

**Readonly tools:**
`kube_find` (fuzzy search across all namespaces/types), `kube_health` (full cluster health snapshot), `kube_inspect` (deep single-resource inspection with logs, events, owner chain), `kube_topology` (relationship graph), `kube_diff` (desired vs live state), `kube_logs` (enhanced logs with crash detection)

**Readwrite tools (MODE=readwrite):**
`kube_exec` (exec with fuzzy pod resolution), `kube_apply` (server-side apply)

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: kube-explore
spec:
  category: infrastructure
  uiHint: kubernetes-resources
  oci:
    ref: ghcr.io/samyn92/agent-tools/kube-explore:1.0.0
```

### git (12 tools)

Git operations with workspace sandboxing. All paths are resolved relative to a `WORKSPACE` environment variable.

**Readonly tools:**
`git_status`, `git_diff`, `git_log`, `git_branch_list`, `git_show`

**Readwrite tools (MODE=readwrite, default):**
`git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_clone`, `git_clone_or_pull`

### github (12 tools)

GitHub API operations: `github_get_repo`, `github_list_prs`, `github_get_pr`, `github_get_pr_diff`, `github_create_pr`, `github_add_pr_comment`, `github_list_issues`, `github_get_issue`, `github_add_issue_comment`, `github_list_branches`, `github_get_check_runs`, `github_get_workflow_runs`

### gitlab (10 tools)

GitLab API operations: `gitlab_get_project`, `gitlab_list_mrs`, `gitlab_get_mr`, `gitlab_get_mr_diff`, `gitlab_create_mr`, `gitlab_add_mr_note`, `gitlab_list_issues`, `gitlab_get_issue`, `gitlab_add_issue_note`, `gitlab_get_pipeline`

### flux (15 tools)

Flux CD GitOps operations. Like kubectl, the OCI artifact co-bundles the `flux` CLI binary.

**Readonly tools (11):**
`flux_get`, `flux_check`, `flux_stats`, `flux_logs`, `flux_events`, `flux_trace`, `flux_tree`, `flux_diff`, `flux_export`, `flux_debug`, `flux_version`

**Readwrite tools (MODE=readwrite, 4):**
`flux_reconcile`, `flux_suspend`, `flux_resume`, `flux_delete`

## MODE environment variable

All tool servers that support mutable operations use the `MODE` environment variable to gate access:

| Value | Behavior |
|-------|----------|
| `readonly` (default) | Only read/query tools are registered |
| `readwrite` | All tools are registered, including mutating operations |

The operator sets `MODE` on the tool init container or MCP server deployment based on the AgentTool and Agent binding configuration. This provides defense-in-depth — even if the MCP gateway permissions allow a tool, the server binary itself must be running in the correct mode.

## Building custom tools

To create a custom MCP tool server for AgentOps:

### 1. Implement the MCP stdio transport

Write a Go binary (or any language) that speaks MCP over stdin/stdout. Using the Go SDK:

```go
package main

import (
    "context"
    "log"

    "github.com/modelcontextprotocol/go-sdk/mcp"
)

type searchInput struct {
    Query string `json:"query" jsonschema_description:"Search query"`
    Limit int    `json:"limit,omitempty" jsonschema_description:"Max results"`
}

func main() {
    server := mcp.NewServer(
        &mcp.Implementation{Name: "my-tool", Version: "1.0.0"},
        nil,
    )

    mcp.AddTool(server, &mcp.Tool{
        Name:        "my_search",
        Description: "Search the knowledge base",
    }, func(ctx context.Context, req *mcp.CallToolRequest, input searchInput) (*mcp.CallToolResult, any, error) {
        // implement tool logic
        return mcp.NewToolResultText("results..."), nil, nil
    })

    if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
        log.Fatal(err)
    }
}
```

### 2. Create manifest.json

```json
{
  "name": "my-tool",
  "command": "my-tool",
  "transport": "stdio",
  "description": "Custom knowledge base search tool"
}
```

### 3. Build and push as OCI artifact

```bash
# Build the binary
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o my-tool .

# Push as OCI artifact using agent-tools CLI
agent-tools push . -t ghcr.io/myorg/agent-tools/my-tool:1.0.0
```

The `agent-tools push` command:
1. Reads `manifest.json` from the target directory.
2. Tars the directory contents (binary + manifest + any co-bundled files).
3. Gzips the archive.
4. Pushes as an OCI artifact with media type `application/vnd.agents.io.mcp-tool.v1`.

### 4. Create the AgentTool CR and bind it

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: my-tool
  namespace: agents
spec:
  description: "Custom knowledge base search"
  category: search
  oci:
    ref: ghcr.io/myorg/agent-tools/my-tool:1.0.0
---
# Bind to an agent
apiVersion: agents.agentops.io/v1alpha1
kind: Agent
metadata:
  name: researcher
  namespace: agents
spec:
  mode: daemon
  model: anthropic/claude-sonnet-4-20250514
  providers:
    - name: anthropic
      apiKeySecret:
        name: llm-keys
        key: ANTHROPIC_API_KEY
  tools:
    - name: my-tool
```

### Tool discovery

At reconcile time, the operator introspects OCI-sourced tools by launching the binary and calling MCP `ListTools`. The discovered tools are written to `status.tools` on the AgentTool CR:

```
$ kubectl get agenttools kubectl -n agents -o yaml
status:
  phase: Ready
  sourceType: oci
  tools:
    - name: kubectl_get
      description: "Get one or many resources..."
    - name: kubectl_describe
      description: "Show detailed information..."
    # ... all 16 tools
```

This allows the console and other components to display the full tool catalog without running the binary themselves.
