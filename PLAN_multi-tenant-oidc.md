# PLAN: Multi-Tenant GitLab OIDC Console + Agent Platform

> Status: Ready to implement  
> Created: 2026-06-20  
> Context: The OIDC foundation is live and working (login/callback/session/me endpoints, merge gate uses user's token). This plan describes the next phase: making the console a proper multi-tenant GitLab-native platform.

## Vision

AgentOps Console becomes a **multi-tenant DevOps agent platform** where:
- Multiple users authenticate via GitLab OIDC
- Each user sees only the repos/groups they have access to (GitLab enforces)
- Agents operate under scoped bot tokens (per-repo/group service accounts)
- The console is a pure OAuth2 proxy for the human's GitLab session
- Agent dispatch is authorized against the user's GitLab access level

## Architecture (three identity tiers)

```
┌─────────────────────────────────────────────────────────────┐
│  HUMAN (console UI)                                          │
│  Identity: GitLab OIDC (access_token from session)           │
│  Reads: user's token → sees only their repos/groups          │
│  Writes: user's token → GitLab enforces branch protection    │
│  Agent control: verified Developer+ on the target repo       │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  AGENTS (runtime pods)                                       │
│  Identity: Bot token (Group/Project Access Token per Integration) │
│  Reads/Writes: scoped to the Integration's repo/group        │
│  Cannot merge (protected branches block bots)                │
│  Clearly labeled in GitLab as "agentops-bot" (service user)  │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  CONSOLE BFF (platform)                                      │
│  No own GitLab token — proxies the human's OIDC token        │
│  Agent dispatch: creates AgentRun CRs (K8s SA, not GitLab)   │
│  Reads K8s: in-cluster SA (agents, runs, channels, etc.)     │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

1. **OIDC for ALL GitLab reads** — the console browses as the user, not a bot. GitLab's permission model IS the authorization layer. No parallel RBAC to invent.

2. **Login wall** — no session = no access. The console is useless without auth. Unauthenticated requests to `/api/v1/*` return 401; the frontend redirects to `/auth/login`.

3. **Workspace discovery from user access** — instead of listing Integration CRs (which are agent-infrastructure), the console asks GitLab "what groups/projects does this user have access to?" and shows those as available workspaces. Integrations become invisible to the UI.

4. **Agent dispatch authorization** — before creating an AgentRun, the BFF verifies the user has at least Developer access on the target repo (one GitLab API call). This prevents a user from dispatching agents on repos they can't push to.

5. **Integration credentials = agent-only** — the console BFF never touches them. The operator injects them into agent pods (runtime). Clean separation: humans use OIDC, machines use bot tokens.

## Implementation Steps

### Phase 1: Login Wall + OIDC-Proxied Reads (the pivot)

**BFF:**
- [ ] Login wall middleware on `/api/v1/*` routes (require valid session, else 401)
- [ ] Rework `proxyGitLabAPI` / `resolveWorkspace`: read the user's OIDC access_token from the session and use it for ALL GitLab API calls (instead of looking up Integration credentials)
- [ ] Token refresh middleware: if the access token is near-expiry, auto-refresh before proxying
- [ ] Remove the Integration-credential lookup path from the console's GitLab proxy entirely (agent-only concern now)

**Frontend:**
- [ ] On 401 from any API call → redirect to `/auth/login?return_to=<current_path>`
- [ ] Remove the Integration-based workspace selector (it's irrelevant now)
- [ ] New workspace discovery: `GET /api/v1/workspaces` → BFF calls GitLab `GET /groups` + `GET /projects` with user's token → returns the list of accessible workspaces

### Phase 2: Workspace Discovery (user-scoped)

**BFF:**
- [ ] New endpoint `GET /api/v1/workspaces` — calls GitLab:
  - `GET /api/v4/groups?min_access_level=20` (Developer+) → list groups
  - `GET /api/v4/projects?min_access_level=20&membership=true` → list standalone projects
  - Merges into a unified workspace list (same shape the frontend already consumes)
- [ ] Each workspace has: id, name, path, kind (group/project), web_url, avatar
- [ ] The existing `/group/*` read routes continue to work — they just use the user's token now instead of a bot token

**Frontend:**
- [ ] Workspace selector populated from `/api/v1/workspaces` (user's accessible groups + projects)
- [ ] Selecting a workspace sets the `WsCtx` (unchanged semantics — the `/group/*` routes handle both kinds via `resolveWorkspace`)

### Phase 3: Agent Dispatch Authorization

**BFF:**
- [ ] `DispatchAgentRun` (POST /agentruns): before creating the CR, verify:
  - Extract the target project from the request (`projectRef` or Integration's project)
  - Call GitLab `GET /projects/:id/members/all` with the user's token
  - Check the user has `access_level >= 30` (Developer) on that project
  - Reject with 403 + reason if not
- [ ] Same check for agent steer/abort (less critical — these target running daemons, not repos)

**Frontend:**
- [ ] "Dispatch fix" dialog: if the dispatch returns 403 (insufficient GitLab access), show a clear message ("You don't have Developer access to this repo")

### Phase 4: Agent Bot Token Separation (Infrastructure)

**Cluster (Integrations + Secrets):**
- [ ] Each gitlab-group / gitlab-project Integration gets its own **bot token** (Group Access Token or Project Access Token with Developer role)
- [ ] The `gitlab-token` Secret is split into per-scope Secrets:
  - `gitlab-bot-samyn92-lab` (Group Access Token for the lab group)
  - `gitlab-bot-homecluster` (Project Access Token for the homecluster repo)
- [ ] Integrations reference their specific Secret
- [ ] The console BFF NEVER reads these Secrets — only the operator injects them into agent pods

**Token properties (for the bot):**
- Role: Developer (can push, open MRs, comment — CANNOT merge on protected branches)
- Scopes: `api`, `write_repository`
- Name: `agentops-bot` (shows clearly in GitLab audit/activity)

### Phase 5: Audit + "Acting As" UI Polish

**Frontend:**
- [ ] Timeline events distinguish human vs. bot actions (different badge/color)
- [ ] Merge gate shows "Merging as [username] (via GitLab OIDC)" — already started
- [ ] Agent-opened MRs show "opened by agentops-bot [agent-name]" vs human MRs
- [ ] Dispatch actions show "dispatched by [username]" in the card trace

## What Already Exists (done this session)

- [x] GitLab OAuth2 Application created + `gitlab-oauth` Secret deployed
- [x] `internal/auth/auth.go` — full OAuth2 Authorization Code flow (login redirect, callback, token exchange, token refresh, encrypted cookie session, /auth/me user info)
- [x] Auth routes wired in server.go (`/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`)
- [x] `handlers.New` accepts `*auth.Auth`, `userTokenOrFallback()` helper
- [x] Merge gate (`MergeMergeRequest`) uses user's OIDC token when logged in
- [x] MR note creation uses user's OIDC token when logged in
- [x] Frontend: `stores/auth.ts` reactive store (currentUser, isAuthenticated, login, logout)
- [x] Frontend: "Sign in" / avatar+username in TopBar header
- [x] Frontend: merge gate requires login when OIDC enabled ("Sign in to merge")
- [x] Vite proxy configured for `/auth/*` → BFF
- [x] console-dev pod mounts `gitlab-oauth` Secret as env vars
- [x] BFF compiles + frontend typechecks + `/auth/login` redirects to gitlab.com correctly

## What's NOT Done Yet

- [ ] Login wall middleware (routes are still open)
- [ ] GitLab reads using OIDC token (still using bot/Integration token)
- [ ] Workspace discovery from user access (still Integration-based)
- [ ] Agent dispatch authorization
- [ ] Bot token separation (one shared `gitlab-token` → per-scope bot tokens)
- [ ] Full "acting as" audit polish

## Dependencies / Blockers

- **`gitlab-token` Secret is currently EMPTY on k3s** — the agents + channels are broken until a new bot token is created and applied. This is independent of OIDC (agents need their own bot tokens regardless).
- **homecluster platform MR still pending** — the v0.17.3 bump commit is ready locally (`/tmp/opencode/homecluster`, branch `agentops/bump-platform-0.17.3`) but couldn't be pushed (GitLab token was empty). Needs pushing once a token exists.
- **The `notify-platform` cross-repo dispatch is broken** — core/console releases can't auto-cascade to the platform repo. A `PLATFORM_DISPATCH_TOKEN` PAT needs to be added to core + console repo secrets. Low priority (manual bumps work).

## Files Changed This Session (uncommitted in agentops-console)

```
internal/auth/auth.go              NEW — full OIDC package
internal/handlers/handlers.go      — Auth field + userTokenOrFallback
internal/handlers/board.go         — merge/note use OIDC token
internal/handlers/dispatch.go      NEW — POST /agentruns with retry budget
internal/handlers/gitlab_group.go  — resolveWorkspace (dual-kind), enrichMRPipelines
internal/k8s/client.go             — CreateAgentRun
internal/server/server.go          — auth routes + auth provider init
web/src/stores/auth.ts             NEW — reactive auth store
web/src/lib/api.ts                 — authApi + agentRuns.dispatch + DispatchRequest/Response + gitlabWorkspaces
web/src/pages/MissionControl.tsx   — fleet rail, CI badges, fix-dispatch, workspace generalization, trace inline, OIDC UI
web/src/components/traces/TraceDetailView.tsx — graceful empty state
web/src/types/api.ts               — GroupRunMR, gitlab project spec, auth types
web/vite.config.ts                 — /auth proxy
local_k3s/deploy/console-dev.yaml  — OAuth env vars
local_k3s/secrets/gitlab-oauth.yaml — Secret skeleton
```

## Other Session Accomplishments (context for next session)

- Full svc- lifecycle swarm (10 agents + 2 channels) deployed on k3s
- homecluster read-only observer SA + kubeconfig (for future CD lens)
- Coordinated 4-repo release: core v0.20.0, console v0.11.9, platform v0.17.3
- homecluster platform modernization MR !28 merged + CRDs applied (console crashlooping on RBAC → fixed in v0.11.9 chart, umbrella v0.17.3 published, homecluster needs bump to v0.17.3)
- Tempo storage corruption diagnosed + fixed (one empty block removed)
- CI repair loop fully functional (billing-svc issue #8 demo with rigged CI)
