---
title: "Agent Delegation and Orchestration"
linkTitle: "Delegation"
weight: 4
description: "How agents discover, delegate to, and collect results from other agents using Kubernetes-native fan-out."
---

Agent delegation lets one agent spawn work on other agents and collect structured results --- without polling, without consuming LLM tokens while waiting, and with full trace propagation across the delegation chain.

## Discovery

Before an agent can delegate, it needs to know what's available. The built-in `list_task_agents` tool queries the Kubernetes API for Agent CRs in the same namespace and returns a filtered list based on:

- **Visibility scope** --- `namespace` (default, visible to all), `explicit` (visible only to `allowedCallers`), or `hidden` (never listed).
- **Tags** --- categorization labels like `kubernetes`, `security`, `frontend` that agents use to find the right specialist.
- **Allowed callers** --- when scope is `explicit`, only agents named in `allowedCallers` can discover and delegate.

The runtime knows its own identity (`AGENT_NAME` env var) and uses it to filter the discovery response.

## The `run_agents` tool

`run_agents` is the primary delegation mechanism. It dispatches to **multiple agents in a single tool call** (parallel fan-out). The tool:

1. **Validates atomically** --- all delegations are checked before any AgentRun CRs are created. If any target is invalid (doesn't exist, not visible, daemon not Running, self-delegation), the entire call fails with no side effects.
2. **Creates AgentRun CRs** --- one per target agent, all tagged with a shared `agents.agentops.io/delegation-group` label.
3. **Registers with the DelegationWatcher** --- hands off tracking to a background goroutine.
4. **Returns immediately** --- the parent agent gets a summary and can continue interacting with the user or performing other work.

Constraints: max 10 delegations per fan-out, timeout range 1m--4h (default 30m).

{{< img src="images/delegation-flow.svg" alt="Delegation Fan-Out Flow" >}}

## DelegationWatcher

The DelegationWatcher is a background goroutine in the runtime that tracks active delegation groups using the **Kubernetes Watch API** --- not polling. It consumes zero CPU while waiting.

For each delegation group, the watcher:

1. Opens a K8s Watch per child AgentRun name.
2. Listens for `MODIFIED` events where the status phase becomes terminal (`Succeeded`, `Failed`, `Cancelled`).
3. Records each completion with the run's output, tool call count, model used, duration, and (if applicable) PR URL, branch, and commit count.
4. When all children complete (or timeout fires), builds a callback prompt and injects it into the parent agent's loop.

The parent agent **stays idle and available** during the entire wait. It does not consume LLM tokens or block the conversation. Users can ask it questions, give it other tasks, or check delegation status at any time.

### Crash recovery

Delegation groups are checkpointed to the PVC alongside working memory. On restart, the watcher restores groups from checkpoint, re-counts remaining runs, and either re-establishes watches or triggers the callback immediately if all children already completed.

## Daemon vs task delegation

How the operator reconciles an AgentRun depends on the target agent's mode:

| Target mode | What happens | Lifecycle |
|-------------|-------------|-----------|
| **daemon** | Operator sends an HTTP POST to the running agent pod | Run completes when agent responds |
| **task** | Operator creates a Kubernetes Job with the agent runtime | Job runs to completion, pod is cleaned up |

## Git workspace delegation

When an AgentRun includes a `spec.git` section, the task agent gets a fully provisioned git workspace:

1. The `resourceRef` points to an AgentResource CR (type `github-repo`, `gitlab-project`, or `git-repo`) that provides the repository URL and credentials.
2. The operator clones the repo, checks out or creates the feature branch, and mounts it into the Job pod.
3. The agent works on the branch and can create or update a pull/merge request.
4. On completion, `status.pullRequestURL`, `status.branch`, and `status.commits` are populated on the AgentRun CR.

## Concurrency control

Each Agent CR can define a `concurrency` spec that controls how many AgentRuns can execute simultaneously:

```yaml
concurrency:
  maxRuns: 3
  policy: queue    # queue | reject | replace
```

| Policy | Behavior |
|--------|----------|
| `queue` | Excess runs enter `Queued` phase, processed FIFO when a slot opens |
| `reject` | Excess runs immediately fail |
| `replace` | Newest run cancels the oldest running run |

This prevents runaway delegation --- an orchestrator can't accidentally flood a target agent with unbounded parallel work.

## Trace propagation

AgentRun CRs carry trace context via the `agents.agentops.io/traceparent` annotation (W3C Trace Context format). When a child agent starts:

1. It parses the traceparent from the annotation.
2. Creates a **span link** back to the parent agent's orchestration span (the child keeps its own independent trace ID).
3. Sets `delegation.parent_trace_id`, `delegation.parent_span_id`, `delegation.parent_agent`, and `delegation.run_name` attributes on its root span.

The parent's `run_agents` tool call span also records `delegation.group_id`, `delegation.count`, and `delegation.run_names` attributes. The console uses these to build a delegation tree view in the trace inspector.

## FEP events

The DelegationWatcher emits real-time events via the Fantasy Event Protocol:

| Event | When |
|-------|------|
| `delegation.fan_out` | Group registered (includes group ID, count, run names) |
| `delegation.run_completed` | A single child finishes (includes phase, duration, remaining count) |
| `delegation.all_completed` | All children done (includes succeeded/failed counts, total duration) |
| `delegation.timeout` | Group timed out (includes completed/timed-out counts) |

The console renders these as a live delegation progress card via the `DelegationFanOutCard` component.

## Example: Orchestrator Agent CR

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Agent
metadata:
  name: orchestrator
  namespace: agents
spec:
  mode: daemon
  model: anthropic/claude-sonnet-4-20250514
  image: ghcr.io/samyn92/agentops-runtime-fantasy:0.7.3

  builtinTools:
    - bash
    - read
    - grep
    - ls
    - glob
  # run_agents, run_agent, list_task_agents, get_agent_run are injected
  # automatically when running in-cluster

  providerRefs:
    - name: anthropic

  systemPrompt: |
    You are an orchestrator agent. You coordinate work across specialist agents.

    Use list_task_agents to discover available agents and their capabilities.
    Use run_agents to delegate tasks in parallel.
    After delegating, tell the user what you dispatched. You will automatically
    receive results when all agents complete — do NOT poll.

  discovery:
    description: "Orchestrator — coordinates work across specialist agents"
    tags: ["orchestrator", "coordination"]
    scope: namespace

  # The agents this orchestrator delegates TO need their own Agent CRs:
  #   coder        (mode: task, tags: [coding, github])
  #   flux-operator (mode: task, tags: [kubernetes, gitops])
  #   cluster-mgr  (mode: daemon, tags: [kubernetes, infrastructure])

  resourceBindings:
    - name: platform-repo

  memory:
    serverRef: agentops-memory

  concurrency:
    maxRuns: 1
    policy: queue

  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 500m
      memory: 256Mi

  timeout: "30m"
```

## Example: Resulting AgentRun CRs

When the orchestrator calls `run_agents` with three delegations, the runtime creates three AgentRun CRs:

```yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentRun
metadata:
  name: orchestrator-coder-a1b2c3
  namespace: agents
  labels:
    agents.agentops.io/delegation-group: "f8e2a1b4"
  annotations:
    agents.agentops.io/traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
spec:
  agentRef: coder
  prompt: "Implement the retry logic in pkg/client/http.go. Add exponential backoff with jitter, max 5 retries."
  source: agent
  sourceRef: orchestrator
  git:
    resourceRef: platform-repo
    branch: feat/retry-logic
    baseBranch: main
---
apiVersion: agents.agentops.io/v1alpha1
kind: AgentRun
metadata:
  name: orchestrator-flux-operator-d4e5f6
  namespace: agents
  labels:
    agents.agentops.io/delegation-group: "f8e2a1b4"
  annotations:
    agents.agentops.io/traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
spec:
  agentRef: flux-operator
  prompt: "Update the HelmRelease for ingress-nginx to v4.12.0 and verify the rollout succeeds."
  source: agent
  sourceRef: orchestrator
---
apiVersion: agents.agentops.io/v1alpha1
kind: AgentRun
metadata:
  name: orchestrator-cluster-mgr-g7h8i9
  namespace: agents
  labels:
    agents.agentops.io/delegation-group: "f8e2a1b4"
  annotations:
    agents.agentops.io/traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
spec:
  agentRef: cluster-mgr
  prompt: "Check node resource pressure across all nodes and report any that are above 80% CPU or memory."
  source: agent
  sourceRef: orchestrator
```

After all three complete, the orchestrator automatically receives a callback prompt containing each run's phase, output, tool call count, duration, and any PR URLs --- then synthesizes a final response to the user.
