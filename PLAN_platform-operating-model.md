# PLAN: AgentOps Platform Operating Model

> Status: Draft  
> Last updated: 2026-06-04  
> Scope: Multi-repo development, versioning, AI-agent instructions, release hygiene

---

## 1. Why This Exists

AgentOps is not a single app anymore. It is a platform made from several repos:

- `agentops-core` owns the Kubernetes API contract and controllers.
- `agentops-runtime` owns agent execution behavior.
- `agentops-console` owns the user-facing control plane and BFF.
- `agentops-memory` owns persistent agent memory.
- `agent-tools` owns MCP tool servers and OCI packaging.
- `agent-channels` owns external event ingress.
- `agentops-platform` owns installation and version composition.
- `agentops` owns docs.

That split is valid for a microservice-style platform, but it creates one major
operational risk: each repo can drift into a different version of the truth.

The operating model should make the platform feel like one product while still
allowing services to be developed and released independently when that is useful.

---

## 2. Core Principle

Treat `agentops-platform` as the product composition layer.

Individual repos can have their own tags, images, tests, and release cadence,
but there must always be one explicit answer to this question:

> Which versions of core, console, runtime, memory, tools, channels, and docs are
> known to work together?

That answer should live in a compatibility matrix and be updated at every release
savepoint.

---

## 3. Recommended Source Of Truth

Add a single platform version matrix, either:

- `agentops-platform/versions.yaml` for machine-readable automation, or
- top-level `PLATFORM_MATRIX.md` for human-first tracking.

Prefer `agentops-platform/versions.yaml` long term because Helm values,
release scripts, docs, and AI agents can consume it.

Suggested shape:

```yaml
platform: 0.20.0
date: 2026-06-04
components:
  core: v0.20.0
  console: v0.12.0
  runtime: v0.19.0
  memory: v0.4.2
  agent_tools: v0.9.0
  agent_channels: v0.4.0
  docs: v0.20.0
contracts:
  agent_crd: v1alpha1
  fantasy_runtime_image: ghcr.io/samyn92/agentops-runtime-fantasy:v0.19.0
  memory_api: v1
```

This file should become the thing an agent checks before proposing version bumps,
Helm updates, docs updates, or k3s deployment changes.

---

## 4. Release Train

Day-to-day development should stay fast:

1. Edit locally.
2. Validate in local k3s with dev pods and `:dev` images.
3. Keep commits local until the feature reaches a savepoint.
4. At savepoint, release the smallest coherent platform set.

Release savepoint checklist:

- Run repo tests for every changed component.
- Validate the changed path in local k3s.
- If `agentops-runtime` changed, tag a real runtime version.
- If runtime compatibility changed, update `DefaultFantasyImage` in `agentops-core`.
- Update the platform version matrix.
- Refresh Helm dependencies and lock files intentionally.
- Update docs and AGENTS notes affected by the change.
- Push commits and tags.
- Then decide whether to observe GitHub or GitLab pipelines.

The important rule is that runtime and core compatibility must be explicit. A
floating runtime tag is useful for local development, but a release must use a
real runtime tag.

---

## 5. Microservice Boundary Rule

A component deserves a separate repo/service when at least one of these is true:

- It has an independent deployment lifecycle.
- It has a different security boundary.
- It has a different dependency/build profile.
- It exposes a stable contract consumed by other components.
- It can be tested and released independently without forcing a full platform cut.

A component should stay inside an existing repo when most changes are lockstep
with another component, when it only contains private implementation details, or
when splitting it would mostly create versioning overhead.

Current split assessment:

- `agentops-core`: keep separate. It is the Kubernetes API/control-plane contract.
- `agentops-runtime`: keep separate. It is the pod binary and has a hard image contract.
- `agentops-memory`: keep separate. It is a real service with its own API and data store.
- `agentops-console`: keep separate. UI/BFF release concerns differ from controller/runtime.
- `agent-tools`: keep separate. Tool servers are reusable OCI artifacts.
- `agent-channels`: keep separate if channel bridges remain independently packaged.
- `agentops-platform`: keep separate as the composition and install surface.
- `agentops` docs: can remain separate, but must track the platform matrix.

The issue is not that there are too many repos. The issue is missing cross-repo
contract enforcement.

---

## 6. AGENTS.md Strategy

`AGENTS.md` is a strong fit for this project because agents need local operating
rules, repo boundaries, and release policy. The risk is duplication and stale
instructions.

Recommended structure:

- Top-level `AGENTS.md`: stable platform rules only.
- Per-repo `AGENTS.md`: repo-specific commands, architecture, and sharp edges.
- No duplicated version pins unless they are generated from the platform matrix.
- Every per-repo file should point back to the top-level release and k3s cadence.

Good content for AGENTS files:

- How to test locally.
- Which commands are safe for day-to-day iteration.
- Which files define public contracts.
- Release coupling rules.
- Known generated files and files that should not be hand-edited.

Bad content for AGENTS files:

- Stale version numbers copied from old releases.
- Long architecture essays that belong in docs.
- Deprecated object names that are no longer part of the API.
- Manual instructions that contradict the justfile.

---

## 7. Contract Checks

Add lightweight checks that prevent known drift from coming back:

- No `AgentTool` / `AgentResource` references in active code once fully migrated.
- No `Engram` naming except temporary backwards-compatible env fallbacks.
- No tracked `*.tsbuildinfo`.
- No stale Helm `Chart.lock` or vendored chart tarballs.
- No `:latest` images in production examples.
- No docs examples using removed CRD fields.
- `agentops-core` default runtime image must match the approved runtime version.
- `agentops-platform` dependencies must match declared chart versions.

These checks can start as a simple script run manually before releases. Later
they can become CI.

---

## 8. Cleanup Cadence

Run a cleanup pass before every platform release:

1. Search for deprecated API names and old service names.
2. Check ignored build outputs with `git clean -ndX` per repo.
3. Check dirty worktrees and untracked source directories.
4. Validate Helm dependency state.
5. Render local k3s manifests.
6. Render core CRD samples.
7. Verify docs examples still match real CRDs.

Cleanup should be separate from feature work when possible. Mixing cleanup with
feature changes makes cross-repo releases harder to reason about.

---

## 9. Practical Next Moves

Recommended order:

1. Fix security-sensitive local secret handling.
2. Fix broken `agentops-core/config/samples` rendering.
3. Add the platform version matrix.
4. Refresh `agentops-platform` Helm dependencies.
5. Remove tracked TypeScript build info.
6. Decide whether `AgentTool` / `AgentResource` are fully deprecated, then clean
   docs, console clients, RBAC, and samples.
7. Finish the Engram-to-memory naming cleanup.
8. Decide the fate of unfinished channel implementations and samples.
9. Add a pre-release drift check script.

This creates a tighter loop: local k3s for speed, version matrix for truth,
platform chart for composition, and AGENTS files for agent behavior.

Current implementation:

- Version matrix: `agentops-platform/versions.yaml`
- Drift check: `agentops-platform/scripts/pre-release-drift-check.sh`
