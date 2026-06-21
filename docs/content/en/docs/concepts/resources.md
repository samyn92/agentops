---
title: "Agent Resources"
linkTitle: "Resources"
weight: 6
description: "Declarative external resource catalog — Git repos, S3 buckets, documentation — and how agents bind to them."
---

An **AgentResource** is a Kubernetes CRD that represents an external resource agents can work with. It provides a declarative catalog entry for things like GitHub repositories, GitLab projects, S3 buckets, and documentation — along with the credentials needed to access them.

Resources are separate from agents by design. You declare a resource once, then bind it to any number of agents.

## Why a separate CRD?

Without AgentResource, every agent that needs access to a repository would duplicate the owner, repo name, branch, and credential reference in its own spec. AgentResource centralizes that:

- **One resource, many agents.** A single `agentops-core-repo` AgentResource can be bound to a platform engineer, a code reviewer, and a security scanner.
- **Credential isolation.** The resource holds the secret reference. Agents only see a binding name — they never declare credentials directly.
- **Console integration.** The AgentOps Console uses AgentResource metadata to power the resource browser (files, commits, branches, MRs, issues) and resource context chips in the composer.
- **Git workspace provisioning.** AgentRuns reference an AgentResource to clone a repo, check out a branch, and give the task agent a ready-to-use `/workspace`.

## Resource kinds

AgentResource supports seven kinds of external resources:

| Kind | Config block | What it represents |
|------|--------------|--------------------|
| `github-repo` | `spec.github` | A single GitHub repository |
| `github-org` | `spec.githubOrg` | A GitHub organization (optionally filtered to specific repos) |
| `gitlab-project` | `spec.gitlab` | A single GitLab project |
| `gitlab-group` | `spec.gitlabGroup` | A GitLab group (optionally filtered to specific projects) |
| `git-repo` | `spec.git` | Any git repository via HTTPS or SSH URL |
| `s3-bucket` | `spec.s3` | An S3-compatible bucket (AWS, MinIO, etc.) |
| `documentation` | `spec.documentation` | Documentation URLs or ConfigMap-backed content |

Each kind has its own configuration block. Exactly one must be set, matching the `kind` field.

## Example: GitHub repository

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentResource
metadata:
  name: agentops-core-repo
  namespace: agents
spec:
  kind: github-repo
  displayName: AgentOps Core
  description: "AgentOps Kubernetes operator — CRDs, controllers, resource management"
  credentials:
    name: github-token
    key: GITHUB_TOKEN
  github:
    owner: samyn92
    repo: agentops-core
    defaultBranch: main
```

## Example: GitLab project

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentResource
metadata:
  name: homecluster-repo
  namespace: agents
spec:
  kind: gitlab-project
  displayName: Homecluster
  description: "k3s homecluster GitOps repo — Flux, Helm, infrastructure"
  credentials:
    name: gitlab-token
    key: GITLAB_TOKEN
  gitlab:
    baseURL: https://gitlab.com
    project: samyn92/homecluster
    defaultBranch: main
```

## Agent resource bindings

Agents bind to resources through `spec.resourceBindings` on the Agent CR. A binding is a lightweight reference — just a name and two optional flags:

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Agent
metadata:
  name: platform-engineer
  namespace: agents
spec:
  # ... model, tools, memory, etc.
  resourceBindings:
    - name: agentops-core-repo
    - name: homecluster-repo
      readOnly: true
    - name: platform-docs
      autoContext: true
```

### Binding fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Name of the AgentResource CR to bind. |
| `readOnly` | bool | `false` | Advisory flag — signals to the runtime that the agent should not modify this resource. |
| `autoContext` | bool | `false` | Automatically inject this resource's context into every prompt without requiring manual selection in the console UI. |

The operator resolves all resource bindings during Agent reconciliation and sets the `ResourcesReady` condition on the Agent status. If any referenced AgentResource is missing or not in `Ready` phase, the agent will not reach `Ready`.

## Git workspace for AgentRuns

AgentRuns can reference an AgentResource to get a fully provisioned git workspace. This is the primary mechanism for task agents that need to work on code:

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentRun
metadata:
  name: review-pr-42
  namespace: agents
spec:
  agentRef: code-reviewer
  prompt: "Review PR #42 on samyn92/agentops-core"
  source: channel
  sourceRef: github-prs
  git:
    resourceRef: agentops-core-repo   # AgentResource CR name
    branch: feature/new-crd
    baseBranch: main
```

When `spec.git` is set, the operator:

1. Resolves the AgentResource CR from `resourceRef` to get the clone URL and credentials.
2. Configures the Job pod to clone the repository and check out (or create) the feature branch.
3. Mounts the workspace at `/workspace` for the agent runtime.
4. After execution, the AgentRun's `status.outcome` captures the structured result — intent (`change` | `plan` | ...), a short summary, and typed artifacts (PR/MR, commit, issue, memory). See [AgentRun outcome](../agents/#agentrun-outcome).

This works with `github-repo`, `gitlab-project`, and `git-repo` resource kinds.

## Console integration

The AgentOps Console uses AgentResource metadata extensively:

- **Resource browser** — users can navigate repository files, commits, branches, merge requests, and issues directly from the console for `github-repo` and `gitlab-project` resources.
- **Resource chips** — in the composer, users attach resource chips to scope their prompt. The agent receives the selected resource context alongside the user's message.
- **Auto-context** — resources with `autoContext: true` on their binding are injected into every prompt automatically, without the user selecting them.

## How it flows through the system

| Component | Role |
|-----------|------|
| **Operator** (AgentResource controller) | Validates kind-specific config, sets phase to `Ready` or `Failed`. |
| **Operator** (Agent controller) | Resolves `resourceBindings`, checks all are `Ready`, serializes resource metadata into the agent's ConfigMap. |
| **Operator** (AgentRun controller) | Resolves `spec.git.resourceRef` to get clone URL and credentials for git workspace provisioning. |
| **Runtime** | Reads resource metadata from ConfigMap at startup. Builds a lookup map for self-knowledge and delegation. |
| **Console BFF** | Serves `/api/v1/agentresources` (list), `/api/v1/agentresources/{ns}/{name}` (get), and `/api/v1/agents/{ns}/{name}/resources` (resolved bindings). |
| **Console UI** | Renders resource browser, resource chips in composer, and resource metadata in agent inspector. |

## Status and lifecycle

AgentResource has a simple lifecycle:

| Phase | Meaning |
|-------|---------|
| `Pending` | Just created, not yet validated. |
| `Ready` | Kind-specific config is valid, resource is usable. |
| `Failed` | Validation failed (e.g. `kind: github-repo` but no `spec.github` block). |

The controller validates that the kind-specific config block matches the `kind` field and sets a `Ready` condition. Additional validation (e.g. required fields within config blocks) is handled by the admission webhook.

```
$ kubectl get agentresources -n agents
NAME                       KIND              DISPLAY NAME       PHASE   AGE
agentops-core-repo         github-repo       AgentOps Core      Ready   5d
agentops-console-repo      github-repo       AgentOps Console   Ready   5d
agentops-runtime-repo      github-repo       AgentOps Runtime   Ready   5d
agentops-memory-repo       github-repo       AgentOps Memory    Ready   5d
agentops-platform-repo     github-repo       AgentOps Platform  Ready   5d
agent-tools-repo           github-repo       Agent Tools        Ready   5d
homecluster-repo           gitlab-project    Homecluster        Ready   5d
```

## Kind-specific configuration reference

For the full field-by-field reference of each kind's configuration block, see the [CRD Reference]({{< relref "../reference/crds" >}}#agentresource).
