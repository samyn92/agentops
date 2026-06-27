---
title: "Tool Catalog"
linkTitle: "Tool Catalog"
weight: 3
description: "Complete catalog of built-in MCP tool servers with tool names and OCI references."
---

AgentOps ships seven packaged MCP tool artifacts. Each artifact is an OCI reference containing a compiled Go MCP stdio server binary plus `manifest.json`, built on the shared `mcputil` SDK that provides automatic OpenTelemetry tracing for every tool invocation. Agents declare tool refs in their specs, the operator pulls each artifact at pod startup with a `crane` init container, and the runtime starts the binary over MCP stdio.

All tool servers are published to `ghcr.io/samyn92/agentops/tools/`. Binaries follow the `mcp-{server}` naming convention.

---

## kube-explore

Intent-based Kubernetes exploration. Higher-level than raw kubectl -- the agent describes what it wants to understand, and the tool returns structured, relevant information.

**OCI ref:** `ghcr.io/samyn92/agentops/tools/kube-explore:v0.17.3`

| Tool | Mode | Description |
|------|------|-------------|
| `kube_find` | ro | Find resources by name, label, or type across namespaces. |
| `kube_health` | ro | Health assessment for a workload or namespace -- pods, conditions, events. |
| `kube_inspect` | ro | Deep inspection of a single resource with related objects. |
| `kube_topology` | ro | Map relationships between resources (owner refs, selectors, services). |
| `kube_diff` | ro | Compare live state against desired state or between two resources. |
| `kube_logs` | ro | Fetch logs with smart filtering (errors, time range, container). |
| `kube_exec` | **rw** | Execute a command in a running container. |
| `kube_apply` | **rw** | Apply a YAML manifest to the cluster. |

**8 tools** (6 read-only, 2 read-write)

---

## kubectl

Direct kubectl access for all standard operations. Provides fine-grained control when kube-explore's higher-level tools are insufficient.

**OCI ref:** `ghcr.io/samyn92/agentops/tools/kubectl:v0.17.3`

### Read-only tools

| Tool | Description |
|------|-------------|
| `kubectl_get` | Get resources (supports `-o yaml/json/wide`, label selectors, all-namespaces). |
| `kubectl_describe` | Describe a resource with events and conditions. |
| `kubectl_logs` | Fetch container logs (tail, since, previous, container). |
| `kubectl_top` | Resource usage for pods or nodes. |
| `kubectl_events` | List events filtered by namespace, type, or involved object. |
| `kubectl_api_resources` | List available API resources on the cluster. |
| `kubectl_explain` | Explain a resource field path (e.g. `pod.spec.containers`). |

### Read-write tools

| Tool | Description |
|------|-------------|
| `kubectl_exec` | Execute a command in a running container. |
| `kubectl_apply` | Apply a YAML manifest. |
| `kubectl_delete` | Delete a resource. |
| `kubectl_run` | Create and run a pod. |
| `kubectl_cp` | Copy files to/from a container. |
| `kubectl_rollout` | Manage rollouts (status, restart, undo, history). |
| `kubectl_scale` | Scale a deployment, statefulset, or replicaset. |
| `kubectl_label` | Add or update labels on a resource. |
| `kubectl_annotate` | Add or update annotations on a resource. |

**16 tools** (7 read-only, 9 read-write)

---

## git

Git operations for repository management. Agents use this for cloning repos, making changes, and pushing commits.

**OCI ref:** `ghcr.io/samyn92/agentops/tools/git:v0.17.3`

### Read-only tools

| Tool | Description |
|------|-------------|
| `git_status` | Show working tree status. |
| `git_diff` | Show changes between commits, index, or working tree. |
| `git_log` | Show commit history. |
| `git_branch_list` | List branches. |
| `git_show` | Show a commit, tag, or object. |

### Read-write tools

| Tool | Description |
|------|-------------|
| `git_add` | Stage files for commit. |
| `git_commit` | Create a commit. |
| `git_push` | Push commits to remote. |
| `git_pull` | Pull changes from remote. |
| `git_branch` | Create, delete, or switch branches. |
| `git_clone` | Clone a repository. |
| `git_clone_or_pull` | Clone if not present, pull if already cloned. |

**12 tools** (5 read-only, 7 read-write)

---

## github

GitHub API operations. Agents use this for pull request workflows, issue management, and CI status checks.

**OCI ref:** `ghcr.io/samyn92/agentops/tools/github:v0.17.3`

| Tool | Mode | Description |
|------|------|-------------|
| `github_get_repo` | ro | Get repository information. |
| `github_list_prs` | ro | List pull requests with filters (state, author, labels). |
| `github_get_pr` | ro | Get pull request details. |
| `github_get_pr_diff` | ro | Get the diff for a pull request. |
| `github_create_pr` | **rw** | Create a new pull request. |
| `github_add_pr_comment` | **rw** | Add a comment to a pull request. |
| `github_list_issues` | ro | List issues with filters. |
| `github_get_issue` | ro | Get issue details. |
| `github_add_issue_comment` | **rw** | Add a comment to an issue. |
| `github_list_branches` | ro | List repository branches. |
| `github_get_check_runs` | ro | Get check run results for a commit or PR. |
| `github_get_workflow_runs` | ro | Get GitHub Actions workflow run results. |

**12 tools** (8 read-only, 4 read-write)

---

## helm

Helm chart inspection and release value analysis. Agents use this to inspect chart metadata, compare default values across versions, and detect value drift in deployed releases.

**OCI ref:** `ghcr.io/samyn92/agentops/tools/helm:v0.17.3`

| Tool | Mode | Description |
|------|------|-------------|
| `helm_show_values` | ro | Show default `values.yaml` for a chart version from an OCI or repository source. |
| `helm_show_chart` | ro | Show `Chart.yaml` metadata including version, appVersion, description, and dependencies. |
| `helm_values_diff` | ro | Diff default values between two versions of the same chart. |
| `helm_get_values` | ro | Get user-supplied values for a deployed Helm release. |
| `helm_drift` | ro | Compare a release's effective values against chart defaults. |

**5 tools** (5 read-only)

---

## flux

Flux CD operations for GitOps workflows. Covers inspection, debugging, reconciliation, and lifecycle management of Flux resources.

**OCI ref:** `ghcr.io/samyn92/agentops/tools/flux:v0.17.3`

### Read-only tools

| Tool | Description |
|------|-------------|
| `flux_get` | List Flux resources (kustomizations, helmreleases, sources). |
| `flux_check` | Check Flux prerequisites and component health. |
| `flux_stats` | Show reconciliation statistics. |
| `flux_logs` | Tail Flux controller logs. |
| `flux_events` | List Flux-related events. |
| `flux_trace` | Trace a resource from Git source to cluster state. |
| `flux_tree` | Show the dependency tree for a kustomization or helmrelease. |
| `flux_diff` | Show pending changes between source and live state. |
| `flux_export` | Export Flux resources as YAML manifests. |
| `flux_debug` | Debug a specific Flux resource (gather all related info). |
| `flux_version` | Show Flux CLI and controller versions. |

### Read-write tools

| Tool | Description |
|------|-------------|
| `flux_reconcile` | Trigger immediate reconciliation of a Flux resource. |
| `flux_suspend` | Suspend reconciliation of a Flux resource. |
| `flux_resume` | Resume reconciliation of a suspended Flux resource. |
| `flux_delete` | Delete a Flux resource. |

**15 tools** (11 read-only, 4 read-write)

---

## tempo

Grafana Tempo trace analysis. Agents use this to search, inspect, and aggregate execution traces for observability-driven development.

**OCI ref:** `ghcr.io/samyn92/agentops/tools/tempo:v0.17.3`

**Requires:** `TEMPO_URL` environment variable (e.g. `http://tempo.observability.svc:3200`).

| Tool | Mode | Description |
|------|------|-------------|
| `tempo_search` | ro | Search traces by service, operation, duration, or status. |
| `tempo_get` | ro | Get full trace by ID with span tree. |
| `tempo_agent_stats` | ro | Aggregate agent execution statistics across traces. |
| `tempo_slow_tools` | ro | Find slowest tool invocations across traces. |
| `tempo_errors` | ro | Find error traces and error patterns. |
| `tempo_compare` | ro | Compare two traces side-by-side. |

**6 tools** (6 read-only)

---

## AgentTool CR example

To make a tool server available to agents, create an AgentTool CR:

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: kubectl
  namespace: agents
spec:
  description: "Kubernetes operations -- get, describe, logs, apply, exec"
  category: infrastructure
  uiHint: kubernetes-resources
  oci:
    ref: ghcr.io/samyn92/agentops/tools/kubectl:v0.17.3
    pullPolicy: IfNotPresent
```

Then bind it to an Agent:

```yaml
spec:
  tools:
    - name: kubectl
    - name: git
    - name: github
```

### Permission overrides

Restrict an agent to read-only kubectl operations:

```yaml
spec:
  tools:
    - name: kubectl
      permissions:
        mode: deny
        rules:
          - "kubectl_exec"
          - "kubectl_apply"
          - "kubectl_delete"
          - "kubectl_run"
          - "kubectl_cp"
          - "kubectl_rollout"
          - "kubectl_scale"
          - "kubectl_label"
          - "kubectl_annotate"
```

---

## Summary

| Server | Tools | Read-only | Read-write | OCI tag |
|--------|-------|-----------|------------|---------|
| kube-explore | 8 | 6 | 2 | `v0.17.3` |
| kubectl | 16 | 7 | 9 | `v0.17.3` |
| git | 12 | 5 | 7 | `v0.17.3` |
| github | 12 | 8 | 4 | `v0.17.3` |
| helm | 5 | 5 | 0 | `v0.17.3` |
| flux | 15 | 11 | 4 | `v0.17.3` |
| tempo | 6 | 6 | 0 | `v0.17.3` |
| **Total** | **74** | **48** | **26** | |

## Platform-native GitLab tools

GitLab is not an OCI MCP artifact. GitLab operations are provided by runtime-native platform tools that are enabled when the operator injects a GitLab Integration identity into the agent environment. The runtime uses `GITLAB_TOKEN`, `GITLAB_URL`, scope variables, project allow-lists, and `GITLAB_READONLY=true` to decide which `gitlab_*` tools are registered and whether mutating operations are available.

Standard read tools: `gitlab_get_project`, `gitlab_list_group_projects`, `gitlab_search`, `gitlab_list_mrs`, `gitlab_get_mr`, `gitlab_get_mr_diff`, `gitlab_list_mr_notes`, `gitlab_list_issues`, `gitlab_get_issue`, `gitlab_list_issue_notes`, `gitlab_list_pipelines`, `gitlab_get_pipeline`.

Standard write tools: `gitlab_create_issue`, `gitlab_update_issue`, `gitlab_update_issue_content`, `gitlab_add_issue_note`, `gitlab_create_mr`, `gitlab_update_mr`, `gitlab_add_mr_note`.

Bulk Lab-PM helpers: `gitlab_bulk_create_issues`, `gitlab_bulk_update_issues`, `gitlab_bulk_add_issue_notes`. These accept up to 20 items, default to `dry_run=true`, validate Integration project scope, and return per-item JSON results with partial success/failure reporting.
