// Work-board handlers — GitLab-project write/read proxies backing the agent
// work board: merge-request detail, diff, notes, pipelines, the human merge
// gate, and issue label moves. All require a gitlab-project Integration.
package handlers

import (
	"fmt"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	agentsv1alpha1 "github.com/samyn92/agentops/api/v1alpha1"
)

// boardTarget resolves the GitLab Integration + token, the target project, and
// the numeric {iid} URL param for a board request. It supports two integration
// shapes:
//
//   - gitlab-project: the project is fixed (Spec.GitLab.Project).
//   - gitlab-group:   the group holds a broad token but a single card belongs to
//     one project, so the caller MUST pass ?project=<id-or-path> (typically the
//     numeric project_id from a group-aggregated issue/MR). This is what lets
//     every board action work against the group-wide board.
//
// It writes an error response and returns ok=false on any mismatch or an
// invalid iid.
func (h *Handlers) boardTarget(w http.ResponseWriter, r *http.Request) (baseURL, projectID, iid, token string, ok bool) {
	intg, botTok, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return "", "", "", "", false
	}

	// Prefer user's OIDC token over bot token (multi-tenant model).
	tok := h.userToken(r)
	if tok == "" {
		tok = botTok
	}

	switch {
	case intg.Spec.Kind == agentsv1alpha1.IntegrationKindGitLabProject && intg.Spec.GitLab != nil:
		baseURL = intg.Spec.GitLab.BaseURL
		projectID = url.PathEscape(intg.Spec.GitLab.Project)
	case intg.Spec.Kind == agentsv1alpha1.IntegrationKindGitLabGroup && intg.Spec.GitLabGroup != nil:
		proj := r.URL.Query().Get("project")
		if proj == "" {
			writeError(w, http.StatusBadRequest, "group integration requires a ?project=<id> query param to target a card's project")
			return "", "", "", "", false
		}
		baseURL = intg.Spec.GitLabGroup.BaseURL
		projectID = url.PathEscape(proj)
	default:
		writeError(w, http.StatusBadRequest, "work board requires a gitlab-project or gitlab-group integration, got %s", intg.Spec.Kind)
		return "", "", "", "", false
	}

	id := chi.URLParam(r, "iid")
	if !isNumeric(id) {
		writeError(w, http.StatusBadRequest, "invalid iid %q", id)
		return "", "", "", "", false
	}

	return baseURL, projectID, id, tok, true
}

// GetMergeRequest returns a single merge request.
// GET .../integrations/{intgName}/mergerequests/{iid}
func (h *Handlers) GetMergeRequest(w http.ResponseWriter, r *http.Request) {
	baseURL, projectID, iid, token, ok := h.boardTarget(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodGet, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/merge_requests/%s", projectID, iid), nil)
}

// GetMergeRequestChanges returns the diff/changes for a merge request.
// GET .../integrations/{intgName}/mergerequests/{iid}/changes
func (h *Handlers) GetMergeRequestChanges(w http.ResponseWriter, r *http.Request) {
	baseURL, projectID, iid, token, ok := h.boardTarget(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodGet, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/merge_requests/%s/changes", projectID, iid), nil)
}

// ListMergeRequestNotes returns the discussion notes for a merge request.
// GET .../integrations/{intgName}/mergerequests/{iid}/notes
func (h *Handlers) ListMergeRequestNotes(w http.ResponseWriter, r *http.Request) {
	baseURL, projectID, iid, token, ok := h.boardTarget(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodGet, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/merge_requests/%s/notes?sort=asc&order_by=created_at&per_page=100", projectID, iid), nil)
}

// CreateMergeRequestNote posts a new note to a merge request.
// POST .../integrations/{intgName}/mergerequests/{iid}/notes  body: {"body":"..."}
// Uses the human's OIDC token when available so the note shows as "human posted".
func (h *Handlers) CreateMergeRequestNote(w http.ResponseWriter, r *http.Request) {
	baseURL, projectID, iid, token, ok := h.boardTarget(w, r)
	if !ok {
		return
	}
	if userTok := h.userTokenOrFallback(w, r); userTok != "" {
		token = userTok
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodPost, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/merge_requests/%s/notes", projectID, iid), r.Body)
}

// ListMergeRequestPipelines returns CI pipelines for a merge request.
// GET .../integrations/{intgName}/mergerequests/{iid}/pipelines
func (h *Handlers) ListMergeRequestPipelines(w http.ResponseWriter, r *http.Request) {
	baseURL, projectID, iid, token, ok := h.boardTarget(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodGet, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/merge_requests/%s/pipelines", projectID, iid), nil)
}

// MergeMergeRequest performs the human merge gate.
// PUT .../integrations/{intgName}/mergerequests/{iid}/merge
// Optional JSON body forwarded to GitLab (merge_commit_message,
// should_remove_source_branch, etc.).
//
// When OIDC is enabled, the merge is performed with the HUMAN's GitLab access
// token (from the session), so GitLab records the merge under the operator's
// identity — not the agent bot's. Falls back to the bot token if the user is
// not logged in (backward-compatible when auth is disabled).
func (h *Handlers) MergeMergeRequest(w http.ResponseWriter, r *http.Request) {
	baseURL, projectID, iid, token, ok := h.boardTarget(w, r)
	if !ok {
		return
	}
	// Prefer the human's OIDC token for the merge action.
	if userTok := h.userTokenOrFallback(w, r); userTok != "" {
		token = userTok
	}
	var body = r.Body
	if r.ContentLength == 0 {
		body = nil
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodPut, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/merge_requests/%s/merge", projectID, iid), body)
}

// UpdateIssueLabels moves an issue between work-board columns by updating its
// labels. PUT .../integrations/{intgName}/issues/{iid}/labels
// body: {"labels":"a,b"} or {"add_labels":"x","remove_labels":"y"}.
func (h *Handlers) UpdateIssueLabels(w http.ResponseWriter, r *http.Request) {
	baseURL, projectID, iid, token, ok := h.boardTarget(w, r)
	if !ok {
		return
	}
	h.proxyGitLabAPIWithMethod(w, r, http.MethodPut, token, baseURL,
		fmt.Sprintf("/api/v4/projects/%s/issues/%s", projectID, iid), r.Body)
}

// isNumeric reports whether s is a non-empty string of ASCII digits.
func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
