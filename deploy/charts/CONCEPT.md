# AgentOps Platform — Build, Release & Chart Architecture

> Single source of truth for how the AgentOps stack is built, versioned, released,
> and composed via Helm charts.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    CORE PLATFORM                                 │
│            (one helm install = full stack)                        │
│                                                                  │
│  agentops-platform (umbrella chart)                              │
│  ├── agentops-operator  (sub-chart, OCI)    ← CRDs + controller │
│  ├── agentops-console   (sub-chart, OCI)    ← Go BFF + SolidJS  │
│  ├── agentops-memory   (inline templates)  ← memory backend     │
│  └── tempo              (sub-chart, Grafana)← tracing backend    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    USER ECOSYSTEM                                │
│          (separate installs, user-composed)                       │
│                                                                  │
│  agent-factory        (library chart, OCI)  ← agent definitions  │
│  ├── Agent CRs with capability system                            │
│  ├── Presets (dev-assistant, sre, ops, etc.)                     │
│  ├── Environment overlays (dev/staging/prod)                     │
│  └── Multi-agent umbrella examples                               │
│                                                                  │
│  agent-tools          (OCI artifacts + Docker images)            │
│  ├── kubectl, git, github, gitlab, kube-explore, flux            │
│  └── Users build and push custom tools via agent-tools CLI       │
│                                                                  │
│  agent-channels       (Docker images)                            │
│  └── webhook, gitlab bridge images                               │
│                                                                  │
│  agentops-runtime     (Docker image)                             │
│  └── Fantasy SDK agent binary, referenced by Agent CRs           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Split

**Core Platform** = infrastructure you need to run AgentOps. One `helm install`, one version.
Managed by the platform team. Users don't touch these components.

**User Ecosystem** = what users compose to define their agents. Separate installs because:
- Different teams install different agents
- Agent definitions change at a different cadence than infrastructure
- Tools are independently versioned and user-extensible
- Runtime images are referenced by CRs, not deployed by the platform chart

---

## Versioning Strategy

### Aligned Platform Version

All core platform components share a **platform version**. When we release `v0.8.0`:

```
agentops-platform   0.8.0  (umbrella chart)
├── agentops-operator  0.8.0  (from agentops-core v0.8.0)
├── agentops-console   0.8.0  (from agentops-console v0.8.0)
├── agentops-memory     v0.1.0 (purpose-built, own semver)
└── tempo              1.24.4 (third-party, pinned)
```

The chart `appVersion` tracks the platform version. The `version` field
(chart version) is always equal to `appVersion` for simplicity.

### Ecosystem Versions Independently

| Component | Version | Why |
|-----------|---------|-----|
| `agent-factory` | Own semver | Chart tracks CRD compatibility, not platform version |
| `agent-tools` | Own semver (per-server) | Individual tool servers version independently |
| `agent-channels` | Own semver | Bridge images version with their platform APIs |
| `agentops-runtime` | Own semver | Runtime versions with Fantasy SDK + memory model |

### Compatibility Matrix

Each platform release declares compatible ecosystem versions:

| Platform | Runtime | agent-factory | agent-tools | CRD API |
|----------|---------|---------------|-------------|---------|
| 0.8.0 | >= 0.4.0 | >= 0.1.0 | >= 0.3.0 | v1alpha1 |

This matrix is published in the GitHub Release notes and in `NOTES.txt`.

---

## Artifact Registry (all on GHCR)

### Docker Images

| Image | Source Repo | Tier |
|-------|------------|------|
| `ghcr.io/samyn92/agentops-operator` | agentops-core | Core |
| `ghcr.io/samyn92/mcp-gateway` | agentops-core | Core |
| `ghcr.io/samyn92/agentops-console` | agentops-console | Core |
| `ghcr.io/samyn92/agentops-memory` | agentops-memory | Core |
| `ghcr.io/samyn92/agentops-runtime-fantasy` | agentops-runtime | Ecosystem |
| `ghcr.io/samyn92/agent-channel-webhook` | agent-channels | Ecosystem |
| `ghcr.io/samyn92/agent-channel-gitlab` | agent-channels | Ecosystem |
| `ghcr.io/samyn92/agent-channel-gitlab-label` | agent-channels | Ecosystem |
| `ghcr.io/samyn92/agent-tools/*-server` (5) | agent-tools | Ecosystem |

### Helm Charts (OCI)

| Chart | Registry Path | Tier |
|-------|--------------|------|
| `agentops-platform` | `oci://ghcr.io/samyn92/charts/agentops-platform` | Core (umbrella) |
| `agentops-operator` | `oci://ghcr.io/samyn92/charts/agentops-operator` | Core (sub-chart) |
| `agentops-console` | `oci://ghcr.io/samyn92/charts/agentops-console` | Core (sub-chart) |
| `agent-factory` | `oci://ghcr.io/samyn92/charts/agent-factory` | Ecosystem |

### OCI Tool Artifacts

| Artifact | Registry Path |
|----------|--------------|
| kubectl | `ghcr.io/samyn92/agent-tools/kubectl` |
| git | `ghcr.io/samyn92/agent-tools/git` |
| github | `ghcr.io/samyn92/agent-tools/github` |
| gitlab | `ghcr.io/samyn92/agent-tools/gitlab` |
| kube-explore | `ghcr.io/samyn92/agent-tools/kube-explore` |
| flux | `ghcr.io/samyn92/agent-tools/flux` |

---

## Release Flow

### Platform Release (Coordinated)

A platform release is a coordinated process across 3 repos:

```
Step 1: agentops-core
  Tag v0.8.0
  → CI: lint, test, build operator + gateway images (0.8.0)
  → CI: package + push agentops-operator chart (0.8.0)
  → Creates GitHub Release

Step 2: agentops-console
  Tag v0.8.0
  → CI: build + vet
  → CI: Docker image (0.8.0)
  → CI: package + push agentops-console chart (0.8.0)   ← NEW
  → Creates GitHub Release

Step 3: agentops-platform
  Update Chart.yaml dependency versions to 0.8.0
  Tag v0.8.0
  → CI: dep build (pulls operator 0.8.0 + console 0.8.0 + tempo)
  → CI: lint, template, package
  → CI: push umbrella chart (0.8.0)
  → Creates GitHub Release with install instructions
```

**Order matters.** Steps 1 and 2 can run in parallel. Step 3 must wait for both.

### Ecosystem Release (Independent)

Each ecosystem component releases independently:

```
agent-tools: Tag v0.4.0 → build all servers + CLI, push OCI artifacts + images
agent-factory: Tag v0.2.0 → lint, template, push chart
agent-channels: Tag v0.3.0 → build + push bridge images
agentops-runtime: Tag v0.5.0 → build + push runtime image
```

No coordination needed. These are consumed by Agent CRs, not by the platform chart.

---

## Chart Architecture Details

### agentops-platform (Umbrella)

```
charts/agentops-platform/
├── Chart.yaml                    # Dependencies: operator, console, tempo
├── Chart.lock
├── values.yaml                   # Umbrella values with sub-chart overrides
├── charts/                       # Downloaded sub-chart archives
│   ├── agentops-operator-X.Y.Z.tgz
│   ├── agentops-console-X.Y.Z.tgz
│   └── tempo-X.Y.Z.tgz
└── templates/
    ├── _helpers.tpl              # Name/label helpers + URL resolution
    ├── NOTES.txt                 # Post-install instructions
    ├── namespace.yaml            # agents namespace (conditional)
    ├── memory-deployment.yaml    # agentops-memory Deployment
    ├── memory-service.yaml       # agentops-memory ClusterIP Service
    └── memory-pvc.yaml           # agentops-memory PVC
```

**Design choice: agentops-memory as inline templates.** agentops-memory is a simple Deployment + Service + PVC.
Creating a separate chart for it would add overhead (separate repo, separate release cycle,
OCI packaging) with no benefit. If it grows in complexity (e.g., HA mode, backup jobs),
we can extract it to a sub-chart later.

### agent-factory (Library Chart for Agents)

```
helm/agent-factory/
├── Chart.yaml                    # No dependencies (CRDs must be pre-installed)
├── values.yaml                   # Comprehensive agent + capability config
├── templates/
│   ├── _helpers.tpl
│   ├── agent.yaml                # Agent CR
│   ├── capabilities.yaml         # 12+ capability types
│   ├── tools.yaml                # analyze_risk tool + skill
│   ├── channels.yaml             # GitLab/GitHub channels
│   ├── workflows.yaml            # Workflow CRs
│   ├── rbac.yaml                 # Per-capability RBAC
│   ├── secrets.yaml              # API keys, tokens
│   ├── networkpolicy.yaml        # Egress/ingress rules
│   └── NOTES.txt
├── presets/                      # Ready-to-use agent personas
│   ├── developer-assistant.yaml
│   ├── github-agent.yaml
│   ├── gitlab-agent.yaml
│   ├── ops-agent.yaml
│   ├── platform-agent.yaml
│   ├── security-auditor.yaml
│   └── sre-agent.yaml
├── environments/                 # Security/resource overlays
│   ├── dev.yaml
│   ├── staging.yaml
│   └── prod.yaml
└── examples/
    ├── workflow-pr-risk-analysis.yaml
    ├── workflow-mr-risk-analysis.yaml
    └── multi-agent/
        └── incident-response-team/   # Multi-agent umbrella example
```

**Usage pattern:**

```bash
# Single agent with preset
helm install my-agent oci://ghcr.io/samyn92/charts/agent-factory \
  -n agents \
  -f presets/sre-agent.yaml \
  -f environments/prod.yaml \
  --set agent.name=my-sre \
  --set secrets.apiKey=sk-...

# Multi-agent team (umbrella over agent-factory sub-charts)
helm install irt ./incident-response-team -n agents
```

### Future: Agent Library Chart

When the PLAN.md CRD redesign lands (Trigger, Workflow, AgentSkill), agent-factory
will evolve to template these new CRDs. The preset/environment/workflow overlay pattern
stays the same — it's the right abstraction regardless of CRD changes.

---

## Cross-Repository Dependencies

```
                    Go Module Dependencies
                    ──────────────────────
agentops-console ──depends on──> agentops-core (Go types)


                    Helm Chart Dependencies
                    ───────────────────────
agentops-platform
  ├── agentops-operator  (OCI chart from agentops-core)
  ├── agentops-console   (OCI chart from agentops-console)
  └── tempo              (Grafana public chart)

agent-factory
  └── requires agentops-core CRDs pre-installed (no hard dep)


                    Runtime Image References
                    ────────────────────────
Agent CRs ──reference──> agentops-runtime-fantasy (image)
Agent CRs ──reference──> agent-tools/* (OCI artifacts)
Channel CRs ──reference──> agent-channel-* (images)
```

The **only Go module cross-dependency** is `console -> core`. Everything else
is loosely coupled through image/chart references at deploy time.

---

## Installation

### Quick Start (Full Platform)

```bash
helm install agentops oci://ghcr.io/samyn92/charts/agentops-platform \
  --namespace agent-system --create-namespace \
  --version 0.8.0
```

This deploys:
- Operator (CRDs + controller) in `agent-system`
- Console (BFF + PWA) in `agent-system`
- agentops-memory (memory) in `agents` namespace
- Tempo (tracing) in `agent-system`
- Creates the `agents` namespace

### Minimal (Operator Only)

```bash
helm install agentops oci://ghcr.io/samyn92/charts/agentops-platform \
  --namespace agent-system --create-namespace \
  --set agentops-console.enabled=false \
  --set memory.enabled=false \
  --set tempo.enabled=false
```

### With Ingress

```bash
helm install agentops oci://ghcr.io/samyn92/charts/agentops-platform \
  --namespace agent-system --create-namespace \
  --set agentops-console.ingress.enabled=true \
  --set agentops-console.ingress.hosts[0].host=agentops.example.com \
  --set agentops-console.ingress.tls[0].secretName=agentops-tls \
  --set agentops-console.ingress.tls[0].hosts[0]=agentops.example.com
```

### Then Deploy Agents

```bash
# Using agent-factory
helm install my-agent oci://ghcr.io/samyn92/charts/agent-factory \
  -n agents \
  -f my-agent-values.yaml

# Or raw CRs
kubectl apply -f my-agent.yaml -n agents
```

---

## CI/CD Workflow Summary

| Repo | CI Trigger | Release Trigger | Artifacts |
|------|-----------|----------------|-----------|
| agentops-core | push/PR to main | tag `v*` | Docker (operator, gateway), Helm chart, install.yaml |
| agentops-console | push/PR to main | tag `v*` | Docker (console), Helm chart |
| agentops-runtime | push/PR to main | tag `v*` | Docker (runtime) |
| agentops-platform | push/PR to main | tag `v*` | Helm umbrella chart |
| agent-tools | push/PR to main | tag `v*` | CLI binaries, OCI tool artifacts, Docker images |
| agent-factory | push/PR on helm/** | tag `v*` | Helm chart |
| agent-channels | push/PR to main | tag `v*` | Docker (webhook, gitlab, gitlab-label) |

All artifacts are pushed to `ghcr.io/samyn92/`. Versioning: tag `v*` → strip `v` prefix → use as image tag / chart version.

---

## Known Gaps & Future Work

| Gap | Status | Plan |
|-----|--------|------|
| No CI workflow for agentops-console | Missing | Add lint/test/vet on PRs |
| No multi-arch Docker builds | All repos | Add `platforms: linux/amd64,linux/arm64` to build-push-action |
| agent-channels uses Go 1.24 | Version drift | Upgrade to 1.26 |
| agentops-memory has own source and Dockerfile | Built from `samyn92/agentops-memory` | Image: `ghcr.io/samyn92/agentops-memory` |
| No Flux/ArgoCD HelmRelease manifests | Not in repos | Add to homecluster GitOps repo for k3s |
| Console chart env auto-wiring | Implemented in umbrella values | Users set TEMPO_URL/ENGRAM_URL_OVERRIDE via values |
| NetworkPolicy for agentops-memory/Tempo | Not yet | Add optional NetworkPolicy templates |
| PodDisruptionBudget | Not yet | Add for operator and console |
