---
title: "AgentOps"
---

{{< blocks/cover title="AI Agents as Kubernetes Workloads" image_anchor="top" height="full" color="dark" >}}
<div class="mx-auto">
  <a class="btn btn-lg btn-primary mr-3 mb-4" href="docs/">
    Documentation <i class="fas fa-arrow-alt-circle-right ml-2"></i>
  </a>
  <a class="btn btn-lg btn-secondary mr-3 mb-4" href="https://github.com/samyn92/agentops-core">
    GitHub <i class="fab fa-github ml-2 "></i>
  </a>
  <p class="lead mt-5">Define agents, tools, memory, and channels as Custom Resources.<br/>The operator handles the rest.</p>
</div>
{{< /blocks/cover >}}

{{% blocks/lead color="primary" %}}

AgentOps is a Kubernetes-native platform for running AI agents in production.

No wrapper scripts. No Docker-in-Docker hacks. No sidecar orchestrators glued together with YAML.

Agents are first-class Kubernetes workloads — with their own CRDs, controllers, memory, tool access, and observability. You `kubectl apply` an Agent CR and get a running, observable, delegating AI agent with persistent memory and streaming output.

{{% /blocks/lead %}}

{{< blocks/section color="dark" type="features">}}

{{% blocks/feature icon="fa-brain" title="Three-Layer Memory" url="/docs/concepts/memory/" %}}
Working memory (sliding window), short-term (deterministic session summaries), and long-term (user-curated decisions and discoveries). Context injection is BM25 relevance-ranked via FTS5 — no embedding models, no vector DB, no extra infrastructure. SQLite does the work.
{{% /blocks/feature %}}

{{% blocks/feature icon="fa-sitemap" title="Parallel Agent Delegation" url="/docs/concepts/delegation/" %}}
Agents spawn sub-agents as Kubernetes Jobs with independent tool sets, memory scopes, and resource limits. Fan-out, fan-in. The delegating agent gets structured results back. Concurrency is controlled at the CRD level, not in application code.
{{% /blocks/feature %}}

{{% blocks/feature icon="fa-tools" title="MCP Tools as OCI Artifacts" url="/docs/concepts/tools/" %}}
Tool servers are compiled Go binaries implementing MCP stdio transport. Package them as OCI artifacts, push to any container registry, reference them in your Agent CR. The operator pulls and mounts them at reconcile time. No runtime dependency resolution.
{{% /blocks/feature %}}

{{% blocks/feature icon="fa-desktop" title="Real-Time Console" url="/docs/concepts/console/" %}}
SolidJS PWA with a Go BFF. Connects to agents via the Fantasy Event Protocol (FEP) over Server-Sent Events. Watch agent reasoning, tool calls, delegation, and memory operations as they happen. Manage long-term memory directly from the UI.
{{% /blocks/feature %}}

{{% blocks/feature icon="fa-chart-line" title="Full OTEL Observability" url="/docs/concepts/observability/" %}}
Every agent turn, tool invocation, memory read/write, and delegation is traced end-to-end with OpenTelemetry. Per-observation injection audit trails show exactly which memories were injected and why. Traces flow to Tempo, metrics to Prometheus.
{{% /blocks/feature %}}

{{% blocks/feature icon="fa-cube" title="Go-Native Runtime" url="/docs/concepts/runtime/" %}}
Built on the Charm Fantasy SDK. Single static binary per agent pod. No Python, no Node, no interpreters. Fast cold starts, predictable resource usage, straightforward debugging. The runtime handles memory injection, tool dispatch, and FEP streaming.
{{% /blocks/feature %}}

{{< /blocks/section >}}

{{< blocks/section color="primary" >}}

## Define an Agent

An Agent CR is everything Kubernetes needs to run your agent: the model, system prompt, tools, memory config, delegation rules, and resource limits. Apply it and the operator creates the pod, service, persistent storage, MCP sidecar, and channel bridges.

```yaml
apiVersion: agentops.dev/v1alpha1
kind: Agent
metadata:
  name: site-reliability
  namespace: agents
spec:
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  systemPrompt: |
    You are an SRE agent responsible for the production cluster.
    Investigate alerts, correlate with recent deployments, and
    propose remediation. Delegate deep-dives to specialist agents.
  toolRefs:
    - name: kubectl-tool
      registry: ghcr.io/samyn92/agent-tools/kubectl:v0.3.0
    - name: prometheus-tool
      registry: ghcr.io/samyn92/agent-tools/prometheus:v0.2.1
  memory:
    workingMemory:
      windowSize: 20
    shortTerm:
      enabled: true
    longTerm:
      enabled: true
  delegation:
    maxConcurrent: 3
    agents:
      - name: log-analyzer
      - name: deployment-checker
  channels:
    - type: slack
      ref: sre-alerts
  resources:
    requests:
      memory: "256Mi"
      cpu: "250m"
    limits:
      memory: "512Mi"
      cpu: "500m"
```

{{< /blocks/section >}}

{{< blocks/section color="white" >}}

<div class="text-center">
  <h2>Get Started</h2>
  <p class="lead">Install the operator, apply your first Agent CR, and watch it run.</p>
  <a class="btn btn-lg btn-primary mr-3 mb-4" href="docs/getting-started/">
    Getting Started Guide <i class="fas fa-arrow-alt-circle-right ml-2"></i>
  </a>
</div>

{{< /blocks/section >}}
