---
title: "Roadmap"
linkTitle: "Roadmap"
weight: 2
description: "Planned features and upcoming development."
---

This roadmap covers the major features planned for AgentOps. Items are roughly ordered by priority. Timelines are not committed -- this is an independent project and development happens as capacity allows.

---

## AgentSkill CRD

Curated knowledge injected into agent system prompts. Static expertise (runbooks, procedures, domain knowledge) complementing agentops-memory's dynamic experience (lessons learned, decisions).

**Sources:**

- **Git sync** -- pull markdown from a Git repository, auto-update on push
- **OCI** -- skill packages as OCI artifacts, versioned and cached
- **Inline** -- small markdown blocks directly in the CR (prototyping)
- **ConfigMap** -- mount existing ConfigMaps as skill content

**Injection modes:**

- **Always** -- injected into every prompt
- **On-demand** -- available via a tool, agent decides when to load
- **Keyword-triggered** -- injected when the prompt matches configured keywords

**Memory-to-Skill promotion bridge:** When an observation in agentops-memory is mature and proven (high access count, validated by the user), it can be promoted to a persistent AgentSkill. This bridges the gap between dynamic experience and codified knowledge.

---

## Trigger CRD

Replaces the current Channel CRD with a unified entry point for all external events and schedules.

**Planned trigger types:**

- Webhook (generic, GitHub, GitLab)
- Chat platforms (Telegram, Slack, Discord)
- Cron schedules (currently embedded in Agent spec)
- Kubernetes events (watch for specific resource changes)
- Queue consumers (SQS, NATS, Redis streams)

The Trigger CRD separates "how events arrive" from "what agent handles them," enabling multiple triggers per agent and trigger reuse across agents.

---

## Workflow + WorkflowRun CRDs

Declarative DAG execution for multi-step agent pipelines.

**Planned features:**

- **Parallel nodes** -- fan-out to multiple agents or steps simultaneously
- **Conditional routing** -- branch based on previous step output or external state
- **Loops** -- repeat steps until a condition is met
- **Gates** -- human approval steps that pause the workflow until approved in the console
- **Shared git workspace** -- all steps in a workflow operate on the same checked-out repository via a shared PVC
- **WorkflowRun** tracks execution state, per-step status, and aggregated output

---

## Agent overrides

Slim down Agent CRs by moving shared defaults to Helm values.

Currently every Agent CR must specify its full configuration (image, providers, resources, tool hooks, etc.). With agent overrides:

- **Platform defaults** in Helm values (default image, provider secrets, resource limits, blocked commands)
- **Agent CR** only specifies what differs from the defaults
- **Merge strategy** at reconcile time: Agent spec overrides platform defaults, unset fields inherit

This reduces boilerplate significantly when running many agents with similar configurations.

---

## Intent-based tools

Evolving tool servers from raw CLI wrappers to smart, intent-based tools that understand what the agent is trying to accomplish.

**Planned smart tool servers:**

| Server | Purpose |
|--------|---------|
| `kube-explore` (existing) | Intent-based Kubernetes exploration -- already implements this pattern |
| `git-flow` | Branch strategy-aware Git operations (feature branches, rebasing, conflict resolution) |
| `flux-ops` | GitOps-aware operations (drift detection, dependency analysis, rollback planning) |
| `ci-ops` | CI pipeline operations (trigger, retry, analyze failures, artifact retrieval) |
| `platform-observe` | Unified observability (correlate metrics, logs, traces across services) |

**ToolPreset CRD:** Pre-configured tool bundles. Instead of listing 6 AgentTool bindings, reference a single ToolPreset (e.g. `platform-engineer` preset includes kubectl, kube-explore, flux, git, github).

**Tool Display (`spec.display`):** Rich rendering metadata on AgentTool CRs. Custom card renderers loaded as OCI artifacts, enabling domain-specific visualization of tool results in the console.

---

## Security hardening

Approximately 50 remaining security items across P1 (critical) and P2 (important):

**P1 items include:**

- Network policy enforcement for all agent pods
- Secret rotation support
- RBAC least-privilege audit for operator and agent service accounts
- Tool call rate limiting
- Input sanitization for all CRD fields

**P2 items include:**

- Pod security standards enforcement
- Audit logging for all operator actions
- mTLS between agent pods and MCP tool servers
- Image signature verification for OCI tool artifacts
- Cost budget enforcement with hard limits

---

## Infrastructure improvements

- **Multi-arch builds** -- ARM64 images for all components (operator, runtime, console, memory, tool servers)
- **Flux HelmRelease manifests** -- ready-to-use GitOps manifests for deploying AgentOps via Flux CD
- **ArgoCD Application manifests** -- equivalent for ArgoCD users
- **Horizontal pod autoscaling** for the console and memory service
- **Backup/restore** for the memory service SQLite database
