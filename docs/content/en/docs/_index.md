---
title: "Documentation"
linkTitle: "Documentation"
weight: 20
---

AgentOps is a Kubernetes-native platform for deploying and operating AI agents as first-class workloads. These docs cover everything from installing the operator to writing custom tool servers.

## Getting Started

Install the AgentOps operator on your cluster, deploy your first agent, and verify it's running. Covers prerequisites, Helm chart installation, and a minimal Agent CR walkthrough.

## Concepts

How things work under the hood:

- **Agent Lifecycle** -- how the operator reconciles Agent CRs into running pods with sidecars, storage, and networking.
- **Three-Layer Memory** -- working memory, short-term session summaries, and long-term observations. BM25 relevance ranking, three-tier write dedup, deterministic summarization.
- **Delegation** -- parallel sub-agent spawning via Kubernetes Jobs, structured result aggregation, concurrency control.
- **MCP Tools** -- tool servers as OCI artifacts, stdio transport, registry resolution, and sidecar injection.
- **Channels** -- Slack, webhook, and custom channel bridges for agent I/O.
- **FEP Streaming** -- the Fantasy Event Protocol over SSE, how the console connects to live agent sessions.

## Guides

Task-oriented walkthroughs:

- Writing a custom MCP tool server
- Configuring agent memory for your use case
- Setting up agent delegation chains
- Connecting agents to Slack channels
- Deploying the AgentOps Console
- Packaging and pushing OCI tool artifacts

## Reference

API and specification details:

- **CRD Reference** -- full spec for Agent, Tool, Channel, and Resource custom resources.
- **Runtime Configuration** -- environment variables, flags, and runtime behavior.
- **Memory API** -- REST endpoints for the agentops-memory service.
- **FEP Protocol** -- event types, payloads, and SSE stream format.
- **Helm Values** -- all configurable values for the agentops-platform chart.

## Project

Contribution guidelines, release process, architecture decisions, and roadmap. Includes the planned OCI Skills feature (`spec.skillRefs`) for injecting static expertise as markdown artifacts into agent system prompts.
