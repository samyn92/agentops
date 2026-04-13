---
title: "Concepts"
linkTitle: "Concepts"
weight: 2
description: "Core concepts and architecture of the AgentOps platform."
---

AgentOps models AI agents as Kubernetes-native workloads. Six Custom Resource Definitions (CRDs) in the `agents.agentops.io/v1alpha1` API group describe the entire platform:

| CRD | Short Name | Purpose |
|-----|-----------|---------|
| `Agent` | `ag` | Defines an agent's model, tools, memory, identity, and lifecycle mode |
| `AgentRun` | `ar` | Tracks a single execution of an agent (prompt + response + metrics) |
| `AgentTool` | `agtool` | Catalog entry for an MCP tool server, skill, or external endpoint |
| `AgentResource` | `ares` | Declares an external resource (repo, bucket, docs) agents can work with |
| `Channel` | `ch` | Bridges external platforms (Slack, GitHub webhooks, GitLab) to agents |
| `Provider` | `prov` | Shared LLM provider configuration (type, credentials, endpoint, call defaults) |

The operator reconciles these CRDs into standard Kubernetes primitives — Deployments, Jobs, Services, PVCs, ConfigMaps, NetworkPolicies, and RBAC — so agents run with the same operational model as any other workload.

## Architecture overview

{{< img src="images/concepts-overview.svg" alt="AgentOps Concepts Overview" >}}

## Key design principles

**Declarative-first.** Agents, tools, and resources are defined as CRDs. The operator converges cluster state to match the declared spec. No imperative setup scripts.

**Go-native runtime.** The agent runtime is built on the [Charm Fantasy SDK](https://github.com/charmbracelet/fantasy) — a single statically-linked Go binary per agent pod. No Python, no Node.js, no container-in-container.

**Three-layer memory.** Working memory (in-process), short-term session summaries (deterministic, no LLM call), and long-term observations (FTS5 BM25-ranked). All backed by agentops-memory, a ~1300 LOC Go service with SQLite.

**Tools as OCI artifacts.** MCP tool servers are compiled Go binaries packaged as OCI artifacts. The operator pulls them via init containers and the runtime spawns them on stdio. No network hops for tool calls.

**Real-time streaming.** The Fantasy Event Protocol (FEP) over Server-Sent Events connects the AgentOps Console to live agent sessions for token-by-token streaming, tool call visualization, and memory inspection.

Read on for deep dives into each concept:

- [Agents]({{< relref "agents" >}}) — CRD spec, lifecycle modes, delegation, concurrency control
- [Providers]({{< relref "providers" >}}) — shared LLM provider configuration, type-based SDK wiring, per-call defaults
- [Memory]({{< relref "memory" >}}) — three-layer model, context injection, write dedup, MCP tools
- [Tools]({{< relref "tools" >}}) — MCP tool servers, OCI distribution, gateway sidecar, built-in servers
