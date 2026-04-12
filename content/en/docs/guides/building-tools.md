---
title: "Building Custom MCP Tools"
linkTitle: "Building Tools"
weight: 1
description: "Create a custom MCP tool server in Go, package it as an OCI artifact, and deploy it to your agents."
---

This guide walks through creating a custom MCP tool server from scratch, packaging it, and deploying it into an AgentOps-managed agent.

## Prerequisites

- Go 1.22+
- `agent-tools` CLI installed
- Access to an OCI registry (e.g. `ghcr.io`)
- A running AgentOps cluster with the operator installed

## 1. Create a Go Module

```bash
mkdir my-tool && cd my-tool
go mod init github.com/myorg/my-tool
go get github.com/modelcontextprotocol/go-sdk@v0.8.0
```

## 2. Implement the Tool Server

Create `main.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	server := mcp.NewServer(
		&mcp.Implementation{
			Name:    "my-tool",
			Version: "0.1.0",
		},
		nil,
	)

	// Check mode for gating dangerous operations
	mode := os.Getenv("MODE") // "readonly" or "readwrite"

	// Register a read-safe tool (always available)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "lookup_item",
		Description: "Look up an item by ID.",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"id": {"type": "string", "description": "The item ID to look up."}
			},
			"required": ["id"]
		}`),
	}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		id := req.Arguments["id"].(string)
		// Your lookup logic here
		return &mcp.CallToolResult{
			Content: []mcp.Content{
				{Type: "text", Text: fmt.Sprintf("Found item: %s", id)},
			},
		}, nil
	})

	// Register a write tool (only in readwrite mode)
	if mode != "readonly" {
		mcp.AddTool(server, &mcp.Tool{
			Name:        "create_item",
			Description: "Create a new item.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"name":  {"type": "string", "description": "Item name."},
					"value": {"type": "string", "description": "Item value."}
				},
				"required": ["name", "value"]
			}`),
		}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			name := req.Arguments["name"].(string)
			value := req.Arguments["value"].(string)
			// Your creation logic here
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					{Type: "text", Text: fmt.Sprintf("Created item %s=%s", name, value)},
				},
			}, nil
		})
	}

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
```

### Mode Gating Pattern

The `MODE` environment variable controls which tools are exposed. This is set per-agent in the AgentTool CR or the Agent CR's `toolRefs` config:

| Mode | Behavior |
|------|----------|
| `readonly` | Only read-safe tools are registered |
| `readwrite` | All tools are registered (default) |

Check `MODE` at startup and conditionally register tools. This keeps the tool list clean — the agent never sees tools it cannot use.

## 3. Create the Manifest

Create `manifest.json` in the project root:

```json
{
  "name": "my-tool",
  "version": "0.1.0",
  "description": "A custom tool server for item management.",
  "command": "./my-tool",
  "transport": "stdio",
  "env": {
    "MODE": "readwrite"
  }
}
```

The manifest tells the runtime how to launch the tool server. `transport: "stdio"` means the runtime communicates with the tool over stdin/stdout using the MCP JSON-RPC protocol.

## 4. Build a Static Binary

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -o dist/my-tool .
cp manifest.json dist/
```

The binary must be statically linked (`CGO_ENABLED=0`) since it runs inside a minimal sidecar container.

## 5. Push as an OCI Artifact

```bash
agent-tools push ./dist -t ghcr.io/myorg/my-tool:0.1.0
```

This packages the binary and manifest into an OCI artifact and pushes it to your registry. The operator pulls this artifact at reconcile time when an agent references the tool.

## 6. Create an AgentTool CR

```yaml
apiVersion: agentops.samyn.co/v1alpha1
kind: AgentTool
metadata:
  name: my-tool
  namespace: agents
spec:
  ociRef: ghcr.io/myorg/my-tool:0.1.0
  transport: stdio
  description: "Custom item management tool"
```

Apply it:

```bash
kubectl apply -f my-tool-agenttool.yaml
```

## 7. Reference in an Agent CR

Add the tool to your agent's `toolRefs`:

```yaml
apiVersion: agentops.samyn.co/v1alpha1
kind: Agent
metadata:
  name: my-agent
  namespace: agents
spec:
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  toolRefs:
    - name: my-tool
      mode: readwrite
  systemPrompt: |
    You are a helpful agent with access to item management tools.
    Use lookup_item to find items and create_item to create new ones.
```

When the operator reconciles this agent, it pulls the OCI artifact, injects the tool binary as an init container, and configures the MCP gateway sidecar to launch it with the specified mode.

## Full Working Example

Here is the complete set of files for a minimal tool server:

### Directory Structure

```
my-tool/
├── go.mod
├── go.sum
├── main.go
├── manifest.json
└── dist/           # build output
    ├── my-tool
    └── manifest.json
```

### Build & Deploy

```bash
# Build
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o dist/my-tool .
cp manifest.json dist/

# Push
agent-tools push ./dist -t ghcr.io/myorg/my-tool:0.1.0

# Deploy
kubectl apply -f my-tool-agenttool.yaml
kubectl apply -f my-agent.yaml
```

## Next Steps

- See existing tool servers in `agent-tools/servers/` for more patterns.
- Read the [Multi-Agent Orchestration](../multi-agent/) guide to combine tools with delegation.
