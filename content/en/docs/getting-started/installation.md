---
title: "Installation"
linkTitle: "Installation"
weight: 2
description: "Full installation guide with all configuration options."
---

This guide covers installation from prerequisites through custom configuration, verification, and uninstalling.

## Prerequisites

| Requirement | Minimum version |
|-------------|-----------------|
| Kubernetes | 1.28+ |
| Helm | 3.12+ |
| kubectl | 1.28+ |
| Container runtime | containerd, CRI-O |
| Storage | Default StorageClass with dynamic provisioning (for memory + Tempo PVCs) |

**Required secrets** (created in the `agents` namespace):

- At least one LLM API key (Anthropic, OpenAI, or Google) in a Kubernetes Secret

## Full install (all components)

The default install deploys the operator, console, memory service, and Tempo:

```bash
helm install agentops oci://ghcr.io/samyn92/charts/agentops-platform \
  --namespace agent-system --create-namespace
```

This creates two namespaces:

| Namespace | Contents |
|-----------|----------|
| `agent-system` | Operator, console, Tempo |
| `agents` | Memory service, agent pods, AgentTool/AgentResource/Channel workloads |

## Minimal install (operator only)

If you only need the operator and will run agents without the console, memory, or tracing:

```bash
helm install agentops oci://ghcr.io/samyn92/charts/agentops-platform \
  --namespace agent-system --create-namespace \
  --set agentops-console.enabled=false \
  --set memory.enabled=false \
  --set tempo.enabled=false
```

The operator installs the CRDs and watches for Agent, AgentRun, AgentTool, AgentResource, and Channel resources. Agents will still function — they just won't have memory integration or a web UI.

## Custom configuration

### Using a values file

Create a `values-override.yaml` and pass it at install time:

```bash
helm install agentops oci://ghcr.io/samyn92/charts/agentops-platform \
  --namespace agent-system --create-namespace \
  -f values-override.yaml
```

### Model providers

LLM API keys are configured per-agent in the Agent CR, not at the platform level. Create secrets in the `agents` namespace:

```bash
# Anthropic
kubectl create secret generic llm-api-keys \
  --namespace agents \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
kubectl create secret generic llm-api-keys \
  --namespace agents \
  --from-literal=OPENAI_API_KEY=sk-...

# Multiple providers in one secret
kubectl create secret generic llm-api-keys \
  --namespace agents \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --from-literal=OPENAI_API_KEY=sk-...
```

Agents reference these secrets in their `spec.providers` block:

```yaml
spec:
  providers:
    - name: anthropic
      apiKeySecret:
        name: llm-api-keys
        key: ANTHROPIC_API_KEY
    - name: openai
      apiKeySecret:
        name: llm-api-keys
        key: OPENAI_API_KEY
```

### Image pull secrets

For private registries, configure global pull secrets:

```yaml
# values-override.yaml
global:
  imagePullSecrets:
    - name: ghcr-pull-secret
```

Create the secret beforehand:

```bash
kubectl create secret docker-registry ghcr-pull-secret \
  --namespace agent-system \
  --docker-server=ghcr.io \
  --docker-username=YOUR_USER \
  --docker-password=YOUR_PAT
```

### Console ingress

Enable ingress for external access to the console:

```yaml
# values-override.yaml
agentops-console:
  ingress:
    enabled: true
    className: nginx
    hosts:
      - host: agentops.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: agentops-tls
        hosts:
          - agentops.example.com
```

### Console environment (Tempo + Memory URLs)

The console BFF needs to know where Tempo and the memory service live. These depend on your Helm release name and namespace. Set them explicitly:

```yaml
# values-override.yaml
agentops-console:
  env:
    - name: TEMPO_URL
      value: "http://agentops-agentops-platform-tempo.agent-system.svc.cluster.local:3200"
    - name: ENGRAM_URL_OVERRIDE
      value: "http://agentops-agentops-platform-memory.agents.svc.cluster.local:7437"
```

### Memory service

Configure persistence size and image tag:

```yaml
# values-override.yaml
memory:
  image:
    tag: "0.2.0"
  persistence:
    size: 5Gi
    storageClassName: "local-path"
```

### Agent namespace

Change the namespace where agent workloads are deployed:

```yaml
# values-override.yaml
agentNamespace: my-agents
createNamespace: true
```

## Helm values reference

Key values for the umbrella chart:

| Value | Default | Description |
|-------|---------|-------------|
| `agentNamespace` | `agents` | Namespace for agent workloads |
| `createNamespace` | `true` | Create the agent namespace |
| `global.imagePullSecrets` | `[]` | Image pull secrets for all components |
| **Operator** | | |
| `agentops-operator.enabled` | `true` | Deploy the operator |
| `agentops-operator.image.repository` | `ghcr.io/samyn92/agentops-operator` | Operator image |
| `agentops-operator.image.tag` | `""` (chart appVersion) | Operator image tag |
| **Console** | | |
| `agentops-console.enabled` | `true` | Deploy the console |
| `agentops-console.image.repository` | `ghcr.io/samyn92/agentops-console` | Console image |
| `agentops-console.image.tag` | `""` (chart appVersion) | Console image tag |
| `agentops-console.ingress.enabled` | `false` | Enable console ingress |
| `agentops-console.ingress.className` | `""` | Ingress class name |
| `agentops-console.ingress.hosts` | `[{host: agentops.local, ...}]` | Ingress host configuration |
| `agentops-console.service.type` | `ClusterIP` | Console service type |
| `agentops-console.service.port` | `80` | Console service port |
| `agentops-console.console.namespace` | `""` | Restrict console to single namespace |
| **Memory** | | |
| `memory.enabled` | `true` | Deploy the memory service |
| `memory.image.repository` | `ghcr.io/samyn92/agentops-memory` | Memory image |
| `memory.image.tag` | `0.2.0` | Memory image tag |
| `memory.persistence.size` | `1Gi` | SQLite PVC size |
| `memory.persistence.storageClassName` | `""` (cluster default) | Storage class |
| **Tempo** | | |
| `tempo.enabled` | `true` | Deploy Grafana Tempo |
| `tempo.tempo.retention` | `72h` | Trace retention period |
| `tempo.persistence.size` | `5Gi` | Tempo storage PVC size |

## Verifying the installation

### Check all pods

```bash
kubectl get pods -n agent-system
kubectl get pods -n agents
```

### Verify CRDs are installed

```bash
kubectl get crds | grep agentops
```

Expected output:

```
agents.agents.agentops.io              2026-01-01T00:00:00Z
agentruns.agents.agentops.io           2026-01-01T00:00:00Z
agenttools.agents.agentops.io          2026-01-01T00:00:00Z
agentresources.agents.agentops.io      2026-01-01T00:00:00Z
channels.agents.agentops.io            2026-01-01T00:00:00Z
```

### Verify the memory service

```bash
kubectl get pods -n agents -l app=agentops-memory
kubectl logs -n agents -l app=agentops-memory --tail=5
```

### Test console connectivity

```bash
kubectl port-forward svc/agentops-agentops-console -n agent-system 8080:80
# Open http://localhost:8080
```

## Upgrading

```bash
helm upgrade agentops oci://ghcr.io/samyn92/charts/agentops-platform \
  --namespace agent-system \
  -f values-override.yaml
```

CRDs are upgraded automatically by the operator subchart. Existing agents continue running — the operator reconciles them against the new version.

## Uninstalling

```bash
# Remove all agents and tools first
kubectl delete agents,agentruns,agenttools,agentresources,channels --all -n agents

# Uninstall the platform
helm uninstall agentops --namespace agent-system

# Clean up namespaces (optional)
kubectl delete namespace agent-system
kubectl delete namespace agents

# Remove CRDs (optional — this deletes all AgentOps resources cluster-wide)
kubectl delete crds \
  agents.agents.agentops.io \
  agentruns.agents.agentops.io \
  agenttools.agents.agentops.io \
  agentresources.agents.agentops.io \
  channels.agents.agentops.io
```

{{% alert title="Warning" color="warning" %}}
Deleting CRDs removes **all** AgentOps custom resources across the entire cluster, including any PVCs created by daemon agents. Back up any data you need before proceeding.
{{% /alert %}}
