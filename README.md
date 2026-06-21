<p align="center">
  <img src="docs/static/images/logo.png" alt="AgentOps" width="120" />
</p>

<h1 align="center">AgentOps</h1>

<p align="center">
  <strong>GitOps-native DevOps agent harness for Kubernetes</strong>
</p>

<p align="center">
  <a href="https://github.com/samyn92/agentops/actions/workflows/ci.yaml"><img src="https://img.shields.io/github/actions/workflow/status/samyn92/agentops/ci.yaml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/samyn92/agentops/releases"><img src="https://img.shields.io/github/v/release/samyn92/agentops?style=flat-square&color=blue" alt="Release"></a>
  <img src="https://img.shields.io/badge/Go-1.26-00ADD8?style=flat-square&logo=go" alt="Go 1.26">
  <img src="https://img.shields.io/badge/Kubernetes-1.31+-326CE5?style=flat-square&logo=kubernetes&logoColor=white" alt="Kubernetes">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-green?style=flat-square" alt="License"></a>
</p>

---

## What is AgentOps

AgentOps is a **Kubernetes-native AI agent orchestration platform** where agents are first-class workloads — declared as Custom Resources, reconciled by an operator, and observed through a real-time console. It provides **GitLab-native identity** (OIDC for humans, scoped bot tokens for agents) and a **multi-cluster DevOps harness** that deploys purpose-built agent teams as Helm releases.

One `helm install` gives you a coordinated team of AI agents — planners, implementers, reviewers, observers, and CI fixers — scoped to your GitLab group or Kubernetes cluster, with clean identity separation and full audit trails.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AgentOps Platform                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────── CRDs ──────────────────────────────────┐  │
│  │  Agent  │  AgentRun  │  Channel  │  Integration  │  Provider      │  │
│  └─────────────────────────────────────────────────────────────────────┘│
│                              │                                           │
│  ┌───────────────────────── Operator ────────────────────────────────┐  │
│  │  Reconciles all CRDs → Deployments, Jobs, Services, PVCs, RBAC   │  │
│  │  Self-healing • Leader election • Drift detection                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│  ┌─────────────── Console ───────────────┐  ┌────── Channels ────────┐  │
│  │  Go BFF (multi-tenant OIDC)           │  │  gitlab-label bridge   │  │
│  │  SolidJS PWA (real-time streaming)    │  │  gitlab-comment bridge │  │
│  │  SSE multiplexer via NATS             │  │  webhook bridge        │  │
│  └───────────────────────────────────────┘  └────────────────────────┘  │
│                              │                                           │
│  ┌─────────────── Runtime ───────────────┐  ┌──────── Memory ────────┐  │
│  │  Fantasy SDK (Charm)                  │  │  SQLite + FTS5         │  │
│  │  MCP tool servers (stdio transport)   │  │  BM25 relevance        │  │
│  │  Three-layer memory integration       │  │  Three-tier write dedup│  │
│  │  Fantasy Event Protocol (SSE)         │  │  OTEL tracing          │  │
│  └───────────────────────────────────────┘  └────────────────────────┘  │
│                              │                                           │
│  ┌─────────────── Factory ───────────────────────────────────────────┐  │
│  │  Helm chart generating complete agent teams from presets          │  │
│  │  DevOps/GitOps • ML/Data • Security • Custom domains             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Agent Factory

The **Agent Factory** is the key differentiator — it transforms individual agent CRDs into deployable team compositions via Helm charts.

### Domain-Specific Agent Teams

Each factory is a Helm chart that deploys a coordinated set of agents, channels, integrations, and credentials for a specific domain and scope:

```bash
# Deploy a complete DevOps/GitOps agent team for your infrastructure group
helm install infra-agents oci://ghcr.io/samyn92/charts/agent-factory \
  -n agents \
  -f presets/devops-gitops.yaml \
  --set scope.gitlab.group=company/infra \
  --set secrets.plannerToken=glpat-xxx \
  --set secrets.coderToken=glpat-yyy \
  --set secrets.llmApiKey=sk-ant-xxx
```

### DevOps/GitOps Preset

The first-class factory preset deploys this agent team:

| Agent | Mode | Role | What it does |
|-------|------|------|--------------|
| **Planner** | daemon | Coordinator | Plans work, refines specs, delegates to implementers |
| **Implementer** | task | Worker | Writes code, opens MRs, pushes branches |
| **Reviewer** | daemon | Reviewer | Reviews MRs, validates configs, enforces standards |
| **Observer** | daemon | Watcher | Monitors Flux reconciliation, detects drift |
| **CI Fixer** | task | Worker | Auto-repairs failing pipelines (retry-budget guarded) |

### Identity Tiers

Clean separation between human and machine identity:

```
Human (OIDC)         → GitLab SSO, full user permissions, "samyn92" in activity
Platform Agents      → Group Access Token (Developer, api), read + comment only
Worker Agents        → Group Access Token (Developer, api + write_repo), push + MR
```

Protected branches prevent agents from merging — human approval is always required.

---

## Key Features

- **Kubernetes-native** — Agents are CRDs. The operator reconciles desired state, handles self-healing, leader election, and garbage collection. No external orchestrator required.

- **GitLab-native identity** — Humans authenticate via OIDC (see only what they have access to). Agents act through scoped bot tokens with explicit permission boundaries.

- **Multi-cluster management** — Observer agents watch remote clusters for Flux drift, HelmRelease failures, and Kustomization health. Issues are opened automatically when problems are detected.

- **Real-time streaming** — The Fantasy Event Protocol (FEP) streams agent activity over SSE via NATS. See agent thought processes, tool calls, and outputs in real time.

- **Three-layer memory** — Working memory (ephemeral, token-budgeted), short-term memory (auto-generated session summaries), and long-term memory (user-managed decisions and lessons learned). BM25 relevance-ranked context injection.

- **MCP tool ecosystem** — Eight tool servers via Model Context Protocol: `kubectl`, `git`, `gitlab`, `helm`, `flux`, `github`, `kube-explore`, `tempo`. Agents compose tools declaratively.

- **Plan refinement** — Human-in-the-loop via GitLab issue threads. Planners propose, humans refine, implementers execute. Full audit trail in GitLab.

- **CI repair loop** — CI Fixer agents read pipeline failure logs, understand the error, and push fixes. Retry-budget guarded to prevent runaway loops.

- **Agent delegation** — Planners delegate work to implementers via the `run_agent` tool. The team roster is auto-generated from the factory composition.

---

## Quick Start

### Prerequisites

- k3s or k8s cluster (v1.31+)
- Helm 3.x
- `kubectl` configured for your cluster

### Deploy the Platform

```bash
# Install CRDs
kubectl apply -f deploy/crds/

# Deploy the platform (operator + console + memory + NATS)
helm install agentops deploy/charts/agentops/ \
  -n agent-system --create-namespace \
  -f deploy/charts/agentops/values.yaml

# Verify
kubectl get pods -n agent-system
```

### Deploy an Agent Team

```bash
# Deploy the DevOps/GitOps factory preset
helm install my-team deploy/charts/agent-factory/ \
  -n agents --create-namespace \
  -f deploy/presets/devops-gitops.yaml \
  --set scope.gitlab.group=your-group/path \
  --set provider.apiKeySecret.name=llm-api-keys

# Watch agents come up
kubectl get agents -n agents
```

### Access the Console

```bash
# The console is available via NodePort (dev) or Ingress (production)
# Default dev access:
open http://localhost:30173
```

---

## Multi-Cluster Testing

The `deploy/test-clusters/` directory provides a k3d-based multi-cluster test environment for validating observer agents and cross-cluster scenarios:

```bash
# Spin up management + workload clusters
just --justfile deploy/test-clusters/justfile up

# Deploy workloads for observer testing
just --justfile deploy/test-clusters/justfile deploy-workloads
```

See [`deploy/test-clusters/README.md`](deploy/test-clusters/README.md) for details.

---

## Repository Structure

```
agentops/
├── api/v1alpha1/              CRD type definitions (Agent, AgentRun, Channel, Integration, Provider)
├── cmd/
│   ├── operator/              Operator binary entrypoint
│   ├── console/               Console BFF binary entrypoint
│   ├── runtime/               Agent runtime binary (Fantasy SDK)
│   ├── memory/                Memory service binary (SQLite + FTS5)
│   └── tools-cli/             OCI tool packager CLI
├── internal/
│   ├── operator/              Controller reconciliation logic
│   └── console/               BFF: auth, handlers, k8s client, multiplexer
├── web/                       SolidJS Progressive Web App (Vite + Tailwind)
├── tools/                     MCP tool servers
│   ├── kubectl/               Kubernetes operations
│   ├── git/                   Git operations
│   ├── gitlab/                GitLab API (issues, MRs, pipelines)
│   ├── github/                GitHub API
│   ├── helm/                  Helm chart operations
│   ├── flux/                  Flux GitOps operations
│   ├── kube-explore/          Cluster exploration
│   ├── tempo/                 Distributed tracing
│   └── pkg/                   Shared mcputil SDK
├── channels/                  Channel bridge binaries
│   ├── gitlab-label/          Label-based event routing
│   ├── gitlab-comment/        Comment-based event routing
│   ├── gitlab/                GitLab integration (legacy)
│   └── webhook/               Generic webhook bridge
├── deploy/
│   ├── charts/agentops/       Platform Helm chart (operator + console + deps)
│   ├── charts/agent-factory/  Agent factory chart (team composition)
│   ├── crds/                  Standalone CRD manifests
│   ├── local-k3s/             Local k3s dev environment
│   ├── presets/               Factory preset values
│   └── test-clusters/         k3d multi-cluster test environment
├── config/                    Operator kustomize (RBAC, manager, webhooks)
├── docs/                      Hugo documentation site
├── memory/                    Memory service package
├── hack/                      Code generation scripts
└── Makefile                   Top-level build targets
```

---

## Development

All development runs **in-cluster** on a local k3s node. Dev pods mount the monorepo via hostPath — edit locally, build and run inside the pods.

### Setup

```bash
# Deploy dev pods (operator + console)
just --justfile deploy/local-k3s/deploy/justfile up

# Verify pods are running
just --justfile deploy/local-k3s/deploy/justfile status
```

### Day-to-Day Workflow

| Recipe | Description |
|--------|-------------|
| `just op-reload` | Hot-reload operator (~3-5s, controller logic only) |
| `just op-reload-full` | Full reload: generate CRDs + manifests + install + restart |
| `just con-reload` | Hot-reload console BFF (Vite stays up) |
| `just rt-reload` | Build runtime `:dev` image + import into k3s |
| `just rt-refire <agent>` | Delete latest AgentRun — triggers new pod with updated image |
| `just op-logs` | Tail operator logs |
| `just con-logs` | Tail BFF logs |
| `just op-shell` | Shell into operator pod |
| `just con-shell` | Shell into console pod |

All `just` commands use the justfile at `deploy/local-k3s/deploy/justfile`.

### Browser Access

| URL | Service |
|-----|---------|
| `http://localhost:30173` | Console (Vite HMR + BFF proxy) |
| `http://localhost:30080` | BFF API directly |

### In-Cluster Services

| Service | Cluster DNS | Port |
|---------|-------------|------|
| Memory | `agentops-memory.agents.svc.cluster.local` | 7437 |
| Tempo | `tempo.observability.svc.cluster.local` | 3200 |
| Agent pods | `{name}.agents.svc.cluster.local` | 4096 |

### CI

Path-filtered GitHub Actions — only builds what changed:

- **CI** (`ci.yaml`): Go vet/test/build + web typecheck/build
- **Release** (`release.yaml`): On `v*` tag — matrix Docker builds, Helm chart packaging, OCI push

---

## License

```
Copyright 2024-2026 samyn92

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
