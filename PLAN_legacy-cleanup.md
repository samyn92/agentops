# PLAN: Legacy Repo Cleanup

> Status: Execute after monorepo is E2E tested on k3s  
> Blocked by: Successful `just up` + `just con-reload` + `just op-reload` on monorepo paths

## Pre-requisites (must all pass before cleanup)

- [ ] `just --justfile deploy/local-k3s/deploy/justfile up` deploys both dev pods from monorepo
- [ ] `just con-reload` builds and serves BFF from `/workspace/cmd/console/`
- [ ] `just op-reload` builds and runs operator from `/workspace/cmd/operator/`
- [ ] Console UI loads at `http://localhost:30173` (Vite HMR works)
- [ ] Board displays issues, agent status polling works
- [ ] Plan Refinement works (comment, revise, approve)
- [ ] `just rt-reload` builds runtime image from monorepo paths
- [ ] GitHub CI passes on the `monorepo` branch

## Cleanup Steps

### 1. Merge `monorepo` branch to `main`
```bash
cd ~/dev/github.com/samyn92/agentops
git checkout main
git merge monorepo
git push origin main
```

### 2. Archive old repos on GitHub
For each: set description to "Archived — moved to github.com/samyn92/agentops", archive the repo.

```bash
for repo in agentops-core agentops-console agentops-runtime agentops-memory agent-tools agent-channels agentops-platform; do
  gh repo edit samyn92/$repo --description "Archived — moved to github.com/samyn92/agentops" 
  gh repo archive samyn92/$repo --yes
done
```

### 3. Update GitLab OAuth redirect URL
Current: `http://localhost:30173/auth/callback`  
No change needed (still correct — the monorepo doesn't change the runtime URL).

### 4. Update any external references
- GitLab CI dispatch tokens (if any) → point to new repo
- Any webhook URLs → update
- Go module proxy cache → new module name is `github.com/samyn92/agentops` (no conflicts with old modules)

### 5. Local filesystem cleanup (optional)
The old repos at `~/dev/github.com/samyn92/agentops-*` can be removed once the monorepo is confirmed working. Keep them for a week as backup.

```bash
# After 1 week of successful monorepo operation:
cd ~/dev/github.com/samyn92
rm -rf agentops-core agentops-console agentops-runtime agentops-memory
rm -rf agent-tools agent-channels agentops-platform
rm -f PLAN_*.md  # already in monorepo
```

### 6. Update AGENTS.md in workspace root
The root `~/dev/github.com/samyn92/AGENTS.md` should point to the monorepo instead of describing the multi-repo layout.
