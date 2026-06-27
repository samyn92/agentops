# Multi-Cluster Test Environment

Spin up a realistic multi-cluster setup using k3d for testing the Agent Factory pattern.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Network: agentops-net                                │
├──────────────┬──────────────────┬───────────────────────────┤
│  agentops-   │  agentops-prod   │  agentops-staging         │
│  mgmt        │                  │                           │
│              │  Sample workloads│  Sample workloads         │
│  AgentOps    │  (nginx, echo)   │  (nginx, echo)           │
│  Platform    │                  │                           │
│  (operator,  │  Observer agent  │  Observer agent           │
│   agents,    │  watches via     │  watches via              │
│   console)   │  kubeconfig      │  kubeconfig               │
└──────────────┴──────────────────┴───────────────────────────┘
```

## Prerequisites

- Docker
- k3d (`curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash`)
- kubectl
- helm
- just

## Usage

```bash
# Spin up all 3 clusters (~30 seconds)
just --justfile deploy/test-clusters/justfile up

# Deploy CRDs + namespaces on mgmt
just --justfile deploy/test-clusters/justfile deploy-platform

# Create required GitLab/LLM secrets from environment variables
export ANTHROPIC_API_KEY=...
export GITLAB_PLANNER_TOKEN=...
export GITLAB_CODER_TOKEN=...
just --justfile deploy/test-clusters/justfile prepare-secrets

# Inject workload cluster kubeconfigs as secrets
just --justfile deploy/test-clusters/justfile inject-kubeconfigs

# Apply read-only RBAC for the generated management-cluster observer
just --justfile deploy/test-clusters/justfile deploy-observer-rbac

# Deploy the agent factory
just --justfile deploy/test-clusters/justfile deploy-factory

# Deploy sample workloads on prod/staging
just --justfile deploy/test-clusters/justfile deploy-workloads

# Or run the full setup after `up`
just --justfile deploy/test-clusters/justfile e2e-setup

# Tear down everything
just --justfile deploy/test-clusters/justfile down
```

## Cluster Contexts

| Cluster | Context | Purpose |
|---------|---------|---------|
| agentops-mgmt | `k3d-agentops-mgmt` | Management — runs AgentOps platform |
| agentops-prod | `k3d-agentops-prod` | Simulated production cluster |
| agentops-staging | `k3d-agentops-staging` | Simulated staging cluster |

## How Agents Access Workload Clusters

Observer agents in the mgmt cluster access workload clusters via kubeconfig secrets:

```yaml
# Secret in mgmt cluster (agents namespace)
apiVersion: v1
kind: Secret
metadata:
  name: kubeconfig-agentops-prod
  namespace: agents
data:
  kubeconfig: <base64-encoded kubeconfig for prod cluster>
```

The agent's `kubectl` tool uses `KUBECONFIG` env var pointing to the mounted secret.

## Current E2E Target

The first prepared E2E path deploys `infra-observer-mgmt`, an observer daemon
that watches the management cluster using its in-cluster service account. It can
inspect Kubernetes/Flux state and use native GitLab tools from the coder
Integration to create planning issues.

The prod/staging clusters and kubeconfig secrets are still created so the
multi-cluster topology is ready, but remote observer pods are not enabled yet.
The missing platform feature is arbitrary Secret volume mounts on Agent pods, so
the generated kubeconfig secrets cannot yet be mounted as kubeconfig files for
`kubectl`/`kube-explore`.

## Validation Without Starting Clusters

Render the E2E factory manifests locally:

```bash
just --justfile deploy/test-clusters/justfile render-factory
```
