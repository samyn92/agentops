---
title: "Architecture"
linkTitle: "Architecture"
weight: 3
description: "How AgentOps components connect, communicate, and manage data."
---

AgentOps separates the platform control plane from user agent workloads using a two-namespace model. The operator manages the full lifecycle of agents, tools, resources, and channels as native Kubernetes workloads.

## Component overview

{{< img src="images/architecture.svg" alt="Platform Architecture" >}}

## Two-namespace model

| Namespace | Purpose | Contents |
|-----------|---------|----------|
| `agent-system` | Platform control plane | Operator, console, Tempo |
| `agents` | User workloads | Agent pods, memory service, AgentTool/AgentResource/Channel workloads, PVCs |

This separation provides:

- **RBAC isolation** — the operator has broad permissions in `agents` but users interact only through CRDs
- **Resource quota boundaries** — platform overhead is independent of agent workload limits
- **Clear ownership** — platform upgrades don't disrupt running agents

## Custom Resource Definitions

AgentOps defines 6 CRDs in the `agents.agentops.io/v1alpha1` API group:

| CRD | Short name | Description |
|-----|------------|-------------|
| **Agent** | `ag` | Defines an AI agent. `mode: daemon` creates a Deployment + PVC + Service (always running). `mode: task` creates a Job template (one prompt, exits). |
| **AgentRun** | `ar` | Tracks one execution of an Agent. Created by Channels, the `run_agent` delegation tool, schedule triggers, or the console. |
| **AgentTool** | `agtool` | Catalog entry for a tool. Source types: `oci` (OCI artifact), `configMap`, `inline`, `mcpServer` (operator-deployed), `mcpEndpoint` (external), `skill` (prompt extension). |
| **AgentResource** | `ares` | External resource binding (GitHub repos, GitLab projects, S3 buckets, documentation). Agents reference these; users select them in the console to scope prompts. |
| **Channel** | `ch` | External ingress bridge. Connects Telegram, Slack, Discord, GitHub/GitLab webhooks, or generic webhooks to an Agent. |
| **Provider** | `prov` | Shared LLM provider configuration. Declares the SDK backend type, API key secret, endpoint overrides, and per-call defaults. Agents reference providers via `spec.providerRefs`. |

## Data flow

### User interaction

1. The user opens the console (SolidJS PWA) and selects an agent
2. The BFF proxies the request to the agent pod's Fantasy runtime over HTTP
3. The runtime processes the prompt, calls the LLM, executes tools, and streams results back via the **Fantasy Event Protocol (FEP)** over Server-Sent Events
4. The console renders events in real time — text, tool calls, tool results, and metadata

### Memory flow

{{< img src="images/context-injection.svg" alt="Memory Context Injection Flow" >}}

The memory system operates on three layers:

| Layer | Scope | Storage | Management |
|-------|-------|---------|------------|
| **Working memory** | Current session | In-process (Go runtime) | Token-budget trimmed. Before each LLM call, oldest messages are trimmed to fit the conversation token budget. Checkpointed to PVC for crash recovery. |
| **Short-term memory** | Session summaries | agentops-memory (SQLite) | Deterministic extraction at session end (no LLM call). Injected on each turn. |
| **Long-term memory** | Decisions, discoveries, lessons | agentops-memory (SQLite + FTS5) | User-managed via console Memory panel. Agent can save/search via `mem_save`, `mem_search` MCP tools. |

Context injection is **relevance-ranked** using BM25 when a query is provided (`GET /context?query=...`). Falls back to recency ordering when no query is supplied.

### Trace flow

All components export OpenTelemetry traces via OTLP to Tempo. The console BFF queries Tempo's HTTP API (`:3200`) to render the Traces panel, giving full visibility into LLM calls, tool executions, memory lookups, and request latency.

## Component responsibilities

| Component | Image | Responsibilities |
|-----------|-------|------------------|
| **Operator** | `ghcr.io/samyn92/agentops-operator` | Reconciles 6 CRDs. Creates Deployments/Jobs/Services/PVCs for agents. Pulls OCI tools via crane init containers. Deploys channel bridges. Manages concurrency and scheduling. Validates Provider secrets and wires enriched provider config into agent pods. |
| **Console** | `ghcr.io/samyn92/agentops-console` | Go BFF proxying Kubernetes API and agent runtime APIs. SolidJS PWA for agent interaction, memory management, trace viewing. Connects to agents via FEP/SSE. |
| **Memory** | `ghcr.io/samyn92/agentops-memory` | ~1300 lines of Go. SQLite + FTS5 BM25 relevance-ranked context injection. Three-tier write dedup. Deterministic session summaries. REST API on port 7437. Full OTEL tracing. |
| **Tempo** | `grafana/tempo` | Trace storage and query. Receives OTLP on gRPC :4317 and HTTP :4318. Search API on :3200. |
| **Runtime** | `ghcr.io/samyn92/agentops-runtime-fantasy` | Go binary built on the Charm Fantasy SDK. Runs inside agent pods. Handles LLM calls, built-in tools (bash, read, edit, write, grep, ls, glob, fetch), MCP tool client, memory integration, FEP streaming, OTLP export. |
| **MCP Gateway** | `ghcr.io/samyn92/mcp-gateway` | Sidecar for `mcpServer`/`mcpEndpoint` tool sources. Proxies MCP protocol between agent runtime and remote MCP servers. Handles spawn and proxy modes. |
| **Tool Servers** | `ghcr.io/samyn92/agent-tools/*` | OCI artifacts containing compiled Go MCP tool server binaries (kubectl, kube-explore, git, github, gitlab, flux). Pulled via crane init container, launched as stdio MCP servers. |

## Platform vs. user ecosystem

{{< img src="images/platform-ecosystem.svg" alt="Platform vs User Ecosystem" >}}

- **Platform** is installed once via Helm and upgraded independently. It provides the control plane, web UI, memory backend, and tracing infrastructure.
- **User ecosystem** is everything users create through CRDs. Agents, tools, resources, and channels are declarative — defined in YAML, version-controlled, and reconciled by the operator. The platform never dictates which models, tools, or resources you use.

This separation means you can upgrade the platform without restarting agents, add new tool servers without touching the operator, and manage agent configurations through standard GitOps workflows.
