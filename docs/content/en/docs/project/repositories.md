---
title: "Repositories"
linkTitle: "Repositories"
weight: 1
description: "All repositories in the AgentOps ecosystem."
---

AgentOps is composed of eight repositories, each with a focused responsibility. All container images are published to `ghcr.io/samyn92/` and Helm charts to `ghcr.io/samyn92/charts/`.

---

## agentops

**Purpose:** Central documentation hub (this site).

- Hugo site with the Docsy theme
- Architecture docs, CRD reference, guides, and project information
- No runtime artifacts

**Repository:** [github.com/samyn92/agentops](https://github.com/samyn92/agentops)

---

## agentops-core

**Purpose:** Kubernetes operator that manages the full lifecycle of AI agent workloads.

- 6 CRDs: Agent, AgentRun, AgentTool, AgentResource, Channel, Provider
- Reconciles Agent CRs into Deployments (daemon) or Job templates (task) with sidecars, storage, networking, and MCP tool injection
- Handles delegation orchestration, concurrency control, and schedule-based runs
- Built with kubebuilder

**Key tech:** Go, kubebuilder, controller-runtime
**Image:** `ghcr.io/samyn92/agentops-operator`
**Current version:** v0.8.1 (~70 commits)
**Repository:** [github.com/samyn92/agentops-core](https://github.com/samyn92/agentops-core)

---

## agentops-runtime

**Purpose:** Standalone Go binary that powers AI agent pods.

- Built on the [Charm Fantasy SDK](https://github.com/charmbracelet/fantasy)
- Three-layer memory system (working, short-term, long-term) backed by agentops-memory
- MCP tool integration via stdio transport
- Fantasy Event Protocol (FEP) streaming for the console
- Kubernetes-native agent orchestration and delegation

**Key tech:** Go, Charm Fantasy SDK, MCP stdio, FEP/SSE
**Image:** `ghcr.io/samyn92/agentops-runtime-fantasy`
**Current version:** v0.8.2 (~56 commits)
**Repository:** [github.com/samyn92/agentops-runtime](https://github.com/samyn92/agentops-runtime)

---

## agentops-console

**Purpose:** Web console for interacting with agents, viewing traces, and managing memories.

- Go Backend-for-Frontend (BFF) proxying Kubernetes API, agent runtime, memory, and Tempo APIs
- SolidJS Progressive Web App with 12 tool card renderers
- Connects to agents via FEP over Server-Sent Events for real-time streaming
- Memory panel for browsing, searching, and managing observations

**Key tech:** Go (BFF), SolidJS, TypeScript, TailwindCSS, SSE
**Image:** `ghcr.io/samyn92/agentops-console`
**Current version:** v0.9.4 (~75 commits)
**Repository:** [github.com/samyn92/agentops-console](https://github.com/samyn92/agentops-console)

---

## agentops-memory

**Purpose:** Purpose-built memory service replacing Engram.

- ~1,300 lines of Go
- SQLite + FTS5 for BM25 relevance-ranked full-text search
- Three-tier write dedup: topic_key upsert, hash dedup (15-minute window), new insert
- Deterministic session summaries (no LLM call)
- Full OTEL tracing with per-observation injection audit trails
- REST API compatible with the console BFF proxy

**Key tech:** Go, SQLite, FTS5, OpenTelemetry
**Image:** `ghcr.io/samyn92/agentops-memory`
**Current version:** v0.2.0 (~4 commits)
**Repository:** [github.com/samyn92/agentops-memory](https://github.com/samyn92/agentops-memory)

---

## agent-tools

**Purpose:** MCP tool servers that AI agents consume at runtime, plus a CLI for packaging and pushing them as OCI artifacts.

- 6 tool servers: kube-explore, kubectl, git, github, gitlab, flux
- 73 total tools (43 read-only, 30 read-write)
- All servers are compiled Go binaries implementing MCP stdio transport
- `agent-tools push` CLI for building and pushing OCI artifacts to container registries

**Key tech:** Go, MCP stdio, OCI artifacts, crane
**Image:** OCI artifacts at `ghcr.io/samyn92/agent-tools/<server>:<version>`
**Current version:** v0.5.1 (~29 commits)
**Repository:** [github.com/samyn92/agent-tools](https://github.com/samyn92/agent-tools)

---

## agentops-platform

**Purpose:** Umbrella Helm chart for deploying the full AgentOps platform.

- Sub-charts: agentops-operator, agentops-console
- Bundled: agentops-memory, Grafana Tempo
- Configurable namespace separation (agent-system for infrastructure, agents for workloads)
- Single `helm install` for the complete stack

**Key tech:** Helm 3, OCI chart registry
**Chart:** `oci://ghcr.io/samyn92/charts/agentops-platform`
**Current version:** v0.9.6 (~22 commits)
**Repository:** [github.com/samyn92/agentops-platform](https://github.com/samyn92/agentops-platform)

---

## agent-channels

**Purpose:** Channel bridge images for connecting external platforms to agents.

- Bridges for Telegram, Slack, Discord, GitLab webhooks, GitHub webhooks, and generic webhooks
- Each bridge runs as a Deployment managed by the Channel CRD
- Converts platform events into AgentRun CRs

**Key tech:** Go
**Images:** `ghcr.io/samyn92/agent-channel-<type>`
**Current version:** v0.1.0
**Repository:** [github.com/samyn92/agent-channels](https://github.com/samyn92/agent-channels)

---

## Version matrix

| Component | Image | Version |
|-----------|-------|---------|
| Operator | `ghcr.io/samyn92/agentops-operator` | v0.8.1 |
| Runtime | `ghcr.io/samyn92/agentops-runtime-fantasy` | v0.8.2 |
| Console | `ghcr.io/samyn92/agentops-console` | v0.9.4 |
| Memory | `ghcr.io/samyn92/agentops-memory` | v0.2.0 |
| Tool servers | `ghcr.io/samyn92/agent-tools/*` | v0.5.1 |
| Platform chart | `oci://ghcr.io/samyn92/charts/agentops-platform` | v0.9.6 |
| Channel bridges | `ghcr.io/samyn92/agent-channel-*` | v0.1.0 |
