---
title: "Getting Started"
linkTitle: "Getting Started"
weight: 1
description: "Get AgentOps running on your Kubernetes cluster in minutes."
---

AgentOps is a Kubernetes-native platform for deploying and operating AI agents as first-class workloads. You define agents, tools, resources, and channels as Custom Resources — the operator handles deployments, jobs, storage, networking, MCP tool integration, memory, and tracing.

## Where to begin

<div class="row">
  <div class="col-md-4">
    <h3><a href="quickstart/">Quickstart</a></h3>
    <p>Install the platform, deploy your first agent, and open the console in under 5 minutes.</p>
  </div>
  <div class="col-md-4">
    <h3><a href="installation/">Installation</a></h3>
    <p>Full installation guide covering all configuration options, minimal installs, ingress, model providers, and uninstalling.</p>
  </div>
  <div class="col-md-4">
    <h3><a href="architecture/">Architecture</a></h3>
    <p>Understand how the operator, console, memory service, and tracing fit together across namespaces.</p>
  </div>
</div>

## What you get

The `agentops-platform` Helm chart deploys:

| Component | Description |
|-----------|-------------|
| **Operator** | Kubernetes controller managing 6 CRDs (Agent, AgentRun, AgentTool, AgentResource, Channel, Provider) |
| **Console** | Go BFF + SolidJS PWA for interacting with agents, viewing traces, and managing memory |
| **Memory** | SQLite + FTS5 memory service with relevance-ranked context injection |
| **Tempo** | Distributed tracing backend — all components emit OTLP traces |

Agents run in a dedicated `agents` namespace, isolated from platform control-plane components in `agent-system`. Tools are distributed as OCI artifacts and mounted into agent pods at runtime via MCP (Model Context Protocol).
