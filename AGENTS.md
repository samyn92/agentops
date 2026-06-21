# AgentOps — Kubernetes-Native AI Agent Orchestration

## What This Is

A monorepo containing the full AgentOps platform: operator, console, runtime, memory, tools, channels, and deployment charts. One module, one repo, one CI pipeline.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  PLATFORM (this repo)                                            │
├─────────────────────────────────────────────────────────────────┤
│  Operator    │ K8s controller for Agent/AgentRun/Channel/etc CRDs│
│  Console     │ Go BFF + SolidJS PWA (GitLab OIDC multi-tenant)  │
│  Runtime     │ Fantasy SDK agent binary (powers agent pods)      │
│  Memory      │ SQLite FTS5 context service (BM25 relevance)     │
│  Tools       │ MCP tool servers (kubectl, git, gitlab, helm...)  │
│  Channels    │ Bridge binaries (gitlab-label, webhook, etc.)     │
│  Charts      │ Helm: agentops (platform) + agent-factory         │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Layout

```
api/v1alpha1/          CRD types (Agent, AgentRun, Channel, Integration, Provider)
cmd/
  operator/            Operator binary entrypoint
  console/             Console BFF binary entrypoint  
  runtime/             Agent runtime binary (all code here, package main)
  memory/              Memory service binary (all code here, package main)
  tools-cli/           OCI tool packager CLI
internal/
  operator/            Controller reconciliation logic
  console/             BFF: auth, handlers, k8s client, server, multiplexer
web/                   SolidJS Progressive Web App (Vite + Tailwind)
tools/                 MCP tool servers (8 servers + shared mcputil SDK)
channels/              Channel bridge binaries (4 bridges)
deploy/
  charts/agentops/     Umbrella Helm chart (operator + console + memory + tempo + nats)
  charts/agent-factory/  Agent factory chart (planned)
  local-k3s/           Local k3s dev environment
  presets/             Agent factory presets
config/                Operator kustomize (CRDs, RBAC, manager)
docs/                  Hugo documentation site
```

## Go Module

Single module: `github.com/samyn92/agentops` — no replace directives, no cross-repo imports.

## Dev Environment

All development runs in-cluster on local k3s (`pc-omarchy`). Dev pods mount the monorepo via hostPath.

### Quick Start

```sh
just --justfile deploy/local-k3s/deploy/justfile up       # deploy dev pods
just --justfile deploy/local-k3s/deploy/justfile con-reload  # hot-reload console
just --justfile deploy/local-k3s/deploy/justfile op-reload   # hot-reload operator
```

### Key Recipes

| Recipe | What |
|--------|------|
| `just up` | Deploy both dev pods, wait for ready |
| `just down` | Tear down dev pods |
| `just con-reload` | Kill → rebuild → restart BFF (Vite stays up) |
| `just op-reload` | Kill → rebuild → restart operator |
| `just op-reload-full` | Regenerate CRDs + rebuild + restart |
| `just rt-reload` | Build runtime :dev image + import into k3s |
| `just rt-refire <agent>` | Delete latest AgentRun → new pod |

### Browser Access

| URL | What |
|-----|------|
| `http://localhost:30173` | Console (Vite HMR + BFF proxy) |
| `http://localhost:30080` | BFF directly |

## CI/CD

- **CI** (`.github/workflows/ci.yaml`): Path-filtered — only builds what changed. Go vet/test/build + web typecheck/build.
- **Release** (`.github/workflows/release.yaml`): On `v*` tag — matrix Docker builds (operator, console, runtime, memory), channel images, tool binaries, Helm chart packaging.

## Key Concepts

### Multi-Tenant OIDC
The console authenticates users via GitLab OIDC. All GitLab API reads use the human's token (sees only what they have access to). Agent writes use scoped bot tokens (from Integration credentials).

### Agent Factories
Pre-composed agent teams deployed as Helm charts. DevOps/GitOps factory: planner + implementer + reviewer + observer + CI fixer. Scoped to a GitLab group or project.

### Three-Layer Memory
1. Working Memory (ephemeral, in-process)
2. Short-term Memory (session summaries, auto-managed)
3. Long-term Memory (decisions, lessons learned, user-managed)

### Fantasy Event Protocol (FEP)
Streaming protocol over SSE for real-time agent activity. Events flow: Runtime → NATS → Console BFF → Browser.

## Plans

| Plan | Status | Description |
|------|--------|-------------|
| `PLAN_multi-tenant-oidc.md` | Implemented | GitLab OIDC, login wall, user-scoped reads |
| `PLAN_agent-factory.md` | Design | Agent factory Helm chart, identity tiers, DevOps preset |
| `PLAN_monorepo-migration.md` | Done | This migration |
| `PLAN_legacy-cleanup.md` | Pending E2E test | Archive old repos |
| `PLAN_platform-operating-model.md` | Active | Versioning, release hygiene |
| `PLAN_eval.md` | Draft | Agent evaluation via OTEL traces |
