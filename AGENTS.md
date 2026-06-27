# AgentOps Agent Guide

This repo is the AgentOps monorepo. Keep work scoped, verify with the local
k3d harness when behavior touches runtime/operator/factory, and do not revive
old multi-repo assumptions.

## Repo Shape

- Single Go module: `github.com/samyn92/agentops`.
- Main binaries:
  - `cmd/operator`
  - `cmd/console`
  - `cmd/runtime`
  - `cmd/memory`
  - `cmd/tools-cli`
- Core packages:
  - `api/v1alpha1`: CRD types.
  - `internal/operator`: reconciliation.
  - `internal/console`: BFF, auth, handlers, Kubernetes client.
  - `web`: SolidJS console.
  - `tools`: OCI-packaged optional tools. Current artifacts use MCP stdio, but MCP is an adapter, not the platform boundary.
  - `channels`: bridge binaries such as `gitlab-label`.
  - `deploy/charts`: Helm charts.
  - `deploy/test-clusters`: k3d E2E harness.

## Architecture Rules

- `Integration` is the boundary for identity, access, policy, and target.
- Tools consume Integrations; tools should not own long-lived identity policy.
- GitLab is platform-native, not an OCI MCP tool.
- Kubernetes should become a platform Integration rather than depending on `kubectl` or `flux` being available in `$PATH`.
- OCI artifacts remain the packaging model for optional/custom tools.
- MCP compatibility is useful, but do not describe the product as an MCP-first platform.

## Local Harness

Use the k3d harness for end-to-end validation:

```sh
just --justfile deploy/test-clusters/justfile up
just --justfile deploy/test-clusters/justfile prepare-secrets
just --justfile deploy/test-clusters/justfile e2e-setup
just --justfile deploy/test-clusters/justfile ui
```

Required secrets for `prepare-secrets`:

```sh
export KIMI_API_KEY=...
export GITLAB_PLANNER_TOKEN=...
export GITLAB_CODER_TOKEN=...
```

Do not read or print secret values. It is fine to verify secret names, keys, and
Deployment env wiring.

Cluster contexts:

- `k3d-agentops-mgmt`: platform, agents, console.
- `k3d-agentops-prod`: simulated workload cluster.
- `k3d-agentops-staging`: simulated workload cluster.

UI:

```sh
just --justfile deploy/test-clusters/justfile ui
```

Open `http://localhost:8080`.

## Dev Iteration

After code changes:

```sh
go test ./cmd/runtime ./cmd/runtime/gitlab
helm lint deploy/charts/agent-factory -f deploy/test-clusters/factory-e2e-values.yaml
```

When runtime/operator/console/channel images change:

```sh
just --justfile deploy/test-clusters/justfile deploy-platform
```

When factory values/templates change:

```sh
just --justfile deploy/test-clusters/justfile deploy-factory
```

Because dev images use `:dev` and `imagePullPolicy: Never`, restart affected
agent deployments after rebuilding/importing runtime:

```sh
kubectl --context k3d-agentops-mgmt -n agents rollout restart deploy/infra-pm
kubectl --context k3d-agentops-mgmt -n agents rollout status deploy/infra-pm --timeout=120s
```

Validation:

```sh
just --justfile deploy/test-clusters/justfile e2e-test
just --justfile deploy/test-clusters/justfile verify
```

## GitLab Factory Contract

- Factory scope is one GitLab group: `scope.gitlab.group`.
- Workboard inventory is group-wide.
- PM creates/updates issues, labels, and issue notes only.
- Engineering Lead handles code, branches, commits, pushes, and MRs.
- PM issue writes are enabled with `GITLAB_WRITE_SCOPE=issues`.
- Agents should use explicit project paths from issue/repo/user context when creating or updating work.

## Docs

- Keep root docs small:
  - `README.md`: GitHub landing page.
  - `PLAN.md`: current architecture and next work.
  - `AGENTS.md`: this operational guide.
- Do not add new `PLAN_*.md` files.
- If a decision matters, fold it into `PLAN.md` briefly.
- Hugo docs live under `docs/` and should stay product-facing.

## Release

CI:

```sh
gh workflow run ci.yaml
```

Release is tag-driven:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The release workflow builds and publishes:

- operator, console, runtime, memory images
- channel images
- OCI tool artifacts
- Helm charts
- GitHub release notes

Before tagging:

```sh
git status --short
go test ./...
helm lint deploy/charts/agentops
helm lint deploy/charts/agent-factory
```

Only release from a clean tree after the relevant k3d path has passed.
