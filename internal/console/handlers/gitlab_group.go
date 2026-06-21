// GitLab group handlers — group-scoped read proxies backing the redesigned
// GitLab observability workspace. A single gitlab-group Integration holds a
// group access token, letting the console browse every project, issue, merge
// request and pipeline in the group from one place and overlay agent runs and
// traces on top. All require a ready gitlab-group Integration.
//
// Per-project actions (merge-request detail/diff/notes/pipelines, the human
// merge gate, issue label moves) reuse the work-board handlers in board.go,
// which now accept a ?project=<id> query param to target the specific project a
// group-aggregated card belongs to.
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	agentsv1alpha1 "github.com/samyn92/agentops/api/v1alpha1"
)

// issueBranchRe recovers a work-item iid from the bridge's deterministic
// feature-branch convention (agent/issue-<iid>) when a delegated run carries no
// explicit gitlab-iid annotation. Best-effort fallback only.
var issueBranchRe = regexp.MustCompile(`(?:^|/)issue-(\d+)\b`)

// gitlabHTTPClient is shared by the server-side fan-out aggregators (which call
// the GitLab API directly and parse JSON, rather than streaming a proxy body).
var gitlabHTTPClient = &http.Client{Timeout: 20 * time.Second}

// gitlabGetJSON performs an authenticated GET against the GitLab API and decodes
// the JSON response into out. Used by the group aggregators that fan out across
// every project (pipelines health, etc.).
func gitlabGetJSON(ctx context.Context, token, baseURL, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+path, nil)
	if err != nil {
		return err
	}
	if token != "" {
		setGitLabAuth(req, token, ctx)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := gitlabHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("gitlab %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Work-board join annotations stamped on AgentRuns by the gitlab-label channel
// bridge. The console uses these to overlay the executing run (and its trace)
// onto the group-aggregated issue/MR card it is working.
const (
	annGitlabIID     = "agentops.dev/gitlab-iid"
	annGitlabProject = "agentops.dev/gitlab-project"
	annGitlabTarget  = "agentops.dev/gitlab-target"
	annGitlabTrigger = "agentops.dev/gitlab-trigger"

	// CI repair-loop annotations, stamped by the console on fix-dispatch runs
	// (DispatchAgentRun). annCIFixAttempt records the 1-based attempt number so
	// the BFF can count attempts per MR and enforce a retry budget; annGitlabMR
	// records the target MR iid (the fix runs on its source branch).
	annCIFixAttempt = "agentops.dev/ci-fix-attempt"
	annGitlabMR     = "agentops.dev/gitlab-mr"
)

// workspaceTarget resolves a ready GitLab Integration into a board workspace,
// supporting BOTH a gitlab-group (many projects) and a gitlab-project (a single
// project) as equally first-class workspaces. The read handlers below use it to
// scope GitLab API paths: group mode hits /groups/{group}/..., single-project
// mode hits /projects/{id}/... for the integration's one project.
type workspaceTarget struct {
	baseURL string
	token   string
	// kind: IntegrationKindGitLabGroup or IntegrationKindGitLabProject.
	isGroup bool
	// Group mode: the URL-escaped group path.
	group string
	// Single-project mode: the project path + its resolved numeric id (resolved
	// once via GET /projects/{path}). projectID is also what we scope to.
	projectPath string
	projectID   int
}

// resolveWorkspace resolves the integration for a board workspace. For a
// gitlab-project it additionally resolves the numeric project id (needed so the
// frontend's projectsById / run-join logic can match cards). Writes an error
// response and returns ok=false on failure.
//
// Multi-tenant pivot: when the user's OIDC token is present in request context
// (from RequireAuth middleware), it's used for ALL GitLab reads. The
// Integration still provides the workspace path (group/project) and baseURL,
// but its Secret credential is ignored — the user's own access is the authz
// boundary. This means users only see data GitLab grants them access to.
func (h *Handlers) resolveWorkspace(w http.ResponseWriter, r *http.Request) (workspaceTarget, bool) {
	intg, botToken, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return workspaceTarget{}, false
	}

	// Prefer user's OIDC token over bot token for all console reads.
	tok := h.userToken(r)
	if tok == "" {
		tok = botToken // Fallback when auth is disabled
	}

	switch {
	case intg.Spec.Kind == agentsv1alpha1.IntegrationKindGitLabGroup && intg.Spec.GitLabGroup != nil:
		return workspaceTarget{
			baseURL: intg.Spec.GitLabGroup.BaseURL,
			token:   tok,
			isGroup: true,
			group:   url.PathEscape(intg.Spec.GitLabGroup.Group),
		}, true
	case intg.Spec.Kind == agentsv1alpha1.IntegrationKindGitLabProject && intg.Spec.GitLab != nil:
		t := workspaceTarget{
			baseURL:     intg.Spec.GitLab.BaseURL,
			token:       tok,
			isGroup:     false,
			projectPath: intg.Spec.GitLab.Project,
		}
		// Resolve the numeric project id once (used to scope + to populate
		// projectsById on the frontend). Best-effort: a failure leaves id 0,
		// which the project-scoped handlers tolerate (they address by path).
		var p glProjectLite
		if err := gitlabGetJSON(r.Context(), tok, t.baseURL,
			"/api/v4/projects/"+url.PathEscape(t.projectPath), &p); err == nil {
			t.projectID = p.ID
		}
		return t, true
	default:
		writeError(w, http.StatusBadRequest,
			"this endpoint requires a gitlab-group or gitlab-project integration, got %s", intg.Spec.Kind)
		return workspaceTarget{}, false
	}
}

// groupTarget was the original gitlab-group-only resolver. It has been replaced
// by resolveWorkspace (which accepts a group OR a single project). Kept removed
// intentionally — all board read handlers are now workspace-aware.

// forwardQuery copies an allow-list of query params from the incoming request
// onto a GitLab API query string, so the frontend can drive server-side
// filtering/pagination without the BFF re-implementing GitLab's query surface.
// Returns a string beginning with "&" for each present key (callers append to a
// path that already has at least one query param).
func forwardQuery(r *http.Request, allowed ...string) string {
	in := r.URL.Query()
	out := ""
	for _, k := range allowed {
		if v := in.Get(k); v != "" {
			out += "&" + url.QueryEscape(k) + "=" + url.QueryEscape(v)
		}
	}
	return out
}

// proxyGitLabAPIWrapList fetches a single GitLab object (e.g. one project) and
// returns it wrapped as a one-element JSON array. Lets a single-project board
// workspace satisfy the frontend's "list of projects" expectation with exactly
// the one project the integration targets.
func (h *Handlers) proxyGitLabAPIWrapList(w http.ResponseWriter, r *http.Request, token, baseURL, path string) {
	var obj json.RawMessage
	if err := gitlabGetJSON(r.Context(), token, baseURL, path, &obj); err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch project: %s", err)
		return
	}
	writeJSON(w, http.StatusOK, []json.RawMessage{obj})
}

// GroupProjects lists the projects in the workspace. For a group: every project
// (newest-activity first, with statistics). For a single-project integration:
// just that one project (so the frontend's RepoSwitcher/projectsById resolve).
// GET .../integrations/{ns}/{intgName}/group/projects?search=&per_page=
func (h *Handlers) GroupProjects(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return
	}
	if !ws.isGroup {
		// Single project: return a 1-element list = the integration's project.
		h.proxyGitLabAPIWrapList(w, r, ws.token, ws.baseURL,
			"/api/v4/projects/"+url.PathEscape(ws.projectPath)+"?statistics=true&license=true")
		return
	}
	path := fmt.Sprintf(
		"/api/v4/groups/%s/projects?include_subgroups=true&with_shared=false&archived=false&order_by=last_activity_at&sort=desc&per_page=100",
		ws.group)
	path += forwardQuery(r, "search", "per_page", "page")
	h.proxyGitLabAPI(w, r, ws.token, ws.baseURL, path)
}

// GroupIssues lists issues across the workspace, filterable by label/state/
// author/milestone/search — the backbone of the work board. Group mode hits the
// group endpoint; single-project mode hits the project endpoint (which still
// returns project_id on each issue, so the board's join logic is unchanged).
// GET .../integrations/{ns}/{intgName}/group/issues?labels=&state=&...
func (h *Handlers) GroupIssues(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return
	}
	var path string
	if ws.isGroup {
		path = fmt.Sprintf("/api/v4/groups/%s/issues?per_page=100&scope=all", ws.group)
	} else {
		path = fmt.Sprintf("/api/v4/projects/%s/issues?per_page=100&scope=all", url.PathEscape(ws.projectPath))
	}
	path += forwardQuery(r, "labels", "state", "author_username", "assignee_username",
		"milestone", "search", "order_by", "sort", "page", "per_page", "with_labels_details")
	h.proxyGitLabAPI(w, r, ws.token, ws.baseURL, path)
}

// GroupMergeRequests lists merge requests across the workspace, filterable.
// GET .../integrations/{ns}/{intgName}/group/merge_requests?state=&labels=&...
func (h *Handlers) GroupMergeRequests(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return
	}
	var path string
	if ws.isGroup {
		path = fmt.Sprintf("/api/v4/groups/%s/merge_requests?per_page=100&scope=all", ws.group)
	} else {
		path = fmt.Sprintf("/api/v4/projects/%s/merge_requests?per_page=100&scope=all", url.PathEscape(ws.projectPath))
	}
	path += forwardQuery(r, "labels", "state", "author_username", "assignee_username",
		"reviewer_username", "milestone", "search", "order_by", "sort", "page", "per_page",
		"with_labels_details", "wip", "source_branch", "target_branch")
	h.proxyGitLabAPI(w, r, ws.token, ws.baseURL, path)
}

// GroupLabels lists the workspace's labels so the board can render and filter by
// the scoped agent:: state-machine labels (and any others).
// GET .../integrations/{ns}/{intgName}/group/labels
func (h *Handlers) GroupLabels(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return
	}
	var path string
	if ws.isGroup {
		path = fmt.Sprintf("/api/v4/groups/%s/labels?per_page=100&with_counts=true", ws.group)
	} else {
		path = fmt.Sprintf("/api/v4/projects/%s/labels?per_page=100&with_counts=true", url.PathEscape(ws.projectPath))
	}
	path += forwardQuery(r, "search", "page", "per_page")
	h.proxyGitLabAPI(w, r, ws.token, ws.baseURL, path)
}

// GroupMembers lists workspace members so the browser can resolve and filter by
// author/assignee (avatars, names).
// GET .../integrations/{ns}/{intgName}/group/members
func (h *Handlers) GroupMembers(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return
	}
	var path string
	if ws.isGroup {
		path = fmt.Sprintf("/api/v4/groups/%s/members/all?per_page=100", ws.group)
	} else {
		path = fmt.Sprintf("/api/v4/projects/%s/members/all?per_page=100", url.PathEscape(ws.projectPath))
	}
	path += forwardQuery(r, "query", "page", "per_page")
	h.proxyGitLabAPI(w, r, ws.token, ws.baseURL, path)
}

// ── Server-side run ↔ gitlab card join (Phase 5) ─────────────────────────────
//
// The work board overlays the AgentRun executing each issue/MR card. Rather than
// shipping every AgentRun to the browser and re-deriving the join client-side,
// this endpoint returns a compact, deduplicated join surface: one entry per
// (project, iid) work item, carrying the most-recent run's phase, outcome and
// — critically — its Tempo traceID, so the workspace can cross-link a card
// straight to its trace waterfall.

// GroupRunArtifact is a trimmed AgentRunArtifact for the join payload.
type GroupRunArtifact struct {
	Kind  string `json:"kind"`
	URL   string `json:"url,omitempty"`
	Ref   string `json:"ref,omitempty"`
	Title string `json:"title,omitempty"`
}

// GroupRunJoin links a gitlab work item (project + iid) to the AgentRun that is
// (or last was) executing it, plus the trace cross-link.
type GroupRunJoin struct {
	// Join keys (from the bridge's annotations).
	IID     string `json:"iid"`               // gitlab issue/MR iid
	Project string `json:"project,omitempty"` // project path or numeric id (annotation value)
	Target  string `json:"target,omitempty"`  // "issue" | "mr"
	Trigger string `json:"trigger,omitempty"` // trigger label (e.g. agent::todo)

	// Run summary.
	Run       string `json:"run"` // AgentRun name
	Namespace string `json:"namespace"`
	AgentRef  string `json:"agentRef"`
	Phase     string `json:"phase"`
	Created   string `json:"created,omitempty"`
	TraceID   string `json:"traceID,omitempty"` // Tempo trace cross-link
	Branch    string `json:"branch,omitempty"`  // spec.git.branch (the feature branch the run worked on)

	// Outcome (when written by the runtime).
	Intent    string             `json:"intent,omitempty"`
	Summary   string             `json:"summary,omitempty"`
	Artifacts []GroupRunArtifact `json:"artifacts,omitempty"`

	ToolCalls  int    `json:"toolCalls,omitempty"`
	TokensUsed int    `json:"tokensUsed,omitempty"`
	Model      string `json:"model,omitempty"`

	// ── Delivery edge: MR ↔ CI, joined server-side by the run's feature branch ──
	// Populated when the work item has a live merge request in the group (matched
	// on source_branch == run branch). Lets the board carry CI state on the card
	// without a per-card round-trip, and drives the "Dispatch fix" affordance.
	MR *GroupRunMR `json:"mr,omitempty"`

	// CIFixAttempts is how many console-dispatched fix runs have already targeted
	// this work item's MR (counted from the agentops.dev/ci-fix-attempt
	// annotation). Surfaced so the card can show "retry N/budget" and the UI can
	// block further auto-dispatch once the budget is exhausted.
	CIFixAttempts int `json:"ciFixAttempts,omitempty"`
}

// GroupRunMR is the merge-request + CI slice attached to a run join. It collapses
// the MR ↔ pipeline ↔ job relationship the board needs into one compact object
// (the report's "MR↔pipeline join in the graph" gap).
type GroupRunMR struct {
	IID            int    `json:"iid"`
	ProjectID      int    `json:"projectID"`
	Title          string `json:"title,omitempty"`
	State          string `json:"state,omitempty"` // opened | merged | closed | locked
	WebURL         string `json:"webURL,omitempty"`
	SourceBranch   string `json:"sourceBranch,omitempty"`
	TargetBranch   string `json:"targetBranch,omitempty"`
	Draft          bool   `json:"draft,omitempty"`
	HasConflicts   bool   `json:"hasConflicts,omitempty"`
	DetailedStatus string `json:"detailedMergeStatus,omitempty"`

	// CI head-pipeline state (from the MR's head_pipeline). PipelineStatus is the
	// single signal the card's CI badge renders: success|failed|running|…
	PipelineID     int    `json:"pipelineID,omitempty"`
	PipelineStatus string `json:"pipelineStatus,omitempty"`
	PipelineWebURL string `json:"pipelineWebURL,omitempty"`
}

// GroupRuns returns the run↔card join surface for the workspace. It resolves the
// gitlab-group integration (for route coherence + auth) but the joins it returns
// are derived from cluster AgentRuns carrying the bridge's gitlab-iid annotation.
// Entries are deduplicated by (project, iid), keeping the most-recently-created
// run for each work item.
//
// It additionally joins the delivery edge: each work item's live merge request
// and its head-pipeline CI status (matched server-side on source_branch == the
// run's feature branch), and the count of console-dispatched CI-fix runs already
// spent on that MR (for the retry-budget guardrail). One extra group-wide MR
// fetch backs the whole board — no per-card round-trips.
// GET .../integrations/{ns}/{intgName}/group/runs
func (h *Handlers) GroupRuns(w http.ResponseWriter, r *http.Request) {
	// Resolve the workspace (group OR single project) for auth + MR-index scope.
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return
	}

	runs, err := h.k8s.ListAgentRuns(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agent runs: %s", err)
		return
	}

	// Tally console-dispatched CI-fix runs per MR iid so the board can show
	// "retry N/budget" and block further auto-dispatch once spent.
	fixAttemptsByMR := make(map[string]int)
	for i := range runs.Items {
		if mr := runs.Items[i].GetAnnotations()[annGitlabMR]; mr != "" {
			fixAttemptsByMR[mr]++
		}
	}

	// Dedup by composite key, keeping the newest run per work item.
	best := make(map[string]GroupRunJoin)
	for i := range runs.Items {
		run := &runs.Items[i]
		ann := run.GetAnnotations()
		iid := ann[annGitlabIID]
		project := ann[annGitlabProject]
		target := ann[annGitlabTarget]
		trigger := ann[annGitlabTrigger]

		// Fallback join for runs that carry no explicit gitlab-iid annotation
		// (e.g. older runs predating header-propagated delegation): if the run
		// has a git workspace whose feature branch follows the bridge's
		// deterministic `agent/issue-<iid>` convention, recover the iid from it.
		// Branches that don't match (e.g. PM-authored `feature/...`) are left
		// unjoined rather than guessed — the runtime now stamps the annotation
		// directly, so this is only a best-effort backstop.
		if iid == "" {
			if g := run.Spec.Git; g != nil {
				if m := issueBranchRe.FindStringSubmatch(g.Branch); m != nil {
					iid = m[1]
				}
			}
		}
		if iid == "" {
			continue // not a gitlab-joined run and not recoverable
		}
		created := run.GetCreationTimestamp().Format("2006-01-02T15:04:05Z07:00")

		key := project + "#" + iid
		// Keep the most-recently created run for this work item.
		if existing, ok := best[key]; ok && existing.Created >= created {
			continue
		}

		j := GroupRunJoin{
			IID:        iid,
			Project:    project,
			Target:     target,
			Trigger:    trigger,
			Run:        run.GetName(),
			Namespace:  run.GetNamespace(),
			AgentRef:   run.Spec.AgentRef,
			Phase:      string(run.Status.Phase),
			Created:    created,
			TraceID:    run.Status.TraceID,
			ToolCalls:  run.Status.ToolCalls,
			TokensUsed: run.Status.TokensUsed,
			Model:      run.Status.Model,
		}
		if run.Spec.Git != nil {
			j.Branch = run.Spec.Git.Branch
		}
		if oc := run.Status.Outcome; oc != nil {
			j.Intent = string(oc.Intent)
			j.Summary = oc.Summary
			for _, a := range oc.Artifacts {
				j.Artifacts = append(j.Artifacts, GroupRunArtifact{
					Kind: a.Kind, URL: a.URL, Ref: a.Ref, Title: a.Title,
				})
			}
		}
		best[key] = j
	}

	// ── Delivery edge: join each work item to its live MR + CI status ─────────
	// One group-wide MR fetch (open + merged) backs the whole board. We index the
	// MRs by source branch and by the iids of issues they will close, so a card
	// can be matched either by the run's feature branch (the common path) or by
	// the issue→MR closing reference (when the agent opened the MR on a different
	// branch). Best-effort: a GitLab hiccup just omits the mr edge.
	branchMRs := h.fetchGroupMRIndex(r.Context(), ws)

	out := make([]GroupRunJoin, 0, len(best))
	for _, j := range best {
		if mr := matchMRForJoin(j, branchMRs); mr != nil {
			j.MR = mr
			j.CIFixAttempts = fixAttemptsByMR[fmt.Sprintf("%d", mr.IID)]
		}
		out = append(out, j)
	}

	// The group-level merge_requests list does NOT populate head_pipeline (only
	// the single-MR GET does), so the branch index can't carry CI status. Fill it
	// in per attached MR via the MR pipelines endpoint — concurrency-capped, and
	// only for the (small) set of MRs that actually have a joined run.
	h.enrichMRPipelines(r.Context(), ws.token, ws.baseURL, out)

	writeJSON(w, http.StatusOK, out)
}

// enrichMRPipelines fetches the latest pipeline status for each join's attached
// MR (the group list omits head_pipeline). Mutates out in place. Best-effort:
// an MR whose pipeline can't be fetched keeps an empty PipelineStatus.
func (h *Handlers) enrichMRPipelines(ctx context.Context, token, baseURL string, out []GroupRunJoin) {
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for i := range out {
		mr := out[i].MR
		if mr == nil || mr.PipelineStatus != "" {
			continue
		}
		wg.Add(1)
		go func(mr *GroupRunMR) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var pipes []glPipelineLite
			if err := gitlabGetJSON(ctx, token, baseURL,
				fmt.Sprintf("/api/v4/projects/%d/merge_requests/%d/pipelines?per_page=1", mr.ProjectID, mr.IID),
				&pipes); err == nil && len(pipes) > 0 {
				mr.PipelineID = pipes[0].ID
				mr.PipelineStatus = pipes[0].Status
				mr.PipelineWebURL = pipes[0].WebURL
			}
		}(mr)
	}
	wg.Wait()
}

// glGroupMRLite is the trimmed group merge-request shape used to build the
// delivery-edge index (branch → MR + head-pipeline CI status).
type glGroupMRLite struct {
	IID                 int      `json:"iid"`
	ProjectID           int      `json:"project_id"`
	Title               string   `json:"title"`
	State               string   `json:"state"`
	WebURL              string   `json:"web_url"`
	SourceBranch        string   `json:"source_branch"`
	TargetBranch        string   `json:"target_branch"`
	Draft               bool     `json:"draft"`
	HasConflicts        bool     `json:"has_conflicts"`
	DetailedMergeStatus string   `json:"detailed_merge_status"`
	Labels              []string `json:"labels"`
	HeadPipeline        *struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
		WebURL string `json:"web_url"`
	} `json:"head_pipeline"`
}

func (m *glGroupMRLite) toGroupRunMR() *GroupRunMR {
	out := &GroupRunMR{
		IID:            m.IID,
		ProjectID:      m.ProjectID,
		Title:          m.Title,
		State:          m.State,
		WebURL:         m.WebURL,
		SourceBranch:   m.SourceBranch,
		TargetBranch:   m.TargetBranch,
		Draft:          m.Draft,
		HasConflicts:   m.HasConflicts,
		DetailedStatus: m.DetailedMergeStatus,
	}
	if m.HeadPipeline != nil {
		out.PipelineID = m.HeadPipeline.ID
		out.PipelineStatus = m.HeadPipeline.Status
		out.PipelineWebURL = m.HeadPipeline.WebURL
	}
	return out
}

// groupMRIndex holds the merge requests in a group keyed for join lookup.
type groupMRIndex struct {
	// byBranch maps "<projectID>@<sourceBranch>" → MR. Prefer an opened MR over a
	// merged/closed one for the same branch (a reopened fix branch).
	byBranch map[string]*glGroupMRLite
}

// fetchGroupMRIndex fetches the workspace's opened+merged MRs once and indexes
// them by project+source_branch for the delivery-edge join. Group mode fans out
// across the group; single-project mode lists just that project's MRs.
// Best-effort: returns an empty index (never an error) so a GitLab outage
// degrades to "no CI edge" rather than failing the whole board.
func (h *Handlers) fetchGroupMRIndex(ctx context.Context, ws workspaceTarget) *groupMRIndex {
	idx := &groupMRIndex{byBranch: make(map[string]*glGroupMRLite)}
	// scope=all + opened first, then merged, so an opened MR wins the branch key.
	for _, state := range []string{"opened", "merged"} {
		var path string
		if ws.isGroup {
			path = fmt.Sprintf("/api/v4/groups/%s/merge_requests?scope=all&state=%s&per_page=100&order_by=updated_at&sort=desc", ws.group, state)
		} else {
			path = fmt.Sprintf("/api/v4/projects/%s/merge_requests?state=%s&per_page=100&order_by=updated_at&sort=desc", url.PathEscape(ws.projectPath), state)
		}
		var mrs []glGroupMRLite
		if err := gitlabGetJSON(ctx, ws.token, ws.baseURL, path, &mrs); err != nil {
			continue
		}
		for i := range mrs {
			m := &mrs[i]
			if m.SourceBranch == "" {
				continue
			}
			bkey := fmt.Sprintf("%d@%s", m.ProjectID, m.SourceBranch)
			if _, exists := idx.byBranch[bkey]; !exists {
				idx.byBranch[bkey] = m
			}
		}
	}
	return idx
}

// matchMRForJoin resolves the live MR for a run join using the run's feature
// branch (the deterministic, common case). The join carries the project as an
// annotation value (path or numeric id); the MR index is keyed by numeric
// project id, so we match on branch within whichever project the MR belongs to —
// the branch+iid pair is unique enough in practice for a single group's board.
func matchMRForJoin(j GroupRunJoin, idx *groupMRIndex) *GroupRunMR {
	if idx == nil || j.Branch == "" {
		return nil
	}
	for _, m := range idx.byBranch {
		if m.SourceBranch == j.Branch {
			return m.toGroupRunMR()
		}
	}
	return nil
}

// ── DevOps enrichment: group milestones ──────────────────────────────────────

// GroupMilestones lists the workspace's milestones (delivery planning surface).
// GET .../group/milestones?state=active
func (h *Handlers) GroupMilestones(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return
	}
	var path string
	if ws.isGroup {
		path = fmt.Sprintf("/api/v4/groups/%s/milestones?per_page=50&include_ancestors=true", ws.group)
	} else {
		path = fmt.Sprintf("/api/v4/projects/%s/milestones?per_page=50", url.PathEscape(ws.projectPath))
	}
	path += forwardQuery(r, "state", "search", "page", "per_page")
	h.proxyGitLabAPI(w, r, ws.token, ws.baseURL, path)
}

// ── DevOps enrichment: project-scoped passthroughs ───────────────────────────
//
// These reuse the group token (the group member can read every project in the
// group) but address an individual project by numeric id from the URL path, so
// the workspace can drill into one project's CI history, commits, branches,
// languages, releases and contributors.

func (h *Handlers) groupProjectScope(w http.ResponseWriter, r *http.Request) (baseURL, projectID, token string, ok bool) {
	// Project-drill-down passthroughs only need baseURL+token; the project id
	// comes from the URL path, so they work for BOTH a group and a single-project
	// workspace. Resolve via resolveWorkspace (accepts either kind).
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return "", "", "", false
	}
	projectID = chi.URLParam(r, "projectID")
	if projectID == "" {
		writeError(w, http.StatusBadRequest, "missing project id")
		return "", "", "", false
	}
	return ws.baseURL, url.PathEscape(projectID), ws.token, true
}

// GroupProjectDetail returns one project with statistics (repo size, commit
// count, etc.) for the project detail panel.
// GET .../group/projects/{projectID}
func (h *Handlers) GroupProjectDetail(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPI(w, r, token, baseURL, fmt.Sprintf("/api/v4/projects/%s?statistics=true&license=true", pid))
}

// GroupProjectPipelines lists a project's recent pipelines (CI history).
// GET .../group/projects/{projectID}/pipelines?ref=&status=
func (h *Handlers) GroupProjectPipelines(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	path := fmt.Sprintf("/api/v4/projects/%s/pipelines?per_page=20&order_by=id&sort=desc", pid)
	path += forwardQuery(r, "ref", "status", "source", "page", "per_page")
	h.proxyGitLabAPI(w, r, token, baseURL, path)
}

// GroupProjectCommits lists a project's recent commits.
// GET .../group/projects/{projectID}/commits?ref_name=
func (h *Handlers) GroupProjectCommits(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	path := fmt.Sprintf("/api/v4/projects/%s/repository/commits?per_page=20", pid)
	path += forwardQuery(r, "ref_name", "since", "until", "page", "per_page", "path")
	h.proxyGitLabAPI(w, r, token, baseURL, path)
}

// GroupProjectBranches lists a project's branches.
// GET .../group/projects/{projectID}/branches
func (h *Handlers) GroupProjectBranches(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	path := fmt.Sprintf("/api/v4/projects/%s/repository/branches?per_page=100", pid)
	path += forwardQuery(r, "search", "page", "per_page")
	h.proxyGitLabAPI(w, r, token, baseURL, path)
}

// GroupProjectLanguages returns a project's language breakdown (percentages).
// GET .../group/projects/{projectID}/languages
func (h *Handlers) GroupProjectLanguages(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPI(w, r, token, baseURL, fmt.Sprintf("/api/v4/projects/%s/languages", pid))
}

// GroupProjectReleases lists a project's releases.
// GET .../group/projects/{projectID}/releases
func (h *Handlers) GroupProjectReleases(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPI(w, r, token, baseURL, fmt.Sprintf("/api/v4/projects/%s/releases?per_page=10", pid))
}

// GroupProjectContributors lists a project's top contributors by commit count.
// GET .../group/projects/{projectID}/contributors
func (h *Handlers) GroupProjectContributors(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPI(w, r, token, baseURL, fmt.Sprintf("/api/v4/projects/%s/repository/contributors?per_page=25&order_by=commits&sort=desc", pid))
}

// GroupProjectIssue returns a single issue with full detail (description,
// assignees, milestone) for the work-item drawer.
// GET .../group/projects/{projectID}/issues/{iid}
func (h *Handlers) GroupProjectIssue(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	iid := url.PathEscape(chi.URLParam(r, "iid"))
	if iid == "" {
		writeError(w, http.StatusBadRequest, "missing issue iid")
		return
	}
	h.proxyGitLabAPI(w, r, token, baseURL, fmt.Sprintf("/api/v4/projects/%s/issues/%s", pid, iid))
}

// GroupProjectIssueNotes lists the discussion notes on an issue.
// GET .../group/projects/{projectID}/issues/{iid}/notes
func (h *Handlers) GroupProjectIssueNotes(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	iid := url.PathEscape(chi.URLParam(r, "iid"))
	if iid == "" {
		writeError(w, http.StatusBadRequest, "missing issue iid")
		return
	}
	path := fmt.Sprintf("/api/v4/projects/%s/issues/%s/notes?per_page=50&sort=asc&order_by=created_at", pid, iid)
	path += forwardQuery(r, "page", "per_page", "sort")
	h.proxyGitLabAPI(w, r, token, baseURL, path)
}

// GroupProjectCreateIssue creates a new issue on a project.
// POST .../group/projects/{projectID}/issues
// body: {"title":"...", "description":"...", "labels":"agent::planning"}
func (h *Handlers) GroupProjectCreateIssue(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodPost, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/issues", pid), r.Body)
}

// GroupProjectAddIssueNote posts a note to an issue. Used by the work-board gate
// to record review feedback ON THE ISSUE (where the re-fired PM reads it) when
// requesting changes. POST .../group/projects/{projectID}/issues/{iid}/notes
// body: {"body":"..."}
func (h *Handlers) GroupProjectAddIssueNote(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	iid := url.PathEscape(chi.URLParam(r, "iid"))
	if iid == "" {
		writeError(w, http.StatusBadRequest, "missing issue iid")
		return
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodPost, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/issues/%s/notes", pid, iid), r.Body)
}

// GroupProjectUpdateIssue updates an issue's description and/or title.
// PUT .../group/projects/{projectID}/issues/{iid}
// body: {"description":"...", "title":"..."} (any GitLab-accepted fields)
func (h *Handlers) GroupProjectUpdateIssue(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	iid := url.PathEscape(chi.URLParam(r, "iid"))
	if iid == "" {
		writeError(w, http.StatusBadRequest, "missing issue iid")
		return
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodPut, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/issues/%s", pid, iid), r.Body)
}

// GroupProjectIssueClosedBy lists the merge requests that will close an issue
// when merged (GitLab's "closed_by" relationship). This is the authoritative
// issue→MR link the work-board cockpit uses to resolve the deliverable for a
// card whose run didn't record the MR as an outcome artifact (branch names are
// not reliable — agents may open the MR on a branch other than the assigned
// one). GET .../group/projects/{projectID}/issues/{iid}/closed_by
func (h *Handlers) GroupProjectIssueClosedBy(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	iid := url.PathEscape(chi.URLParam(r, "iid"))
	if iid == "" {
		writeError(w, http.StatusBadRequest, "missing issue iid")
		return
	}
	h.proxyGitLabAPI(w, r, token, baseURL, fmt.Sprintf("/api/v4/projects/%s/issues/%s/closed_by", pid, iid))
}

// GroupProjectPipelineJobs lists the jobs (with stage) for one pipeline so the
// CI/CD view can drill from a pipeline into its stages and per-job status.
// GET .../group/projects/{projectID}/pipelines/{pipelineID}/jobs
func (h *Handlers) GroupProjectPipelineJobs(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	pipelineID := url.PathEscape(chi.URLParam(r, "pipelineID"))
	if pipelineID == "" {
		writeError(w, http.StatusBadRequest, "missing pipeline id")
		return
	}
	h.proxyGitLabAPI(w, r, token, baseURL, fmt.Sprintf("/api/v4/projects/%s/pipelines/%s/jobs?per_page=100", pid, pipelineID))
}

// GroupProjectJobTrace streams a job's raw log (plain text, capped at 1 MiB) so
// the CI/CD view can show why a job failed without leaving the console.
// GET .../group/projects/{projectID}/jobs/{jobID}/trace
func (h *Handlers) GroupProjectJobTrace(w http.ResponseWriter, r *http.Request) {
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}
	jobID := url.PathEscape(chi.URLParam(r, "jobID"))
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "missing job id")
		return
	}
	apiURL := strings.TrimRight(baseURL, "/") + fmt.Sprintf("/api/v4/projects/%s/jobs/%s/trace", pid, jobID)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, apiURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create request: %s", err)
		return
	}
	if token != "" {
		req.Header.Set("PRIVATE-TOKEN", token)
	}
	resp, err := gitlabHTTPClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "GitLab API unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 1<<20)) // cap at 1 MiB
}

// ── DevOps enrichment: group-wide CI/CD health (server-side fan-out) ──────────

// glProjectLite is the trimmed project shape the fan-out aggregators need.
type glProjectLite struct {
	ID                int    `json:"id"`
	Name              string `json:"name"`
	PathWithNamespace string `json:"path_with_namespace"`
	WebURL            string `json:"web_url"`
	DefaultBranch     string `json:"default_branch"`
	LastActivityAt    string `json:"last_activity_at"`
}

// glPipelineLite is the trimmed pipeline shape for the CI/CD health surface.
type glPipelineLite struct {
	ID        int    `json:"id"`
	IID       int    `json:"iid,omitempty"`
	Status    string `json:"status"`
	Ref       string `json:"ref,omitempty"`
	SHA       string `json:"sha,omitempty"`
	Source    string `json:"source,omitempty"`
	WebURL    string `json:"web_url,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

// GroupProjectPipelineHealth pairs a project with its latest pipeline.
type GroupProjectPipelineHealth struct {
	ProjectID     int             `json:"project_id"`
	ProjectName   string          `json:"project_name"`
	ProjectPath   string          `json:"project_path"`
	WebURL        string          `json:"web_url,omitempty"`
	DefaultBranch string          `json:"default_branch,omitempty"`
	Pipeline      *glPipelineLite `json:"pipeline"`
}

// GroupPipelines returns each project's most-recent pipeline — the CI/CD health
// backbone of the dashboard. Group mode fans out across every project; single-
// project mode reports just the one project.
// GET .../group/pipelines
func (h *Handlers) GroupPipelines(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.resolveWorkspace(w, r)
	if !ok {
		return
	}

	var projects []glProjectLite
	if ws.isGroup {
		if err := gitlabGetJSON(r.Context(), ws.token, ws.baseURL,
			fmt.Sprintf("/api/v4/groups/%s/projects?include_subgroups=true&with_shared=false&archived=false&order_by=last_activity_at&sort=desc&per_page=100", ws.group),
			&projects); err != nil {
			writeError(w, http.StatusBadGateway, "failed to list group projects: %s", err)
			return
		}
	} else {
		var p glProjectLite
		if err := gitlabGetJSON(r.Context(), ws.token, ws.baseURL,
			"/api/v4/projects/"+url.PathEscape(ws.projectPath), &p); err != nil {
			writeError(w, http.StatusBadGateway, "failed to fetch project: %s", err)
			return
		}
		projects = []glProjectLite{p}
	}

	out := make([]GroupProjectPipelineHealth, len(projects))
	sem := make(chan struct{}, 8) // cap fan-out concurrency
	var wg sync.WaitGroup
	for i := range projects {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			p := projects[i]
			row := GroupProjectPipelineHealth{
				ProjectID:     p.ID,
				ProjectName:   p.Name,
				ProjectPath:   p.PathWithNamespace,
				WebURL:        p.WebURL,
				DefaultBranch: p.DefaultBranch,
			}
			var pipes []glPipelineLite
			if err := gitlabGetJSON(r.Context(), ws.token, ws.baseURL,
				fmt.Sprintf("/api/v4/projects/%d/pipelines?per_page=1&order_by=id&sort=desc", p.ID),
				&pipes); err == nil && len(pipes) > 0 {
				row.Pipeline = &pipes[0]
			}
			out[i] = row
		}(i)
	}
	wg.Wait()

	// out is built parallel to the project list, which the API already returns
	// ordered by last_activity_at desc — so it is already activity-sorted.
	writeJSON(w, http.StatusOK, out)
}
