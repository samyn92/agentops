# PLAN: AgentOps Platform Operating Model

> Status: Active
> Last updated: 2026-06-26
> Scope: Monorepo development, versioning, AI-agent instructions, release hygiene

---

## 1. Why This Exists

AgentOps has moved from multiple repositories into one monorepo: `github.com/samyn92/agentops`.

The monorepo contains the operator, console, runtime, memory service, MCP tool servers, channel bridges, Helm charts, docs, and local k3s development manifests. The remaining operational risk is no longer cross-repo drift; it is drift between source directories, generated manifests, Helm values, docs, and published artifacts.

---

## 2. Core Principle

One repo owns the source of truth. Releases still publish multiple artifacts because the platform is deployed as multiple Kubernetes components:

- Operator image: `ghcr.io/samyn92/agentops-operator`
- Console image: `ghcr.io/samyn92/agentops-console`
- Runtime image: `ghcr.io/samyn92/agentops-runtime-fantasy`
- Memory image: `ghcr.io/samyn92/agentops-memory`
- Tool OCI artifacts: `ghcr.io/samyn92/agent-tools/<server>`
- Channel images: `ghcr.io/samyn92/agent-channel-<type>`
- Helm chart: `oci://ghcr.io/samyn92/charts/agentops`

Artifact names remain stable for compatibility. Source ownership is centralized in `agentops`.

---

## 3. Source Of Truth

The release matrix lives at:

- `deploy/charts/versions.yaml`

That file should be updated when a release changes published versions, default runtime images, Helm dependency versions, or externally consumed contracts.

---

## 4. Release Train

Day-to-day development should stay fast:

1. Edit locally.
2. Validate in local k3s with dev pods and `:dev` images.
3. Keep commits local until the feature reaches a savepoint.
4. At savepoint, release one coherent monorepo tag.

Release savepoint checklist:

- Run Go tests for changed backend/controller/runtime/tool/channel code.
- Run web typecheck/build when `web/` changed.
- Validate the changed path in local k3s when manifests, runtime behavior, or charts changed.
- Regenerate CRDs when API types changed.
- Update `deploy/charts/versions.yaml`.
- Refresh Helm dependencies and lock files intentionally.
- Update docs and `AGENTS.md` notes affected by the change.
- Push commits and tags.
- Observe the GitHub release workflow.

The important rule is that runtime and CRD compatibility must be explicit. A floating runtime tag is useful for local development, but a release must use a real tag.

---

## 5. Boundary Rule

Components can remain separate deployable artifacts when at least one of these is true:

- They have an independent runtime boundary in Kubernetes.
- They have a different security boundary.
- They expose a stable contract consumed by other components.
- They need separate image or OCI artifact packaging.

They should not live in separate source repositories unless there is a strong ownership or lifecycle reason to split them again.

---

## 6. AGENTS.md Strategy

`AGENTS.md` should describe stable monorepo operating rules:

- Local k3s development flow.
- Directory ownership and package boundaries.
- Safe reload commands.
- Public contracts and generated files.
- Release coupling rules.

Avoid stale component version pins in `AGENTS.md`; use `deploy/charts/versions.yaml` for version truth.

---

## 7. Contract Checks

Add lightweight checks that prevent known drift from coming back:

- No stale old-repo URLs in active docs or chart metadata.
- No tracked `*.tsbuildinfo`.
- No stale Helm `Chart.lock` or vendored chart tarballs.
- No `:latest` images in production examples.
- No docs examples using removed CRD fields.
- Default runtime image must match the approved runtime version.
- Helm dependencies must match declared chart versions.

These checks can start as a manual pre-release script and later become CI.

---

## 8. Cleanup Cadence

Run a cleanup pass before every release:

1. Search for deprecated API names and old repository names.
2. Check ignored build outputs with `git clean -ndX`.
3. Check dirty worktree and untracked source directories.
4. Validate Helm dependency state.
5. Render local k3s manifests.
6. Render CRD samples.
7. Verify docs examples still match real CRDs.

Cleanup should be separate from feature work when possible.

---

## 9. Practical Next Moves

1. Keep the monorepo release workflow green.
2. Add a pre-release drift check script.
3. Decide whether to archive or delete the old GitHub repositories.
4. Remove old local repository checkouts after the monorepo release is verified.
5. Finish any remaining Engram-to-memory naming cleanup.

Current implementation:

- Version matrix: `deploy/charts/versions.yaml`
- Release workflow: `.github/workflows/release.yaml`
