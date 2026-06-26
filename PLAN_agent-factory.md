# PLAN: Agent Factory — GitOps-Native DevOps Harness

> Status: Design  
> Created: 2026-06-21  
> Context: Multi-tenant OIDC is live, Plan Refinement UI works. The console is now a proper GitLab-native platform. This plan describes the agent factory architecture — purpose-built agent compositions for DevOps/GitOps teams managing large-scale Kubernetes infrastructure.

## Vision

AgentOps becomes a **GitOps-native DevOps harness** where:
- Agent teams are deployed as **factories** — pre-composed sets of agents tuned to a domain (DevOps, GitOps, Platform Engineering)
- Each factory is a Helm chart that deploys the right agents, channels, integrations, and tokens for a specific scope (group, cluster, team)
- Identity is clean: **humans** act as themselves (OIDC), **agents** act as scoped bot service accounts (per-role GitLab tokens)
- The CRD model supports custom domain factories — DevOps/GitOps is the first, but the same pattern works for ML/Data, Security, Frontend, etc.

## Identity Architecture (Three Tiers)

```
┌─────────────────────────────────────────────────────────────────────┐
│  HUMAN (OIDC)                                                        │
│  Who: Developer/SRE/Platform Engineer via GitLab SSO                │
│  Can: Browse, comment, approve, merge, dispatch agents              │
│  Token: OAuth2 access_token from session                            │
│  Shows as: "samyn92" in GitLab activity                             │
│  Boundary: GitLab's permission model (protected branches block)     │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  PLATFORM AGENTS (Group Access Token — Developer role)               │
│  Who: Planners, Reviewers, Coordinators                             │
│  Can: Read repos, comment on issues/MRs, open issues, assign labels│
│  Cannot: Push code, open MRs, merge                                 │
│  Token: Group Access Token, scopes: api                             │
│  Shows as: "agentops-planner" in GitLab                             │
│  One SA per group (shared by all planning/review agents in scope)   │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  WORKER AGENTS (Group Access Token — Developer role + write_repo)    │
│  Who: Implementers, CI Fixers, Dependency Updaters                  │
│  Can: Push branches, open MRs, comment — CANNOT merge               │
│  Token: Group Access Token, scopes: api, write_repository           │
│  Shows as: "agentops-coder" in GitLab                               │
│  Protected branches block merges (human approval required)          │
└─────────────────────────────────────────────────────────────────────┘
```

## Agent Archetypes (DevOps/GitOps Domain)

| Archetype | Mode | Scope | GitLab SA | Purpose |
|-----------|------|-------|-----------|---------|
| **Planner** | daemon | per-group | agentops-planner (api) | Plans work, refines specs, coordinates across repos |
| **Implementer** | task | per-repo/cluster | agentops-coder (api, write_repo) | Writes code, opens MRs, fixes CI failures |
| **Reviewer** | daemon | per-group | agentops-planner (api) | Reviews MRs, validates configs, checks standards |
| **Observer** | daemon | per-cluster | K8s SA only | Watches flux, detects drift, opens issues on failures |
| **CI Fixer** | task | per-repo | agentops-coder (api, write_repo) | Auto-fixes failing pipelines (retry-budget guarded) |
| **Dependency Updater** | task+cron | per-group | agentops-coder (api, write_repo) | Bumps versions, updates HelmReleases |
| **Security Scanner** | task+cron | per-group | agentops-planner (api) | Scans configs, opens issues for findings |
| **Release Manager** | daemon | per-group | agentops-coder (api, write_repo) | Coordinates multi-repo releases, tags, changelogs |

## Factory Scope Model (Your 50+ Cluster Setup)

```
┌─── GROUP LEVEL (company/infra — all 50+ repos) ─────────────────────┐
│                                                                       │
│  Integration: gitlab-group "company/infra"                           │
│    └─ Token: agentops-planner (Group Access Token, Developer, api)   │
│                                                                       │
│  Integration: gitlab-group-coder "company/infra"                     │
│    └─ Token: agentops-coder (Group Access Token, Developer,          │
│              api + write_repository)                                   │
│                                                                       │
│  Agents:                                                              │
│  ├── infra-planner (daemon) — cross-repo planning, sprint alignment │
│  ├── infra-reviewer (daemon) — MR review, standards enforcement     │
│  ├── infra-release-mgr (daemon) — release coordination              │
│  └── infra-security (task+cron) — weekly security scans             │
│                                                                       │
│  Channels:                                                            │
│  ├── gitlab-label: agent::todo → fires infra-implementer            │
│  ├── gitlab-label: agent::changes-requested → re-fires implementer  │
│  └── gitlab-comment: @agentops on issues → routes to planner        │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘

┌─── CLUSTER LEVEL (one per k8s cluster gitops repo) ──────────────────┐
│                                                                       │
│  Integration: gitlab-project "company/infra/clusters/prod-eu"        │
│    └─ Token: agentops-coder (Project Access Token or inherited)      │
│                                                                       │
│  Agents:                                                              │
│  ├── prod-eu-observer (daemon) — watches flux, detects drift         │
│  ├── prod-eu-implementer (task) — helm values, kustomizations       │
│  └── prod-eu-ci-fixer (task) — pipeline failure auto-repair         │
│                                                                       │
│  The observer opens issues on the group when drift is detected.      │
│  The implementer handles issues labeled for this cluster.            │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘

┌─── SHARED SERVICES (cross-cutting) ─────────────────────────────────┐
│                                                                       │
│  Agents:                                                              │
│  ├── dep-updater (task+cron) — weekly dependency bumps across all   │
│  └── changelog-generator (task) — release notes from MR history     │
│                                                                       │
│  Provider:                                                            │
│  └── anthropic (or openrouter) — shared LLM backend for all agents  │
│                                                                       │
│  Memory:                                                              │
│  └── agentops-memory — shared context store, per-agent projects     │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

## Factory Helm Chart Design

The agent-factory chart is a **library chart** that generates CRDs from values. One `helm install` deploys a complete agent team for a scope.

### Usage

```bash
# Deploy the DevOps/GitOps factory for your infra group
helm install infra-agents oci://ghcr.io/samyn92/agentops/charts/agent-factory \
  -n agents \
  -f factory-devops-gitops.yaml \
  --set scope.gitlab.group=company/infra \
  --set scope.gitlab.baseURL=https://gitlab.com \
  --set secrets.plannerToken=glpat-xxx \
  --set secrets.coderToken=glpat-yyy \
  --set secrets.llmApiKey=sk-ant-xxx
```

### Values Structure

```yaml
# factory-devops-gitops.yaml — DevOps/GitOps Agent Factory preset
factory:
  domain: devops-gitops
  version: "1.0"

scope:
  # What this factory manages
  gitlab:
    group: company/infra            # GitLab group path
    baseURL: https://gitlab.com
  # Cluster-level sub-scopes (optional — generates per-cluster agents)
  clusters:
    - name: prod-eu
      project: company/infra/clusters/prod-eu
      observer: true
    - name: staging
      project: company/infra/clusters/staging
      observer: true

# GitLab Service Accounts (bot tokens)
tokens:
  planner:
    role: Developer
    scopes: [api]
    secretName: gitlab-bot-planner     # Pre-created K8s Secret
    secretKey: token
  coder:
    role: Developer
    scopes: [api, write_repository]
    secretName: gitlab-bot-coder
    secretKey: token

# LLM Provider
provider:
  name: anthropic
  type: anthropic
  apiKeySecret: {name: llm-api-keys, key: ANTHROPIC_API_KEY}
  defaultModel: anthropic/claude-sonnet-4-20250514
  fallbackModel: anthropic/claude-haiku-4-5-20251001

# Agent composition (which archetypes to deploy)
agents:
  planner:
    enabled: true
    mode: daemon
    model: "{{ .Values.provider.defaultModel }}"
    systemPrompt: |
      You are the planning agent for {{ .Values.scope.gitlab.group }}.
      You coordinate work across all repos in the group, refine plans,
      and ensure consistent standards. You can read all repos but cannot
      push code. Work items are GitLab issues with agent:: labels.
    tools: [git, gitlab]
    memory: true
    integration: planner         # uses planner token (read + comment)

  implementer:
    enabled: true
    mode: task
    model: "{{ .Values.provider.defaultModel }}"
    systemPrompt: |
      You are the implementation agent for {{ .Values.scope.gitlab.group }}.
      You write code, open merge requests, and fix CI failures.
      Work on the feature branch specified in your git workspace.
    tools: [git, gitlab, bash, kubectl, helm]
    memory: true
    integration: coder           # uses coder token (push + MR)
    concurrency: {maxRuns: 3, policy: queue}
    timeout: "20m"

  reviewer:
    enabled: true
    mode: daemon
    model: "{{ .Values.provider.defaultModel }}"
    systemPrompt: |
      You are the code reviewer for {{ .Values.scope.gitlab.group }}.
      Review MRs for correctness, security, and GitOps best practices.
      Post your review as MR notes. Approve or request changes.
    tools: [git, gitlab]
    memory: true
    integration: planner

  observer:
    enabled: true
    mode: daemon
    perCluster: true             # generates one per cluster in scope.clusters[]
    model: "{{ .Values.provider.fallbackModel }}"
    systemPrompt: |
      You are the drift observer for cluster {{ .cluster.name }}.
      Watch for Flux reconciliation failures, HelmRelease drift, and
      unhealthy Kustomizations. Open issues when you detect problems.
    tools: [kubectl, gitlab]
    integration: planner
    schedule: "*/5 * * * *"      # check every 5 minutes
    schedulePrompt: "Check cluster health and flux reconciliation status."

  ciFixer:
    enabled: true
    mode: task
    model: "{{ .Values.provider.defaultModel }}"
    systemPrompt: |
      You are the CI repair agent. Fix failing pipeline jobs by reading
      the failure logs, understanding the error, and pushing a fix.
    tools: [git, gitlab, bash]
    integration: coder
    concurrency: {maxRuns: 2, policy: reject}

  depUpdater:
    enabled: false               # opt-in
    mode: task
    model: "{{ .Values.provider.fallbackModel }}"
    schedule: "0 8 * * 1"        # Monday 8am
    schedulePrompt: "Check for outdated Helm chart versions and container image tags. Open MRs for updates."
    tools: [git, gitlab, bash, helm]
    integration: coder

# Channels (event routing)
channels:
  labelBridge:
    enabled: true
    type: gitlab-label
    integration: planner
    targets:
      - label: "agent::todo"
        agent: implementer
      - label: "agent::changes-requested"
        agent: implementer
    pollInterval: 30s

  commentBridge:
    enabled: false               # opt-in: @agentops mentions route to planner
    type: gitlab-comment
    integration: planner
    agent: planner
    planningLabel: "agent::planning"

# Memory (shared instance)
memory:
  enabled: true
  serverRef: agentops-memory     # external memory service
```

## CRD Design Principles (for Factory Compatibility)

1. **Composable** — Agents reference Integrations/Providers by name. Factories generate these as a consistent set.
2. **Scope-aligned** — One Integration per token scope. Planner token = read+comment. Coder token = read+write+MR.
3. **Domain-extensible** — The factory `domain` field determines the system prompts, tool sets, and agent archetypes. DevOps/GitOps is first-class, but ML/Data, Security, Frontend are the same pattern with different presets.
4. **Per-cluster optional** — The `perCluster: true` flag on agent definitions generates one agent per entry in `scope.clusters[]`.
5. **Delegation-native** — Planners delegate to implementers via the `run_agent` tool. The team roster is auto-generated from the factory composition.

## Migration from Current State

### What exists today (k3s dev cluster)
- `homecluster-repo` Integration (single gitlab-project, shared token)
- `svc-pm` daemon (planner)
- `svc-planner`, `svc-observability`, `svc-release-mgr` daemons
- `homecluster-manager` daemon
- `platform-lead` daemon
- One shared `gitlab-token` Secret (currently empty — agents broken)

### What needs to happen
1. **Create GitLab Service Accounts** — `agentops-planner` + `agentops-coder` Group Access Tokens on `samyn92` group (or lab subgroup)
2. **Deploy per-role Secrets** — `gitlab-bot-planner` + `gitlab-bot-coder` in `agents` namespace
3. **Split the Integration** — `homecluster-repo` → two Integrations (one per token scope)
4. **Consolidate agents** — current 6 daemons → factory-generated composition (planner, implementer, reviewer, observer)
5. **Build the factory Helm chart** — `agent-factory` library chart at `oci://ghcr.io/samyn92/agentops/charts/agent-factory`
6. **Console uses bot token for agent notes** — already done (refine endpoint)

## Implementation Phases

### Phase 1: Token Separation (immediate, unblocks agents)
- [ ] Create `agentops-planner` Group Access Token (Developer, api) on GitLab
- [ ] Create `agentops-coder` Group Access Token (Developer, api+write_repo)
- [ ] Deploy K8s Secrets: `gitlab-bot-planner`, `gitlab-bot-coder`
- [ ] Create two Integrations: `infra-planner-intg` (planner token) + `infra-coder-intg` (coder token)
- [ ] Verify: agents can read/write GitLab via their scoped tokens

### Phase 2: Agent Factory Helm Chart (scaffolding)
- [ ] Create `agent-factory` repo (or directory in agentops-platform)
- [ ] Implement values schema (scope, tokens, provider, agents, channels, memory)
- [ ] Templates generate: Provider, Integrations, Agents, Channels, Secrets
- [ ] `devops-gitops` preset values file
- [ ] Test: `helm template` produces valid CRDs for the samyn92 group

### Phase 3: Per-Cluster Observers
- [ ] Observer agent archetype: watches flux, opens issues
- [ ] `perCluster` template loop in factory chart
- [ ] `kubectl` tool with cluster-scoped kubeconfig (read-only SA)
- [ ] Test: observer detects drift on local k3s, opens GitLab issue

### Phase 4: Channel Bridges (event-driven dispatch)
- [ ] gitlab-label bridge deployed via factory chart
- [ ] gitlab-comment bridge (opt-in, @agentops mention routing)
- [ ] Integration.Triggers for MR events (auto-review on MR open)

### Phase 5: Console Factory Management UI
- [ ] Factory deployment wizard in console (select domain → configure → deploy)
- [ ] Factory status overview (all agents + their health)
- [ ] Factory-level settings (tokens, provider, model rotation)

## Relationship to Other Plans

| Plan | Relationship |
|------|-------------|
| `PLAN_multi-tenant-oidc.md` | **Implemented** — foundation for human identity. Factory builds on top. |
| `PLAN_platform-operating-model.md` | Factory chart follows the same release/versioning model (OCI, auto-bumps). |
| `PLAN_eval.md` | Eval targets factory-deployed agents. Factory generates eval config. |
| `Plan_intent-tools.md` | Tool servers consumed by factory agents (git, gitlab, kubectl, helm). |

## Open Questions

1. **Factory CRD vs Helm-only?** — Should there be a `Factory` CRD that the operator reconciles (generating sub-CRDs), or is Helm-only sufficient? Helm-only is simpler but loses the operator's drift reconciliation.
2. **Token rotation** — GitLab tokens expire. Should the operator rotate them, or is external (Vault, sealed-secrets) sufficient?
3. **Multi-cluster** — The observer watches a remote cluster via kubeconfig. How to securely distribute cluster credentials? (Sealed secrets? External Secrets Operator?)
4. **Cost governance** — The factory generates many agents. How to cap total LLM spend? Per-factory budget? Per-agent budgets? Provider-level rate limiting?
