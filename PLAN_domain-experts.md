# PLAN: Domain Experts Architecture

> Status: Implementing  
> Created: 2026-06-21  
> Context: The agent factory deploys "domain experts" — NOT generic agents with different prompts, but specialists with deep context about their area of the codebase and infrastructure.

## Vision

Each domain expert is the SAME runtime binary but with:
1. **System prompt** — role identity and behavioral guidelines
2. **Context files** — deep domain knowledge (schemas, conventions, runbooks)
3. **Tool access** — only the tools relevant to their domain
4. **Memory** — accumulated lessons learned in their specific area

## Domain Expert Archetypes (DevOps/GitOps)

| Expert | Mode | Context | Tools | What They Know |
|--------|------|---------|-------|----------------|
| **Platform Planner** | daemon | Cross-cutting | git, gitlab | How to break down work, assign to experts, coordinate |
| **Cluster Engineer** | daemon | GitOps structure, Flux, HelmRelease schemas | git, gitlab, kubectl, flux | Infrastructure-as-code, reconciliation, namespaces |
| **Chart Engineer** | daemon | Helm standards, values schemas, chart CI | git, gitlab, helm | Chart development, templating, OCI publishing |
| **Software Engineer** | task | Per-repo (reads codebase) | git, gitlab, bash | Service code, APIs, tests, CI pipelines |
| **Observability Engineer** | daemon | Monitoring stack, alert rules, SLOs | git, gitlab, kubectl, tempo | Metrics, traces, logs, dashboards |
| **Release Manager** | daemon | Versioning, cross-repo deps | git, gitlab | Releases, changelogs, promotion flows |
| **CI Fixer** | task | CI pipeline patterns | git, gitlab, bash | Pipeline failures, lint errors, build fixes |

## Context Files (CRD Support)

Already supported in the Agent CRD:
```yaml
spec:
  contextFiles:
    - name: gitops-conventions
      configMapRef:
        name: cluster-context
        key: conventions.md
    - name: helm-standards
      configMapRef:
        name: chart-context
        key: standards.md
```

These are injected into the agent's system prompt or available via a tool.
They contain the "institutional knowledge" that makes the expert actually expert.

## UI Implications

### Explore Tab
- Sidebar shows "Domain Experts" (not "Agents")
- Only daemon agents (the ones you can consult)
- Each shows their role and online status
- Click to chat — ask domain-specific questions

### Factory Tab (New Plan)
- Modal shows expert picker: "Who should plan this?"
- Select Cluster Engineer for infra work
- Select Chart Engineer for chart work
- The selected expert generates the plan with domain-appropriate context

### Future: Skills/Context Injection
- Each expert's context files are editable in the console
- Update conventions without redeploying agents
- ConfigMap-backed — hot-reload on change

## Implementation Status

- [x] Factory values with domain expert archetypes
- [x] Explore sidebar renamed to "Domain Experts"
- [x] New Plan modal: expert picker
- [x] Agent factory generates contextFiles from values
- [ ] Agent CRD contextFiles actually injected as ConfigMaps (operator)
- [ ] Console UI to edit context files
- [ ] Hot-reload context on ConfigMap change
