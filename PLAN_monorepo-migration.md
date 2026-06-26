# PLAN: Monorepo Migration

> Status: Ready to execute  
> Created: 2026-06-21  
> Target: github.com/samyn92/agentops  
> Approach: Fresh start (clean initial commit, old repos archived for history)

## Rationale

- Solo developer with 8 tightly-coupled repos
- Cross-repo releases cost coordination overhead (core → console → platform dance)
- Console imports core's Go types — version bumps on every CRD change
- agent-tools already multi-module internally (9 go.mod files with replace directives)
- Agent factory pattern will add MORE cross-component changes
- Eliminating cross-repo deps removes an entire class of friction

## Target Structure

```
github.com/samyn92/agentops/
├── go.mod                          # Single module: github.com/samyn92/agentops
├── go.sum
├── Makefile
├── justfile                        # Unified dev recipes
├── AGENTS.md                       # Single source of truth
├── README.md
│
├── api/v1alpha1/                   # CRD types (was agentops-core/api/v1alpha1/)
│   ├── agent_types.go
│   ├── agentrun_types.go
│   ├── channel_types.go
│   ├── integration_types.go
│   ├── provider_types.go
│   ├── shared_types.go
│   ├── groupversion_info.go
│   └── zz_generated.deepcopy.go
│
├── cmd/
│   ├── operator/main.go            # was agentops-core/cmd/main.go
│   ├── console/main.go             # was agentops-console/cmd/console/main.go
│   ├── runtime/main.go             # was agentops-runtime/main.go
│   ├── memory/main.go              # was agentops-memory/main.go
│   └── tools-cli/main.go           # was agent-tools/cmd/agent-tools/main.go
│
├── internal/
│   ├── operator/                   # Controller logic (was agentops-core/internal/)
│   │   ├── controller/
│   │   └── ...
│   ├── console/                    # BFF logic (was agentops-console/internal/)
│   │   ├── auth/
│   │   ├── handlers/
│   │   ├── k8s/
│   │   ├── multiplexer/
│   │   ├── server/
│   │   └── tracing/
│   ├── runtime/                    # Agent runtime (was agentops-runtime root packages)
│   │   └── ...
│   └── memory/                     # Memory service (was agentops-memory root packages)
│       └── ...
│
├── web/                            # SolidJS frontend (was agentops-console/web/)
│   ├── src/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── tools/                          # MCP tool servers (was agent-tools/servers/)
│   ├── pkg/mcputil/                # Shared MCP utilities
│   ├── kubectl/
│   ├── flux/
│   ├── git/
│   ├── github/
│   ├── gitlab/
│   ├── helm/
│   ├── tempo/
│   └── kube-explore/
│
├── channels/                       # Channel bridges (was agent-channels/channels/)
│   ├── webhook/
│   ├── gitlab/
│   ├── gitlab-label/
│   └── gitlab-comment/
│
├── deploy/
│   ├── charts/
│   │   ├── agentops/               # Umbrella platform chart (was agentops-platform)
│   │   └── agent-factory/          # Factory chart (NEW)
│   ├── crds/                       # Generated CRD manifests
│   ├── local-k3s/                  # Dev environment (was local_k3s/)
│   │   ├── deploy/
│   │   │   ├── justfile
│   │   │   ├── kustomization.yaml
│   │   │   ├── operator-dev.yaml
│   │   │   ├── console-dev.yaml
│   │   │   └── scripts/
│   │   └── secrets/                # .gitignored
│   └── presets/                    # Agent factory presets
│       └── devops-gitops.yaml
│
├── docs/                           # Hugo docs site (was agentops-docs)
│
├── config/                         # Operator scaffolding (kubebuilder)
│   ├── crd/
│   ├── rbac/
│   ├── manager/
│   └── ...
│
├── hack/                           # Scripts, codegen
│   └── boilerplate.go.txt
│
├── .github/
│   └── workflows/
│       ├── ci.yaml                 # Lint + test + build (path-filtered)
│       ├── release.yaml            # Matrix image builds on tag
│       └── docs.yaml               # Hugo deploy
│
└── Dockerfile.*                    # Per-component Dockerfiles
    ├── Dockerfile.operator
    ├── Dockerfile.console
    ├── Dockerfile.runtime
    ├── Dockerfile.memory
    └── Dockerfile.channel          # Multi-target (build arg selects channel)
```

## Go Module Strategy

**Single module:** `github.com/samyn92/agentops`

All internal imports become local:
```go
// Before (console importing core):
import agentsv1alpha1 "github.com/samyn92/agentops-core/api/v1alpha1"

// After (same repo):
import agentsv1alpha1 "github.com/samyn92/agentops/api/v1alpha1"
```

**Exception — tool servers:** Currently each tool server is a separate go.mod (to minimize binary size — they shouldn't pull in controller-runtime). Two options:

A. **Single module** — tools accept the larger dependency graph, rely on Go's dead-code elimination for small binaries.  
B. **Go workspace** — root `go.work` with `tools/kubectl/go.mod` etc. as sub-modules.

**Decision: Option A (single module).** Reason: Go's linker already eliminates unused code. The binary size difference is negligible for container images. One module = zero replace directives, zero version coordination. The `mcputil` package becomes just `internal/tools/mcputil/` or `tools/pkg/mcputil/`.

## CI/CD Design

### Single pipeline, path-filtered jobs

```yaml
# .github/workflows/ci.yaml
on:
  push:
    branches: [main]
  pull_request:

jobs:
  detect-changes:
    outputs:
      operator: ${{ steps.changes.outputs.operator }}
      console: ${{ steps.changes.outputs.console }}
      runtime: ${{ steps.changes.outputs.runtime }}
      memory: ${{ steps.changes.outputs.memory }}
      tools: ${{ steps.changes.outputs.tools }}
      channels: ${{ steps.changes.outputs.channels }}
      web: ${{ steps.changes.outputs.web }}
      api: ${{ steps.changes.outputs.api }}
    steps:
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            api: ['api/**']
            operator: ['cmd/operator/**', 'internal/operator/**', 'api/**', 'config/**']
            console: ['cmd/console/**', 'internal/console/**', 'api/**']
            runtime: ['cmd/runtime/**', 'internal/runtime/**']
            memory: ['cmd/memory/**', 'internal/memory/**']
            tools: ['tools/**', 'cmd/tools-cli/**']
            channels: ['channels/**']
            web: ['web/**']

  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.26' }
      - run: go vet ./...
      - run: go test ./...

  build-operator:
    needs: [detect-changes, lint-test]
    if: needs.detect-changes.outputs.operator == 'true'
    # ...

  build-console:
    needs: [detect-changes, lint-test]
    if: needs.detect-changes.outputs.console == 'true'
    # ...
```

### Release (on tag push)

```yaml
# .github/workflows/release.yaml
on:
  push:
    tags: ['v*']

jobs:
  build-images:
    strategy:
      matrix:
        component: [operator, console, runtime, memory]
    steps:
      - uses: docker/build-push-action@v5
        with:
          file: Dockerfile.${{ matrix.component }}
          tags: ghcr.io/samyn92/agentops/${{ matrix.component }}:${{ github.ref_name }}

  build-tools:
    strategy:
      matrix:
        tool: [kubectl, flux, git, github, gitlab, helm, tempo, kube-explore]
    # ...

  build-channels:
    strategy:
      matrix:
        channel: [webhook, gitlab, gitlab-label, gitlab-comment]
    # ...

  package-charts:
    steps:
      - run: helm package deploy/charts/agentops
      - run: helm push agentops-*.tgz oci://ghcr.io/samyn92/agentops/charts
```

## Image Naming (after migration)

| Component | Image | Notes |
|-----------|-------|-------|
| Operator | `ghcr.io/samyn92/agentops/operator:vX.Y.Z` | unchanged |
| Console | `ghcr.io/samyn92/agentops/console:vX.Y.Z` | unchanged |
| Runtime | `ghcr.io/samyn92/agentops/runtime:vX.Y.Z` | drop `-fantasy` suffix |
| Memory | `ghcr.io/samyn92/agentops/memory:vX.Y.Z` | unchanged |
| Tools | `ghcr.io/samyn92/agentops/tools/{name}:vX.Y.Z` | unchanged (OCI artifacts) |
| Channels | `ghcr.io/samyn92/agent-channels/{name}:vX.Y.Z` | unchanged |

## Local Dev Environment Updates

The `local_k3s/deploy/` moves to `deploy/local-k3s/`. The hostPath mount changes:

```yaml
# Before (console-dev.yaml):
volumes:
  - name: workspace
    hostPath:
      path: /home/samy/dev/github.com/samyn92    # multi-repo root

# After:
volumes:
  - name: workspace
    hostPath:
      path: /home/samy/dev/github.com/samyn92/agentops  # monorepo root
```

Working directory in pods: `/workspace` (mounts the monorepo root).

Justfile paths update:
```
op_workdir  := "/workspace"           # operator builds from root
con_workdir := "/workspace"           # console builds from root
```

Build commands:
```
go build -o /tmp/manager ./cmd/operator/
go build -o /tmp/bff ./cmd/console/
```

## Migration Execution Order

### Step 1: Create repo + scaffold
- `gh repo create samyn92/agentops --private --description "AgentOps Platform — Kubernetes-native AI agent orchestration"`
- Create directory structure (empty, with go.mod)
- Commit scaffold

### Step 2: Move API types (the dependency root)
- Copy `agentops-core/api/` → `api/`
- Copy `agentops-core/config/` → `config/`
- Update module paths in all files
- Ensure `go build ./...` passes

### Step 3: Move operator
- Copy `agentops-core/internal/` → `internal/operator/`
- Copy `agentops-core/cmd/main.go` → `cmd/operator/main.go`
- Update imports
- Verify builds

### Step 4: Move console
- Copy `agentops-console/internal/` → `internal/console/`
- Copy `agentops-console/cmd/console/` → `cmd/console/`
- Copy `agentops-console/web/` → `web/`
- Update imports (replace `github.com/samyn92/agentops-core/api/v1alpha1` → `github.com/samyn92/agentops/api/v1alpha1`)
- Verify builds + `npx tsc --noEmit`

### Step 5: Move runtime
- Copy `agentops-runtime/` → `internal/runtime/` + `cmd/runtime/main.go`
- Update imports
- Verify builds

### Step 6: Move memory
- Copy `agentops-memory/` → `internal/memory/` + `cmd/memory/main.go`
- Update imports
- Verify builds

### Step 7: Move tools + channels
- Copy `agent-tools/servers/` → `tools/`
- Copy `agent-tools/cmd/` → `cmd/tools-cli/`
- Copy `agent-channels/channels/` → `channels/`
- Remove per-tool go.mod files (absorbed into root module)
- Remove replace directives
- Verify builds

### Step 8: Move deploy
- Copy `agentops-platform/charts/` → `deploy/charts/agentops/`
- Copy `local_k3s/` → `deploy/local-k3s/`
- Update justfile paths
- Create `deploy/charts/agent-factory/` scaffold

### Step 9: Consolidate go.mod
- Single `go.mod` at root
- `go mod tidy` to resolve all deps
- Pin Go version to `1.26`
- Resolve K8s/OTEL version drift (align to latest: k8s v0.36.0, otel v1.43.0)

### Step 10: CI + Dockerfiles
- Create path-filtered CI workflow
- Create per-component Dockerfiles
- Create release workflow with matrix builds

### Step 11: Local dev environment
- Update dev pod hostPath mounts
- Update justfile build commands
- `just up` → verify operator + console work

### Step 12: Archive old repos
- Add "Moved to github.com/samyn92/agentops" to each old repo README
- Archive repos on GitHub (read-only, searchable for history)

## Dependencies to Resolve

| Package | Current versions | Target |
|---------|-----------------|--------|
| `k8s.io/*` | v0.35.3 (runtime), v0.36.0 (core/console) | v0.36.0 |
| `go.opentelemetry.io/otel` | v1.35-v1.43 (varies) | v1.43.0 |
| Go version | 1.25-1.26.3 (varies) | 1.26 |
| `controller-runtime` | v0.24.0 | v0.24.0 (keep) |
| `charm.land/fantasy` | v0.25.2 (runtime only) | v0.25.2 (keep) |

## Estimated Effort

| Step | Time |
|------|------|
| Scaffold + API + operator | 1 hour |
| Console (Go + web) | 1 hour |
| Runtime + memory | 30 min |
| Tools + channels | 30 min |
| Deploy + local-k3s | 30 min |
| go.mod consolidation | 30 min |
| CI + Dockerfiles | 1 hour |
| Local dev verification | 30 min |
| **Total** | **~6 hours** |
