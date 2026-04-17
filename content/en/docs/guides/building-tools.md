---
title: "Building Custom MCP Tools"
linkTitle: "Building Tools"
weight: 1
description: "Create a custom MCP tool server in Go using the mcputil SDK, package it as an OCI artifact, and deploy it to your agents."
---

This guide walks through creating a custom MCP tool server from scratch using the `mcputil` SDK, packaging it, and deploying it into an AgentOps-managed agent.

## Prerequisites

- Go 1.25+
- `agent-tools` CLI installed (or use `make push-server`)
- Access to an OCI registry (e.g. `ghcr.io`)
- A running AgentOps cluster with the operator installed

## 1. Create a Go Module

```bash
mkdir servers/my-tool && cd servers/my-tool
go mod init github.com/myorg/agent-tools/servers/my-tool
go get github.com/modelcontextprotocol/go-sdk@v0.8.0
```

Add the shared `mcputil` SDK as a local dependency:

```
require github.com/samyn92/agent-tools/servers/pkg/mcputil v0.0.0
replace github.com/samyn92/agent-tools/servers/pkg/mcputil => ../pkg/mcputil
```

## 2. Implement the Tool Server

Create `main.go`:

```go
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/samyn92/agent-tools/servers/pkg/mcputil"
)

type lookupInput struct {
	ID string `json:"id" jsonschema_description:"The item ID to look up."`
}

type createInput struct {
	Name  string `json:"name" jsonschema_description:"Item name."`
	Value string `json:"value" jsonschema_description:"Item value."`
}

func main() {
	mode := os.Getenv("MODE")
	if mode == "" {
		mode = "readonly"
	}

	server := mcputil.NewServer("my-tool", "0.1.0", mcputil.WithMode(mode))
	log := mcputil.Logger()

	// Read-safe tool (always available) — gets automatic tracing
	mcputil.AddToolTo(server, "lookup_item",
		"Look up an item by ID.",
		func(ctx context.Context, req *mcp.CallToolRequest, in lookupInput) (*mcp.CallToolResult, any, error) {
			// Your lookup logic here
			return mcputil.TextResult("Found item: %s", in.ID), nil, nil
		},
	)

	// Write tool (only in readwrite mode) — opt-in I/O recording
	if mode == "readwrite" {
		mcputil.AddToolTo(server, "create_item",
			"Create a new item.",
			func(ctx context.Context, req *mcp.CallToolRequest, in createInput) (*mcp.CallToolResult, any, error) {
				// Your creation logic here
				return mcputil.TextResult("Created item %s=%s", in.Name, in.Value), nil, nil
			},
			mcputil.WithInputOutput(), // Records input/output as OTEL span events
		)
	}

	mcputil.Ready()
	if err := server.Run(context.Background(), mcp.NewStdioTransport()); err != nil {
		log.Error("server failed", "error", err)
		os.Exit(1)
	}
}
```

### What mcputil gives you automatically

- **Session-level root span** — `server.Run()` creates an `mcp.session` span that lives for the entire server lifecycle
- **Per-tool tracing** — every `AddToolTo` call wraps the handler in a `tool.<name>` span with duration, error status
- **Panic recovery** — handler panics are caught, stack traces recorded, error results returned instead of crashing
- **I/O recording** — `WithInputOutput()` records inputs and outputs as span events (opt-in for mutation tools)
- **Structured results** — `TextResult()` and `ErrResult()` build properly-formatted MCP results

### Mode Gating Pattern

The `MODE` environment variable controls which tools are exposed:

| Mode | Behavior |
|------|----------|
| `readonly` | Only read-safe tools are registered |
| `readwrite` | All tools are registered |

Check `MODE` at startup and conditionally register tools. This keeps the tool list clean — the agent never sees tools it cannot use.

## 3. Create the Manifest

Create `manifest.json`:

```json
{
  "name": "my-tool",
  "command": "mcp-my-tool",
  "transport": "stdio",
  "description": "A custom tool server for item management."
}
```

The manifest tells the runtime how to launch the tool server. `transport: "stdio"` means the runtime communicates with the tool over stdin/stdout using the MCP JSON-RPC protocol. Binaries follow the `mcp-{server}` naming convention.

## 4. Build a Static Binary

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags="-s -w" -o dist/bin/mcp-my-tool .
cp manifest.json dist/
```

The binary must be statically linked (`CGO_ENABLED=0`) since it runs inside agent pod init containers.

## 5. Push as an OCI Artifact

```bash
agent-tools push ./dist -t ghcr.io/myorg/agent-tools/my-tool:0.1.0
```

This packages the binary and manifest into an OCI artifact and pushes it to your registry. The operator pulls this artifact at reconcile time when an agent references the tool.

## 6. Create an AgentTool CR

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: my-tool
  namespace: agents
spec:
  category: custom
  description: "Custom item management tool"
  oci:
    ref: ghcr.io/myorg/agent-tools/my-tool:0.1.0
```

Apply it:

```bash
kubectl apply -f my-tool-agenttool.yaml
```

## 7. Reference in an Agent CR

Add the tool to your agent's `tools`:

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Agent
metadata:
  name: my-agent
  namespace: agents
spec:
  model: anthropic/claude-sonnet-4-20250514
  providerRefs:
    - name: anthropic
  tools:
    - name: my-tool
  systemPrompt: |
    You are a helpful agent with access to item management tools.
    Use lookup_item to find items and create_item to create new ones.
```

When the operator reconciles this agent, it pulls the OCI artifact via a crane init container, extracts it to `/tools/my-tool/`, and the runtime launches the MCP server binary over stdio.

## Full Working Example

### Directory Structure

```
servers/my-tool/
├── go.mod
├── go.sum
├── main.go
├── manifest.json
└── dist/           # build output
    ├── bin/
    │   └── mcp-my-tool
    └── manifest.json
```

### Build & Deploy

```bash
# Build
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags="-s -w" -o dist/bin/mcp-my-tool .
cp manifest.json dist/

# Push
agent-tools push ./dist -t ghcr.io/myorg/agent-tools/my-tool:0.1.0

# Deploy
kubectl apply -f my-tool-agenttool.yaml
kubectl apply -f my-agent.yaml
```

## Next Steps

- See existing tool servers in `agent-tools/servers/` for more patterns (CLI wrappers, API clients, in-cluster Kubernetes access).
- Read the `mcputil` SDK source in `servers/pkg/mcputil/` for all available helpers (`DoJSON`, `RunCommand`, `K8sClientset`).
- Read the [Multi-Agent Orchestration](../multi-agent/) guide to combine tools with delegation.
