---
title: "AgentOps"
---

{{< blocks/cover title="AgentOps" subtitle="AI Agents as Kubernetes Workloads" image_anchor="top" height="med" color="dark" >}}

Define agents, tools, memory, and channels as Custom Resources.
The operator handles the rest.

[Documentation](docs/)

{{< /blocks/cover >}}

<!-- DO NOT SIMPLIFY: All HTML must be at column 0 (no indentation) to prevent Goldmark from treating indented lines as code blocks -->

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
<div class="agentops-principles">
<div class="agentops-principle">
<div class="agentops-principle-num">Principle 01</div>
<h4>Kubernetes-Native</h4>
<p>Agents are CRDs, not containers wrapping scripts. Reconciliation loops, not cron jobs. The control plane, not a sidecar.</p>
</div>
<div class="agentops-principle">
<div class="agentops-principle-num">Principle 02</div>
<h4>Zero Abstractions</h4>
<p>No framework lock-in, no SDKs to learn. Pure Kubernetes primitives. If you know kubectl, you know AgentOps.</p>
</div>
<div class="agentops-principle">
<div class="agentops-principle-num">Principle 03</div>
<h4>Observable by Default</h4>
<p>Every tool call, memory read, and delegation traced end-to-end with OpenTelemetry. You see everything.</p>
</div>
<div class="agentops-principle">
<div class="agentops-principle-num">Principle 04</div>
<h4>Production-Grade</h4>
<p>Single static Go binaries. Predictable resources. No cold-start surprises. Built for SRE teams who run real infrastructure.</p>
</div>
</div>
</div>
</section>

<section class="agentops-section agentops-section--features">
<div class="container">
<h2 class="agentops-section-title text-center">Platform Capabilities</h2>
<p class="agentops-section-lead text-center">
Every component designed for production. Every integration first-party.
</p>
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
<h2 class="agentops-section-title">Ready to deploy intelligent agents?</h2>
<p class="agentops-section-lead">Install the operator, apply your first Agent CR, and watch it run.</p>
<div class="agentops-hero-actions" style="animation: none; margin-top: 2rem;">
<a class="btn btn-lg btn-primary" href="docs/getting-started/">
Getting Started <i class="fas fa-arrow-right ms-1"></i>
</a>
<a class="btn btn-lg btn-secondary" href="docs/getting-started/architecture/">
Architecture <i class="fas fa-layer-group ms-1"></i>
</a>
</div>
</div>
</section>
