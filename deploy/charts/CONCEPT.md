# AgentOps Chart and Release Architecture

AgentOps is released from the `github.com/samyn92/agentops` monorepo.

The source is centralized, but the release still publishes multiple artifacts because the deployed platform has separate runtime boundaries: operator, console, runtime, memory, OCI tool artifacts, channel bridges, and Helm charts.

## Core Chart

The umbrella chart lives at:

- Source: `deploy/charts/agentops/`
- OCI chart: `oci://ghcr.io/samyn92/agentops/charts/agentops`

It installs the AgentOps platform:

- `agentops-operator` subchart for CRDs, RBAC, and controllers
- `agentops-console` subchart for the Go BFF and SolidJS PWA
- inline `agentops-memory` Deployment, Service, and PVC
- Tempo for tracing
- NATS for FEP event delivery

## Agent Factory Chart

The agent factory chart lives at:

- Source: `deploy/charts/agent-factory/`
- OCI chart: `oci://ghcr.io/samyn92/agentops/charts/agent-factory`

It provides reusable agent team definitions and presets. It is separate from the platform chart because agent definitions can change independently from infrastructure.

## Published Artifacts

| Artifact | Registry |
|----------|----------|
| Operator image | `ghcr.io/samyn92/agentops/operator` |
| Console image | `ghcr.io/samyn92/agentops/console` |
| Runtime image | `ghcr.io/samyn92/agentops/runtime` |
| Memory image | `ghcr.io/samyn92/agentops/memory` |
| Tool OCI artifacts | `ghcr.io/samyn92/agentops/tools/<server>` |
| Channel images | `ghcr.io/samyn92/agentops/channels/<type>` |
| Platform chart | `oci://ghcr.io/samyn92/agentops/charts/agentops` |

The artifact package names stay stable for compatibility with existing clusters and Helm values.

## Version Matrix

Release metadata lives at:

- `deploy/charts/versions.yaml`

This file records the monorepo tag, chart version, app version, published artifact names, chart dependencies, and external contracts for the release.

## Release Flow

A release is cut by pushing a `v*` tag from the monorepo.

The GitHub release workflow:

1. Builds and pushes component images.
2. Builds and pushes OCI tool artifacts.
3. Builds and pushes channel images.
4. Packages and pushes the `agentops` Helm chart.
5. Creates GitHub release notes.

Before tagging, update `deploy/charts/versions.yaml`, refresh chart dependencies intentionally, and verify local k3s paths touched by the change.
