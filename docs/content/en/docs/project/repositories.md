---
title: "Repository"
linkTitle: "Repository"
weight: 1
description: "The AgentOps monorepo layout and published artifacts."
---

AgentOps now ships from one repository: [`github.com/samyn92/agentops`](https://github.com/samyn92/agentops).

The old component repositories have been folded into this monorepo. Source, docs, charts, local k3s development, release workflows, channel bridges, and MCP tool servers now live together and share one CI/release surface.

---

## Source Layout

| Area | Path | Purpose |
|------|------|---------|
| API and CRDs | `api/v1alpha1/`, `config/` | Kubernetes API types, generated CRDs, RBAC, and manager manifests |
| Operator | `cmd/operator/`, `internal/operator/` | Controller manager for Agent, AgentRun, Channel, Integration, Provider, and related resources |
| Console | `cmd/console/`, `internal/console/`, `web/` | Go BFF plus SolidJS PWA |
| Runtime | `cmd/runtime/` | Fantasy SDK agent runtime binary |
| Memory | `cmd/memory/` | SQLite/FTS5 memory service |
| Tools | `tools/`, `cmd/tools-cli/` | MCP tool servers and OCI packager CLI |
| Channels | `channels/` | Event bridge images such as webhook and GitLab bridges |
| Charts | `deploy/charts/` | AgentOps umbrella chart and agent-factory chart |
| Local dev | `deploy/local-k3s/` | k3s development manifests and just recipes |
| Docs | `docs/` | Hugo documentation site |

---

## Published Artifacts

The monorepo still publishes separate runtime artifacts because Kubernetes deployments, Helm dependencies, and tool OCI artifacts have independent consumers.

| Component | Artifact |
|-----------|----------|
| Operator image | `ghcr.io/samyn92/agentops/operator` |
| Console image | `ghcr.io/samyn92/agentops/console` |
| Runtime image | `ghcr.io/samyn92/agentops/runtime` |
| Memory image | `ghcr.io/samyn92/agentops/memory` |
| Tool artifacts | `ghcr.io/samyn92/agentops/tools/<server>` |
| Channel images | `ghcr.io/samyn92/agentops/channels/<type>` |
| Helm chart | `oci://ghcr.io/samyn92/agentops/charts/agentops` |

The version matrix for a release lives at `deploy/charts/versions.yaml`.

---

## Release Model

Releases are cut from the monorepo with a single `v*` tag. The GitHub release workflow builds and publishes the component images, MCP tool OCI artifacts, channel images, Helm chart, and GitHub release notes from that tag.

Component package names are intentionally stable even though their source moved into one repository. That keeps existing Helm values and cluster deployments compatible while the source-of-truth moves to `agentops`.
