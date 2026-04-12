---
title: "AgentOps"
---

{{< blocks/cover title="" image_anchor="top" height="full" color="dark" >}}
<div class="mx-auto text-center">
  <img src="/agentops/images/logo.png" alt="AgentOps" class="agentops-hero-logo" width="200" />
  <h1 class="agentops-hero-title">AgentOps</h1>
  <p class="agentops-hero-subtitle">AI Agents as Kubernetes Workloads</p>
  <p class="agentops-hero-desc">
    Define agents, tools, memory, and channels as Custom Resources.<br/>
    The operator handles the rest.
  </p>
  <div class="agentops-hero-actions">
    <a class="btn btn-lg btn-primary" href="docs/">
      Documentation <i class="fas fa-arrow-alt-circle-right ml-2"></i>
    </a>
    <a class="btn btn-lg btn-secondary" href="https://github.com/samyn92/agentops-core">
      GitHub <i class="fab fa-github ml-2"></i>
    </a>
  </div>
  <div class="agentops-hero-badges">
    <a href="https://github.com/samyn92/agentops-platform/releases"><img src="https://img.shields.io/github/v/release/samyn92/agentops-platform?label=platform&style=flat-square&color=8b5cf6" alt="Platform"></a>
    <a href="https://github.com/samyn92/agentops-core/releases"><img src="https://img.shields.io/github/v/release/samyn92/agentops-core?label=operator&style=flat-square&color=8b5cf6" alt="Operator"></a>
    <a href="https://github.com/samyn92/agentops-runtime/releases"><img src="https://img.shields.io/github/v/release/samyn92/agentops-runtime?label=runtime&style=flat-square&color=8b5cf6" alt="Runtime"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square" alt="License"></a>
  </div>
</div>
{{< /blocks/cover >}}

<section class="agentops-section agentops-section--intro">
  <div class="container">
    <div class="row justify-content-center">
      <div class="col-lg-9 text-center">
        <h2 class="agentops-section-title">What is AgentOps?</h2>
        <p class="agentops-section-lead">
          A Kubernetes-native platform for running AI agents in production.
          No wrapper scripts. No Docker-in-Docker hacks. No sidecar orchestrators glued together with YAML.
        </p>
        <p class="agentops-section-body">
          Agents are first-class Kubernetes workloads with their own CRDs, controllers, memory, tool access, and observability.
          <code>kubectl apply</code> an Agent CR and get a running, observable, delegating AI agent with persistent memory and streaming output.
          Built on the <a href="https://github.com/charmbracelet/fantasy">Charm Fantasy SDK</a>. Pure Go. No Python runtime.
        </p>
      </div>
    </div>
  </div>
</section>

<section class="agentops-section agentops-section--features">
  <div class="container">
    <h2 class="agentops-section-title text-center">Platform Capabilities</h2>
    <div class="row agentops-features-grid">

      <div class="col-lg-4 col-md-6">
        <div class="agentops-feature-card">
          <div class="agentops-feature-icon"><i class="fas fa-brain"></i></div>
          <h3>Three-Layer Memory</h3>
          <p>Working memory (sliding window), short-term (deterministic session summaries), long-term (user-curated). Context injection is BM25 relevance-ranked via FTS5. No embedding models, no vector DB.</p>
          <a href="docs/concepts/memory/" class="agentops-feature-link">Learn more &rarr;</a>
        </div>
      </div>

      <div class="col-lg-4 col-md-6">
        <div class="agentops-feature-card">
          <div class="agentops-feature-icon"><i class="fas fa-sitemap"></i></div>
          <h3>Agent Delegation</h3>
          <p>Agents spawn sub-agents as Kubernetes Jobs with independent tools, memory, and resources. Fan-out, fan-in. Zero-polling Watch for result aggregation. Concurrency at the CRD level.</p>
          <a href="docs/concepts/delegation/" class="agentops-feature-link">Learn more &rarr;</a>
        </div>
      </div>

      <div class="col-lg-4 col-md-6">
        <div class="agentops-feature-card">
          <div class="agentops-feature-icon"><i class="fas fa-tools"></i></div>
          <h3>MCP Tools as OCI</h3>
          <p>Tool servers are compiled Go binaries with MCP stdio transport. Package as OCI artifacts, push to any registry, reference in your Agent CR. Pulled at reconcile time by init containers.</p>
          <a href="docs/concepts/tools/" class="agentops-feature-link">Learn more &rarr;</a>
        </div>
      </div>

      <div class="col-lg-4 col-md-6">
        <div class="agentops-feature-card">
          <div class="agentops-feature-icon"><i class="fas fa-desktop"></i></div>
          <h3>Real-Time Console</h3>
          <p>SolidJS PWA with Go BFF. FEP over Server-Sent Events for live streaming. 12 specialized tool card renderers. Tempo trace integration. Memory management panel.</p>
          <a href="docs/concepts/console/" class="agentops-feature-link">Learn more &rarr;</a>
        </div>
      </div>

      <div class="col-lg-4 col-md-6">
        <div class="agentops-feature-card">
          <div class="agentops-feature-icon"><i class="fas fa-chart-line"></i></div>
          <h3>OTEL Observability</h3>
          <p>Every turn, tool call, memory read/write, and delegation traced end-to-end with OpenTelemetry. Per-observation injection audit trails. Traces to Tempo, metrics to Prometheus.</p>
          <a href="docs/concepts/observability/" class="agentops-feature-link">Learn more &rarr;</a>
        </div>
      </div>

      <div class="col-lg-4 col-md-6">
        <div class="agentops-feature-card">
          <div class="agentops-feature-icon"><i class="fas fa-cube"></i></div>
          <h3>Go-Native Runtime</h3>
          <p>Built on the Charm Fantasy SDK. Single static binary per agent pod. Fast cold starts, predictable resources. Handles memory injection, tool dispatch, and FEP streaming.</p>
          <a href="docs/getting-started/architecture/" class="agentops-feature-link">Learn more &rarr;</a>
        </div>
      </div>

    </div>
  </div>
</section>

<section class="agentops-section agentops-section--code">
  <div class="container">
    <div class="row justify-content-center">
      <div class="col-lg-9">
        <h2 class="agentops-section-title text-center">Define an Agent</h2>
        <p class="agentops-section-lead text-center">
          An Agent CR is everything Kubernetes needs: model, system prompt, tools, memory, delegation rules, and resource limits.
        </p>

```yaml
apiVersion: agents.agentops.io/v1alpha1
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
  resources:
    requests:
      memory: "256Mi"
      cpu: "250m"
    limits:
      memory: "512Mi"
      cpu: "500m"
```

  </div>
    </div>
  </div>
</section>

<section class="agentops-section agentops-section--cta">
  <div class="container text-center">
    <h2 class="agentops-section-title">Get Started</h2>
    <p class="agentops-section-lead">Install the operator, apply your first Agent CR, and watch it run.</p>
    <a class="btn btn-lg btn-primary" href="docs/getting-started/">
      Getting Started Guide <i class="fas fa-arrow-alt-circle-right ml-2"></i>
    </a>
  </div>
</section>
