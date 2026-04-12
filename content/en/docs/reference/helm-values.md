---
title: "Helm Values Reference"
linkTitle: "Helm Values"
weight: 4
description: "Complete reference for the agentops-platform umbrella Helm chart values."
---

The `agentops-platform` chart is an umbrella chart that deploys all AgentOps platform components. This page documents every configurable value.

## Global

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `global.imagePullSecrets` | list | `[]` | Image pull secrets applied to all sub-charts. Each entry is an object with a `name` field. |
| `agentNamespace` | string | `agents` | Namespace where agent workloads are deployed. |
| `createNamespace` | bool | `true` | Whether to create the agent namespace if it does not exist. |

```yaml
global:
  imagePullSecrets:
    - name: ghcr-secret
agentNamespace: agents
createNamespace: true
```

## agentops-operator

The Kubernetes operator that reconciles Agent, AgentTool, and related CRDs.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `agentops-operator.enabled` | bool | `true` | Deploy the operator. |
| `agentops-operator.image.repository` | string | `ghcr.io/samyn92/agentops-core` | Operator container image. |
| `agentops-operator.image.tag` | string | Chart appVersion | Image tag. |
| `agentops-operator.resources.requests.cpu` | string | `10m` | CPU request. |
| `agentops-operator.resources.requests.memory` | string | `64Mi` | Memory request. |
| `agentops-operator.resources.limits.cpu` | string | `500m` | CPU limit. |
| `agentops-operator.resources.limits.memory` | string | `256Mi` | Memory limit. |

```yaml
agentops-operator:
  enabled: true
  image:
    repository: ghcr.io/samyn92/agentops-core
    tag: "0.5.0"
  resources:
    requests:
      cpu: 10m
      memory: 64Mi
    limits:
      cpu: 500m
      memory: 256Mi
```

## agentops-console

The web console: a Go BFF proxying Kubernetes and agent runtime APIs, paired with a SolidJS PWA. Connects to agents via the Fantasy Event Protocol (FEP) over Server-Sent Events.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `agentops-console.enabled` | bool | `true` | Deploy the console. |
| `agentops-console.image.repository` | string | `ghcr.io/samyn92/agentops-console` | Console container image. |
| `agentops-console.image.tag` | string | Chart appVersion | Image tag. |
| `agentops-console.env.TEMPO_URL` | string | `http://tempo.observability.svc.cluster.local:3200` | Tempo query endpoint for trace lookups. |
| `agentops-console.env.ENGRAM_URL_OVERRIDE` | string | `http://agentops-memory.agents.svc.cluster.local:7437` | Memory service endpoint. Overrides the default discovery. |
| `agentops-console.settings.namespace` | string | `agents` | Namespace the BFF watches for agent resources. |
| `agentops-console.settings.webDir` | string | `/app/web` | Path to the built SolidJS static assets inside the container. |
| `agentops-console.settings.dev` | bool | `false` | Enable development mode (disables caching, enables debug logging). |
| `agentops-console.service.type` | string | `ClusterIP` | Kubernetes Service type. |
| `agentops-console.service.port` | int | `80` | Service port. |
| `agentops-console.ingress.enabled` | bool | `false` | Enable Ingress resource creation. |
| `agentops-console.ingress.hosts` | list | `[]` | Ingress host rules. Each entry has `host` and `paths`. |
| `agentops-console.ingress.tls` | list | `[]` | Ingress TLS configuration. Each entry has `secretName` and `hosts`. |
| `agentops-console.resources.requests.cpu` | string | `100m` | CPU request. |
| `agentops-console.resources.requests.memory` | string | `128Mi` | Memory request. |
| `agentops-console.resources.limits.cpu` | string | `500m` | CPU limit. |
| `agentops-console.resources.limits.memory` | string | `256Mi` | Memory limit. |

```yaml
agentops-console:
  enabled: true
  image:
    repository: ghcr.io/samyn92/agentops-console
    tag: "0.5.0"
  env:
    TEMPO_URL: http://tempo.observability.svc.cluster.local:3200
    ENGRAM_URL_OVERRIDE: http://agentops-memory.agents.svc.cluster.local:7437
  settings:
    namespace: agents
    webDir: /app/web
    dev: false
  service:
    type: ClusterIP
    port: 80
  ingress:
    enabled: true
    hosts:
      - host: console.agentops.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: console-tls
        hosts:
          - console.agentops.example.com
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 256Mi
```

## memory

The AgentOps memory service — SQLite + FTS5 BM25 relevance-ranked context injection with three-tier write dedup.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `memory.enabled` | bool | `true` | Deploy agentops-memory. |
| `memory.image.repository` | string | `ghcr.io/samyn92/agentops-memory` | Memory service container image. |
| `memory.image.tag` | string | `0.2.0` | Image tag. |
| `memory.persistence.size` | string | `1Gi` | PVC size for the SQLite database. |
| `memory.persistence.storageClass` | string | `""` | Storage class for the PVC. Empty string uses the cluster default. |
| `memory.resources.requests.cpu` | string | `10m` | CPU request. |
| `memory.resources.requests.memory` | string | `32Mi` | Memory request. |
| `memory.resources.limits.cpu` | string | `200m` | CPU limit. |
| `memory.resources.limits.memory` | string | `128Mi` | Memory limit. |
| `memory.nodeSelector` | object | `{}` | Node selector for pod scheduling. |
| `memory.tolerations` | list | `[]` | Tolerations for pod scheduling. |
| `memory.affinity` | object | `{}` | Affinity rules for pod scheduling. |

```yaml
memory:
  enabled: true
  image:
    repository: ghcr.io/samyn92/agentops-memory
    tag: "0.2.0"
  persistence:
    size: 1Gi
    storageClass: local-path
  resources:
    requests:
      cpu: 10m
      memory: 32Mi
    limits:
      cpu: 200m
      memory: 128Mi
  nodeSelector:
    kubernetes.io/hostname: my-node
  tolerations: []
  affinity: {}
```

## tempo

Grafana Tempo for distributed tracing. Stores traces from the operator, console BFF, memory service, and agent runtimes.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tempo.enabled` | bool | `true` | Deploy Tempo. |
| `tempo.tempo.retention` | string | `72h` | How long to retain traces. |
| `tempo.tempo.storage.trace.backend` | string | `local` | Trace storage backend. `local` uses PVC-backed local storage. |
| `tempo.persistence.size` | string | `5Gi` | PVC size for trace storage. |
| `tempo.resources.requests.cpu` | string | `50m` | CPU request. |
| `tempo.resources.requests.memory` | string | `128Mi` | Memory request. |
| `tempo.resources.limits.cpu` | string | `500m` | CPU limit. |
| `tempo.resources.limits.memory` | string | `512Mi` | Memory limit. |

```yaml
tempo:
  enabled: true
  tempo:
    retention: 72h
    storage:
      trace:
        backend: local
  persistence:
    size: 5Gi
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

## Minimal Production Example

A minimal `values.yaml` for production with ingress and custom image tags:

```yaml
global:
  imagePullSecrets:
    - name: ghcr-secret

agentNamespace: agents

agentops-operator:
  image:
    tag: "0.5.0"

agentops-console:
  image:
    tag: "0.5.0"
  ingress:
    enabled: true
    hosts:
      - host: console.agentops.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: console-tls
        hosts:
          - console.agentops.example.com

memory:
  persistence:
    storageClass: gp3

tempo:
  persistence:
    size: 10Gi
```
