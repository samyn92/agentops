---
title: "Quickstart"
linkTitle: "Quickstart"
weight: 1
description: "Install AgentOps, deploy an agent, and open the console in 5 minutes."
---

This guide gets you from zero to a running AI agent on Kubernetes in three steps.

## Prerequisites

- Kubernetes cluster **v1.28+** (k3s, kind, EKS, GKE, AKS all work)
- **Helm 3.12+**
- **kubectl** configured for your cluster
- An LLM API key (Anthropic, OpenAI, or Google)

## Step 1: Install the platform

```bash
helm install agentops oci://ghcr.io/samyn92/charts/agentops-platform \
  --namespace agent-system --create-namespace
```

This deploys the operator, console, memory service, and Tempo into `agent-system`, and creates the `agents` namespace for workloads.

Wait for all pods to become ready:

```bash
kubectl get pods -n agent-system -w
```

Expected output (all `Running` / `1/1`):

```
NAME                                  READY   STATUS    RESTARTS   AGE
agentops-agentops-operator-...        1/1     Running   0          30s
agentops-agentops-console-...         1/1     Running   0          30s
agentops-agentops-platform-memory-... 1/1     Running   0          30s
agentops-agentops-platform-tempo-...  1/1     Running   0          30s
```

## Step 2: Deploy an agent

### Create the API key secret

```bash
kubectl create secret generic llm-api-keys \
  --namespace agents \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Apply the AgentTool CRs

AgentTools define the MCP tool servers your agent can use. Each tool is pulled as an OCI artifact at pod startup.

```yaml
# tools.yaml
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: git
  namespace: agents
spec:
  description: "Git operations — clone, commit, push, branch, diff, log, blame"
  category: development
  oci:
    ref: ghcr.io/samyn92/agent-tools/git:0.0.8
    pullPolicy: IfNotPresent
---
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: github
  namespace: agents
spec:
  description: "GitHub API — create/review PRs, manage issues, search code"
  category: development
  oci:
    ref: ghcr.io/samyn92/agent-tools/github:0.3.1
    pullPolicy: IfNotPresent
---
apiVersion: agents.agentops.io/v1alpha1
kind: AgentTool
metadata:
  name: kubectl
  namespace: agents
spec:
  description: "Kubernetes read-only — get, list, describe, logs across namespaces"
  category: infrastructure
  oci:
    ref: ghcr.io/samyn92/agent-tools/kubectl:0.3.3
    pullPolicy: IfNotPresent
```

```bash
kubectl apply -f tools.yaml
```

### Apply the Agent CR

```yaml
# agent.yaml
apiVersion: agents.agentops.io/v1alpha1
kind: Agent
metadata:
  name: coding-assistant
  namespace: agents
spec:
  mode: daemon
  model: anthropic/claude-sonnet-4-20250514

  # Runtime
  image: ghcr.io/samyn92/agentops-runtime-fantasy:0.7.3
  builtinTools:
    - bash
    - read
    - edit
    - write
    - grep
    - ls
    - glob
    - fetch
  temperature: 0.3
  maxOutputTokens: 8192
  maxSteps: 50

  # LLM provider
  providers:
    - name: anthropic
      apiKeySecret:
        name: llm-api-keys
        key: ANTHROPIC_API_KEY
  fallbackModels:
    - anthropic/claude-haiku-4-5-20251001

  # MCP tools
  tools:
    - name: git
    - name: github
    - name: kubectl

  # Memory
  memory:
    serverRef: agentops-memory

  # Identity
  systemPrompt: |
    You are a coding assistant running inside a Kubernetes cluster.
    Your workspace is at /data/repos — clone repositories there.

    You have built-in file tools (read, edit, write, grep, ls, glob, fetch, bash)
    and MCP tool servers for Git, GitHub, and Kubernetes operations.

    You also have access to a memory system. Use it to:
    - Save important decisions, discoveries, and lessons learned
    - Search past context before starting new tasks
    - Build up knowledge across sessions

    Be concise, precise, and focus on solving the task at hand.

  env:
    WORKSPACE: /data/repos

  # Safety
  toolHooks:
    blockedCommands:
      - rm -rf /
      - ":(){ :|:& };:"
      - mkfs
      - dd if=

  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 500m
      memory: 256Mi

  timeout: "15m"
```

```bash
kubectl apply -f agent.yaml
```

### Verify the agent is running

```bash
kubectl get agents -n agents
```

```
NAME                MODE     MODEL                                PHASE     AGE
coding-assistant    daemon   anthropic/claude-sonnet-4-20250514   Running   15s
```

Check that the agent pod started and all tools resolved:

```bash
kubectl get pods -n agents -l agents.agentops.io/agent=coding-assistant
kubectl get agenttools -n agents
```

```
NAME      SOURCE   CATEGORY         PHASE   AGE
git       oci      development      Ready   30s
github    oci      development      Ready   30s
kubectl   oci      infrastructure   Ready   30s
```

## Step 3: Access the console

Port-forward the console service:

```bash
kubectl port-forward svc/agentops-agentops-console -n agent-system 8080:80
```

Open [http://localhost:8080](http://localhost:8080) in your browser. You should see the AgentOps console with your `coding-assistant` agent listed and ready for interaction.

The console connects to agents via the Fantasy Event Protocol (FEP) over Server-Sent Events, giving you real-time streaming of agent responses, tool calls, and traces.

## What's next

- [Installation guide](../installation/) — customize model providers, enable ingress, tune resource limits
- [Architecture overview](../architecture/) — understand how components connect
- Explore presets in the [`agentops-platform`](https://github.com/samyn92/agentops-platform) repo under `presets/` for more agent configurations
