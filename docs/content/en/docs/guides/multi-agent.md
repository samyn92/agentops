---
title: "Multi-Agent Orchestration"
linkTitle: "Multi-Agent"
weight: 2
description: "Set up an orchestrator agent that delegates work to task agents using the built-in delegation system."
---

AgentOps supports multi-agent orchestration natively. An orchestrator agent discovers and delegates to task agents using built-in runtime tools — no custom wiring required.

This guide walks through setting up an orchestrator + task agent pattern.

## How Delegation Works

The delegation flow is:

1. The orchestrator agent calls `list_task_agents` (built-in) to discover available task agents in its namespace.
2. It decides which agents to delegate to based on their descriptions and tags.
3. It calls `run_agents` (built-in) with target agent names and input.
4. The runtime creates `AgentRun` CRs for each delegated task.
5. The `DelegationWatcher` tracks progress via Kubernetes Watch on those AgentRun resources.
6. Results are collected and returned to the orchestrator when all delegated runs complete.

The orchestrator does not need any `toolRefs` for delegation — `list_task_agents` and `run_agents` are built into the Fantasy runtime. However, the orchestrator can also have its own tools for direct work.

## 1. Create Task Agents

Task agents are regular agents with delegation configuration that makes them discoverable.

### Code Review Agent

```yaml
apiVersion: agentops.samyn.co/v1alpha1
kind: Agent
metadata:
  name: code-reviewer
  namespace: agents
spec:
  type: task
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  delegation:
    visibility: namespace
    tags:
      - code-review
      - quality
    description: >-
      Reviews code changes for correctness, security issues, and style
      violations. Accepts a git diff or file contents as input.
  concurrency:
    strategy: queue
    maxQueued: 5
  toolRefs:
    - name: git-tools
      mode: readonly
  systemPrompt: |
    You are a code review specialist. Analyze the provided code changes and report:
    1. Correctness issues (bugs, logic errors)
    2. Security concerns
    3. Style and best practice violations
    4. Suggestions for improvement

    Be specific — reference line numbers and provide concrete fix suggestions.
```

### Test Writer Agent

```yaml
apiVersion: agentops.samyn.co/v1alpha1
kind: Agent
metadata:
  name: test-writer
  namespace: agents
spec:
  type: task
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  delegation:
    visibility: namespace
    tags:
      - testing
      - code-generation
    description: >-
      Generates unit and integration tests for provided code.
      Returns test files ready to commit.
  concurrency:
    strategy: queue
    maxQueued: 3
  toolRefs:
    - name: git-tools
      mode: readonly
  systemPrompt: |
    You are a test writing specialist. Given source code, generate comprehensive tests:
    - Unit tests for individual functions
    - Edge cases and error paths
    - Integration tests where appropriate

    Return complete, runnable test files.
```

Key fields:

| Field | Purpose |
|-------|---------|
| `spec.type` | `task` — indicates this agent is meant to be delegated to |
| `delegation.visibility` | `namespace` — discoverable by other agents in the same namespace |
| `delegation.tags` | Categorization for discovery filtering |
| `delegation.description` | Human-readable description returned by `list_task_agents` |
| `concurrency.strategy` | How to handle concurrent runs: `queue`, `reject`, or `replace` |

## 2. Create the Orchestrator Agent

The orchestrator is a `daemon` agent that stays running and delegates work to task agents.

```yaml
apiVersion: agentops.samyn.co/v1alpha1
kind: Agent
metadata:
  name: dev-orchestrator
  namespace: agents
spec:
  type: daemon
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  toolRefs:
    - name: git-tools
      mode: readwrite
  systemPrompt: |
    You are a development orchestrator. You coordinate work across specialized agents.

    ## Available Actions

    Use `list_task_agents` to discover available task agents. Each has a description
    and tags explaining what it can do.

    Use `run_agents` to delegate work. You can delegate to multiple agents in parallel.

    ## Delegation Guidelines

    - For code review requests: delegate to agents tagged "code-review"
    - For test generation: delegate to agents tagged "testing"
    - You can delegate to multiple agents simultaneously for independent tasks
    - Always review delegated results before presenting to the user
    - If a delegated task fails, explain the failure and suggest next steps

    ## Direct Work

    You also have git-tools available for direct repository operations.
    Use these for simple tasks that don't need delegation.
```

Note that the orchestrator has **no special toolRefs for delegation**. The `list_task_agents` and `run_agents` tools are built into the runtime and available to all agents. The orchestrator just needs a system prompt that tells it when and how to delegate.

## 3. Concurrency Control

Each agent's `concurrency` spec controls what happens when multiple runs are requested:

| Strategy | Behavior |
|----------|----------|
| `queue` | Runs are queued and executed in order. `maxQueued` limits the queue depth. |
| `reject` | New runs are rejected while one is already active. |
| `replace` | The active run is cancelled and replaced by the new one. |

Choose based on the agent's workload:

- **queue** — for task agents that process independent requests (most common)
- **reject** — for agents where concurrent requests indicate a bug
- **replace** — for agents where only the latest request matters (e.g. live analysis)

## 4. Git Workspace Delegation

When the orchestrator delegates to a task agent that needs repository context, the runtime handles workspace setup automatically. The task agent's pod gets the same git workspace access as configured in its spec.

For task agents that need to read code:

```yaml
toolRefs:
  - name: git-tools
    mode: readonly
```

The orchestrator passes the relevant context (file paths, branch names, diff content) as input to `run_agents`. The task agent then uses its own tools to access the repository.

## Full Example

Apply all three resources together:

```yaml
# task-agents.yaml
---
apiVersion: agentops.samyn.co/v1alpha1
kind: Agent
metadata:
  name: code-reviewer
  namespace: agents
spec:
  type: task
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  delegation:
    visibility: namespace
    tags:
      - code-review
      - quality
    description: >-
      Reviews code changes for correctness, security issues, and style violations.
  concurrency:
    strategy: queue
    maxQueued: 5
  toolRefs:
    - name: git-tools
      mode: readonly
  systemPrompt: |
    You are a code review specialist. Analyze code changes and report correctness issues,
    security concerns, style violations, and improvement suggestions.
---
apiVersion: agentops.samyn.co/v1alpha1
kind: Agent
metadata:
  name: test-writer
  namespace: agents
spec:
  type: task
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  delegation:
    visibility: namespace
    tags:
      - testing
      - code-generation
    description: >-
      Generates unit and integration tests for provided code.
  concurrency:
    strategy: queue
    maxQueued: 3
  toolRefs:
    - name: git-tools
      mode: readonly
  systemPrompt: |
    You are a test writing specialist. Generate comprehensive unit tests,
    edge case coverage, and integration tests. Return complete, runnable test files.
---
apiVersion: agentops.samyn.co/v1alpha1
kind: Agent
metadata:
  name: dev-orchestrator
  namespace: agents
spec:
  type: daemon
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  toolRefs:
    - name: git-tools
      mode: readwrite
  systemPrompt: |
    You are a development orchestrator. Use list_task_agents to discover available
    agents and run_agents to delegate work. Delegate code review to "code-review"
    tagged agents and test generation to "testing" tagged agents.
    Review all delegated results before presenting to the user.
```

```bash
kubectl apply -f task-agents.yaml
```

## Verifying the Setup

Check that all agents are running and the task agents are discoverable:

```bash
# Verify agents are reconciled
kubectl get agents -n agents

# Check the orchestrator pod is running
kubectl get pods -n agents -l agentops.samyn.co/agent=dev-orchestrator

# Check task agent registrations
kubectl get agents -n agents -o custom-columns=\
NAME:.metadata.name,TYPE:.spec.type,VISIBILITY:.spec.delegation.visibility,TAGS:.spec.delegation.tags
```

Then interact with the orchestrator through the AgentOps console. Ask it to review code or generate tests and watch it discover and delegate to the task agents automatically.

## Next Steps

- See the [Building Custom MCP Tools](../building-tools/) guide to create tools for your task agents.
- Check the [Helm Values Reference](../../reference/helm-values/) for platform configuration.
