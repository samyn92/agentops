---
title: "Comparison with kagent"
linkTitle: "Comparison"
weight: 3
description: "Honest comparison between AgentOps and kagent (CNCF sandbox)."
---

Both AgentOps and [kagent](https://github.com/kagent-dev/kagent) are Kubernetes-native AI agent platforms with MCP tool support. They share the same core idea -- define agents as Custom Resources and let an operator handle the lifecycle -- but make different technical choices. This comparison aims to be factual and honest about where each project is stronger.

---

## Key differences

### 1. Runtime

| | AgentOps | kagent |
|---|---------|--------|
| Language | Go | Python |
| SDK | [Charm Fantasy SDK](https://github.com/charmbracelet/fantasy) (compiled binary) | [Google ADK](https://github.com/google/adk-python) |
| Startup time | Fast (single static binary) | Slower (Python interpreter + dependencies) |
| Memory footprint | ~64 MiB typical | Higher due to Python runtime |

### 2. Memory

| | AgentOps | kagent |
|---|---------|--------|
| Memory system | Three-layer (working, short-term, long-term) | None built-in |
| Storage | SQLite + FTS5 BM25 relevance ranking | -- |
| Context injection | Relevance-ranked per turn with full OTEL audit trail | -- |
| Write dedup | Three-tier (topic_key upsert, hash dedup, new insert) | -- |
| Session summaries | Deterministic (no LLM call) | -- |

### 3. Delegation

| | AgentOps | kagent |
|---|---------|--------|
| Model | Parallel fan-out via K8s Jobs with Watch-based result aggregation | Single-agent execution |
| Discovery | `list_task_agents` with scope control (namespace/explicit/hidden) | -- |
| Concurrency | Configurable per-agent (queue/reject/replace policies) | -- |

### 4. Tool distribution

| | AgentOps | kagent |
|---|---------|--------|
| Format | Custom OCI artifacts (compiled Go binaries) | Container images |
| Transport | MCP stdio | MCP stdio |
| Pull mechanism | crane init container | Standard container pull |
| Catalog | 73 tools across 6 servers | Broader ecosystem (see below) |

### 5. Console

| | AgentOps | kagent |
|---|---------|--------|
| Framework | SolidJS PWA | React |
| Architecture | Go BFF proxying K8s + agent APIs | Direct API |
| Tool rendering | 12 branded card renderers (kubernetes-resources, diff, terminal, etc.) | Standard rendering |
| Memory management | Dedicated Memory panel (browse, search, edit, delete) | -- |

### 6. Observability

| | AgentOps | kagent |
|---|---------|--------|
| Tracing | Full OTEL with per-observation injection audit trails | Standard OTEL |
| Context audit | Every memory injection recorded as span event with ID, type, rank, method | -- |
| Integration | Grafana Tempo bundled in Helm chart | Standard OTEL export |

### 7. Streaming protocol

| | AgentOps | kagent |
|---|---------|--------|
| Protocol | Fantasy Event Protocol (FEP) over SSE | Standard API responses |
| Event types | 30+ event types (text delta, tool call, tool result, thinking, cost, etc.) | -- |
| Real-time | Full streaming to console | Polling-based |

### 8. Maturity and community

| | AgentOps | kagent |
|---|---------|--------|
| Status | Early stage, independent developer | CNCF sandbox |
| Stars | -- | ~2,600 |
| Commits | ~260 across all repos | ~1,157 |
| Backing | Independent | Solo.io |
| Contributors | 1 | Multiple |

### 9. Tool ecosystem

| | AgentOps | kagent |
|---|---------|--------|
| Kubernetes | kube-explore (intent-based), kubectl (raw) | kubectl |
| GitOps | Flux CD (15 tools) | ArgoCD |
| Git forges | GitHub, GitLab | GitHub |
| Service mesh | -- | Istio, Cilium |
| Monitoring | -- | Prometheus, Grafana |
| CI/CD | -- | Argo Workflows |
| Total tools | 73 | Broader set |

### 10. Inter-agent protocol

| | AgentOps | kagent |
|---|---------|--------|
| Protocol | K8s-native delegation via CRDs (AgentRun + Watch) | A2A (Agent-to-Agent protocol) |
| Cross-cluster | Not yet | Supported via A2A |

---

## Where kagent is stronger

- **Larger community** -- CNCF sandbox with ~2,600 stars and backing from Solo.io. More eyes on the code, more battle-testing.
- **More LLM providers** -- broader provider support via Google ADK ecosystem.
- **Broader tool ecosystem** -- tools for Istio, Cilium, ArgoCD, Prometheus, Grafana, and more. Covers service mesh and monitoring domains that AgentOps does not.
- **A2A protocol support** -- inter-agent communication across clusters and platforms using the Agent-to-Agent protocol.
- **More battle-tested** -- higher commit count, more contributors, more production deployments.
- **CNCF governance** -- neutral governance model, contribution guidelines, release processes.

## Where AgentOps is stronger

- **Memory system** -- three-layer memory with BM25 relevance-ranked context injection, three-tier write dedup, and deterministic session summaries. kagent has no built-in memory.
- **Delegation** -- parallel fan-out with K8s Watch-based result aggregation, configurable concurrency policies (queue/reject/replace), and discovery scope control.
- **Streaming protocol** -- FEP with 30+ event types provides richer real-time streaming than standard API responses.
- **Compiled runtime** -- Go binary starts faster and uses less memory than a Python runtime.
- **Observability depth** -- per-observation injection audit trails show exactly what context the agent received and why, not just that a memory call was made.
- **OCI tool distribution** -- lightweight OCI artifacts for tool servers (a few MB each), pulled by crane init container. No full container image per tool.
- **Deeper Kubernetes + GitOps tooling** -- kube-explore provides intent-based exploration, and the Flux tool server covers 15 GitOps operations.

---

## Choosing between them

**Choose kagent if:**

- You need CNCF-backed governance and a larger community
- Your stack includes Istio, Cilium, ArgoCD, or Prometheus
- You need A2A protocol for cross-cluster agent communication
- You prefer Python-based agent development
- You want a more battle-tested platform

**Choose AgentOps if:**

- Agent memory and context injection are important to your use case
- You need multi-agent delegation with concurrency control
- You want rich real-time streaming in the console
- You prefer a compiled Go runtime with minimal resource overhead
- Your GitOps stack is Flux-based
- You're comfortable with an earlier-stage project from an independent developer
