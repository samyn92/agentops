# AgentOps Plan

This is the current decision snapshot. Historical migration plans were removed
after the monorepo consolidation.

## System Snapshot

AgentOps is a Kubernetes-native agent harness in one monorepo and one Go module:

- Operator reconciles AgentOps CRDs into Deployments, Jobs, Services, PVCs, RBAC, and status.
- Console is the Go BFF plus SolidJS UI for chat, factory views, GitLab OIDC, traces, and memory.
- Runtime runs Fantasy agents, built-in tools, platform-native tools, OCI tool adapters, memory, FEP streaming, and OTEL.
- Memory is SQLite FTS5 with BM25 relevance-ranked context.
- Channels bridge external events into agents, currently focused on GitLab label/webhook flows.
- Agent Factory is the Helm composition layer for deployable domain teams.

The active local harness is `deploy/test-clusters`: one k3d management cluster plus prod/staging workload clusters.

## Current Architecture Direction

### Integrations

`Integration` is the platform boundary for access, identity, policy, and target.

Current:

- GitLab group/project integrations inject scoped bot identity.
- GitLab tools are runtime-native and governed by Integration scope.
- PM agents can have issue-only write scope while implementation agents have broader coder scope.

Next:

- Add `kubernetes-cluster` Integration.
- Use it for in-cluster service accounts and remote kubeconfig secrets.
- Carry namespace/read-only policy in the Integration instead of relying on tool binaries or pod `$PATH`.
- Let Kubernetes, Flux, and cluster-observer tools consume that Integration.

### Tools

Tool packaging and tool identity are separate.

- OCI artifacts remain the distribution format for optional/custom tools.
- MCP remains a supported adapter for current OCI stdio tools.
- MCP is not the core platform abstraction.
- First-class systems should be platform-native when they need tenant identity, policy, audit, or rich UX.

Target model:

```text
Agent
  integrations:
    - gitlab group/project identity
    - kubernetes cluster identity
  tools:
    - native platform tools
    - OCI artifacts, optionally MCP-backed
```

### Factory

The DevOps/GitOps factory is group-scoped:

- One GitLab setting: `scope.gitlab.group`.
- Workboard inventory is group-wide.
- Cards are created/updated in explicit target projects selected from issue/repo context.
- PM creates and updates issues, labels, and issue comments.
- Engineering Lead writes code, pushes branches, and opens MRs.
- Observers inspect clusters and create planning issues when they find actionable failures.

## Near-Term Work

1. Add Kubernetes Integration CRD fields and operator env/secret injection.
2. Replace brittle kubectl/flux PATH assumptions with either bundled OCI binaries or platform-native clients.
3. Make Flux consume Kubernetes Integration and discover Flux CRDs in-cluster.
4. Update console Integration views so users can see GitLab and Kubernetes scopes.
5. Add E2E coverage for observer cluster health using Kubernetes Integration.
6. Tighten docs around "OCI tool artifacts with MCP adapter" instead of "MCP ecosystem".

## Release Model

- CI is path-aware and lives in `.github/workflows/ci.yaml`.
- Releases are tag-driven by `.github/workflows/release.yaml`.
- A `v*` tag publishes images, channel images, OCI tool artifacts, Helm charts, and GitHub release notes.
- Do not tag or release from a dirty tree.

## Cleanup Policy

Keep root documentation small:

- `README.md`: GitHub project landing page.
- `PLAN.md`: current architecture and next work.
- `AGENTS.md`: operational guide for coding agents.

Historical plans should be folded into this file or deleted.
