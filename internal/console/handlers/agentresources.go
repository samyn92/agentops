// Integration handlers — list/get integrations + proxy to GitHub/GitLab APIs for browsing.
package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	agentsv1alpha1 "github.com/samyn92/agentops/api/v1alpha1"
)

// ── Integration CRUD ──

func (h *Handlers) ListIntegrations(w http.ResponseWriter, r *http.Request) {
	integrations, err := h.k8s.ListIntegrations(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list integrations: %s", err)
		return
	}
	writeJSON(w, http.StatusOK, integrations.Items)
}

func (h *Handlers) GetIntegration(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	res, err := h.k8s.GetIntegration(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "integration not found: %s", err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ListIntegrationsForAgent returns the integrations bound to a specific agent.
func (h *Handlers) ListIntegrationsForAgent(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	integrations, err := h.k8s.ListIntegrationsForAgent(r.Context(), agent)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list integrations for agent: %s", err)
		return
	}

	// Build response with binding metadata
	type integrationWithBinding struct {
		Name        string `json:"name"`
		Namespace   string `json:"namespace"`
		Kind        string `json:"kind"`
		DisplayName string `json:"displayName"`
		Description string `json:"description,omitempty"`
		Phase       string `json:"phase"`
		ReadOnly    bool   `json:"readOnly"`
		AutoContext bool   `json:"autoContext"`
		// Kind-specific config (flattened for frontend)
		GitHub         *agentsv1alpha1.GitHubResourceConfig      `json:"github,omitempty"`
		GitHubOrg      *agentsv1alpha1.GitHubOrgResourceConfig   `json:"githubOrg,omitempty"`
		GitLab         *agentsv1alpha1.GitLabResourceConfig      `json:"gitlab,omitempty"`
		GitLabGroup    *agentsv1alpha1.GitLabGroupResourceConfig `json:"gitlabGroup,omitempty"`
		HasCredentials bool                                      `json:"hasCredentials"`
	}

	// Build binding lookup
	bindingMap := make(map[string]agentsv1alpha1.IntegrationBinding, len(agent.Spec.Integrations))
	for _, b := range agent.Spec.Integrations {
		bindingMap[b.Name] = b
	}

	resp := make([]integrationWithBinding, 0, len(integrations))
	for _, intg := range integrations {
		binding := bindingMap[intg.Name]
		entry := integrationWithBinding{
			Name:           intg.Name,
			Namespace:      intg.Namespace,
			Kind:           string(intg.Spec.Kind),
			DisplayName:    intg.Spec.DisplayName,
			Description:    intg.Spec.Description,
			Phase:          string(intg.Status.Phase),
			ReadOnly:       binding.ReadOnly,
			AutoContext:    binding.AutoContext,
			GitHub:         intg.Spec.GitHub,
			GitHubOrg:      intg.Spec.GitHubOrg,
			GitLab:         intg.Spec.GitLab,
			GitLabGroup:    intg.Spec.GitLabGroup,
			HasCredentials: intg.Spec.Credentials != nil,
		}
		resp = append(resp, entry)
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── Git Forge Proxy Endpoints ──
// These proxy requests to GitHub/GitLab APIs using credentials from the Integration's secret.

// BrowseResourceFiles proxies a file/tree browse request.
// GET /agents/{ns}/{name}/integrations/{intgName}/files?path=&ref=
func (h *Handlers) BrowseResourceFiles(w http.ResponseWriter, r *http.Request) {
	intg, token, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return
	}

	path := r.URL.Query().Get("path")
	ref := r.URL.Query().Get("ref")

	switch intg.Spec.Kind {
	case agentsv1alpha1.IntegrationKindGitHubRepo:
		h.proxyGitHubAPI(w, r, token, intg.Spec.GitHub, fmt.Sprintf(
			"/repos/%s/%s/contents/%s?ref=%s",
			intg.Spec.GitHub.Owner, intg.Spec.GitHub.Repo,
			url.PathEscape(path), url.QueryEscape(refOrDefault(ref, intg.Spec.GitHub.DefaultBranch)),
		))
	case agentsv1alpha1.IntegrationKindGitLabProject:
		projectID := url.PathEscape(intg.Spec.GitLab.Project)
		h.proxyGitLabAPI(w, r, token, intg.Spec.GitLab.BaseURL, fmt.Sprintf(
			"/api/v4/projects/%s/repository/tree?path=%s&ref=%s&per_page=100",
			projectID, url.QueryEscape(path), url.QueryEscape(refOrDefault(ref, intg.Spec.GitLab.DefaultBranch)),
		))
	default:
		writeError(w, http.StatusBadRequest, "file browsing not supported for kind %s", intg.Spec.Kind)
	}
}

// BrowseResourceFileContent returns the content of a specific file.
// GET /agents/{ns}/{name}/integrations/{intgName}/files/content?path=&ref=
func (h *Handlers) BrowseResourceFileContent(w http.ResponseWriter, r *http.Request) {
	intg, token, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return
	}

	path := r.URL.Query().Get("path")
	ref := r.URL.Query().Get("ref")

	switch intg.Spec.Kind {
	case agentsv1alpha1.IntegrationKindGitHubRepo:
		h.proxyGitHubAPI(w, r, token, intg.Spec.GitHub, fmt.Sprintf(
			"/repos/%s/%s/contents/%s?ref=%s",
			intg.Spec.GitHub.Owner, intg.Spec.GitHub.Repo,
			url.PathEscape(path), url.QueryEscape(refOrDefault(ref, intg.Spec.GitHub.DefaultBranch)),
		))
	case agentsv1alpha1.IntegrationKindGitLabProject:
		projectID := url.PathEscape(intg.Spec.GitLab.Project)
		h.proxyGitLabAPI(w, r, token, intg.Spec.GitLab.BaseURL, fmt.Sprintf(
			"/api/v4/projects/%s/repository/files/%s?ref=%s",
			projectID, url.PathEscape(path), url.QueryEscape(refOrDefault(ref, intg.Spec.GitLab.DefaultBranch)),
		))
	default:
		writeError(w, http.StatusBadRequest, "file content not supported for kind %s", intg.Spec.Kind)
	}
}

// BrowseResourceCommits proxies commit listing.
// GET /agents/{ns}/{name}/integrations/{intgName}/commits?ref=&path=&page=
func (h *Handlers) BrowseResourceCommits(w http.ResponseWriter, r *http.Request) {
	intg, token, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return
	}

	ref := r.URL.Query().Get("ref")
	path := r.URL.Query().Get("path")
	page := r.URL.Query().Get("page")
	if page == "" {
		page = "1"
	}

	switch intg.Spec.Kind {
	case agentsv1alpha1.IntegrationKindGitHubRepo:
		q := fmt.Sprintf("sha=%s&per_page=30&page=%s",
			url.QueryEscape(refOrDefault(ref, intg.Spec.GitHub.DefaultBranch)), page)
		if path != "" {
			q += "&path=" + url.QueryEscape(path)
		}
		h.proxyGitHubAPI(w, r, token, intg.Spec.GitHub, fmt.Sprintf(
			"/repos/%s/%s/commits?%s",
			intg.Spec.GitHub.Owner, intg.Spec.GitHub.Repo, q,
		))
	case agentsv1alpha1.IntegrationKindGitLabProject:
		projectID := url.PathEscape(intg.Spec.GitLab.Project)
		q := fmt.Sprintf("ref_name=%s&per_page=30&page=%s",
			url.QueryEscape(refOrDefault(ref, intg.Spec.GitLab.DefaultBranch)), page)
		if path != "" {
			q += "&path=" + url.QueryEscape(path)
		}
		h.proxyGitLabAPI(w, r, token, intg.Spec.GitLab.BaseURL, fmt.Sprintf(
			"/api/v4/projects/%s/repository/commits?%s",
			projectID, q,
		))
	default:
		writeError(w, http.StatusBadRequest, "commit browsing not supported for kind %s", intg.Spec.Kind)
	}
}

// BrowseResourceBranches proxies branch listing.
// GET /agents/{ns}/{name}/integrations/{intgName}/branches?page=
func (h *Handlers) BrowseResourceBranches(w http.ResponseWriter, r *http.Request) {
	intg, token, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return
	}

	page := r.URL.Query().Get("page")
	if page == "" {
		page = "1"
	}

	switch intg.Spec.Kind {
	case agentsv1alpha1.IntegrationKindGitHubRepo:
		h.proxyGitHubAPI(w, r, token, intg.Spec.GitHub, fmt.Sprintf(
			"/repos/%s/%s/branches?per_page=30&page=%s",
			intg.Spec.GitHub.Owner, intg.Spec.GitHub.Repo, page,
		))
	case agentsv1alpha1.IntegrationKindGitLabProject:
		projectID := url.PathEscape(intg.Spec.GitLab.Project)
		h.proxyGitLabAPI(w, r, token, intg.Spec.GitLab.BaseURL, fmt.Sprintf(
			"/api/v4/projects/%s/repository/branches?per_page=30&page=%s",
			projectID, page,
		))
	default:
		writeError(w, http.StatusBadRequest, "branch browsing not supported for kind %s", intg.Spec.Kind)
	}
}

// BrowseResourceMergeRequests proxies MR/PR listing.
// GET /agents/{ns}/{name}/integrations/{intgName}/mergerequests?state=&page=
func (h *Handlers) BrowseResourceMergeRequests(w http.ResponseWriter, r *http.Request) {
	intg, token, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return
	}

	state := r.URL.Query().Get("state")
	if state == "" {
		state = "open"
	}
	page := r.URL.Query().Get("page")
	if page == "" {
		page = "1"
	}

	switch intg.Spec.Kind {
	case agentsv1alpha1.IntegrationKindGitHubRepo:
		ghState := state
		if state == "merged" {
			ghState = "closed"
		}
		h.proxyGitHubAPI(w, r, token, intg.Spec.GitHub, fmt.Sprintf(
			"/repos/%s/%s/pulls?state=%s&per_page=30&page=%s&sort=updated&direction=desc",
			intg.Spec.GitHub.Owner, intg.Spec.GitHub.Repo, ghState, page,
		))
	case agentsv1alpha1.IntegrationKindGitLabProject:
		projectID := url.PathEscape(intg.Spec.GitLab.Project)
		glState := state
		if state == "open" {
			glState = "opened"
		}
		h.proxyGitLabAPI(w, r, token, intg.Spec.GitLab.BaseURL, fmt.Sprintf(
			"/api/v4/projects/%s/merge_requests?state=%s&per_page=30&page=%s&order_by=updated_at",
			projectID, glState, page,
		))
	default:
		writeError(w, http.StatusBadRequest, "merge request browsing not supported for kind %s", intg.Spec.Kind)
	}
}

// BrowseResourceIssues proxies issue listing.
// GET /agents/{ns}/{name}/integrations/{intgName}/issues?state=&page=
func (h *Handlers) BrowseResourceIssues(w http.ResponseWriter, r *http.Request) {
	intg, token, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return
	}

	state := r.URL.Query().Get("state")
	if state == "" {
		state = "open"
	}
	page := r.URL.Query().Get("page")
	if page == "" {
		page = "1"
	}
	// Optional label filter (used by the work board to populate columns).
	labels := r.URL.Query().Get("labels")

	switch intg.Spec.Kind {
	case agentsv1alpha1.IntegrationKindGitHubRepo:
		ghPath := fmt.Sprintf(
			"/repos/%s/%s/issues?state=%s&per_page=30&page=%s&sort=updated&direction=desc",
			intg.Spec.GitHub.Owner, intg.Spec.GitHub.Repo, state, page,
		)
		if labels != "" {
			ghPath += "&labels=" + url.QueryEscape(labels)
		}
		h.proxyGitHubAPI(w, r, token, intg.Spec.GitHub, ghPath)
	case agentsv1alpha1.IntegrationKindGitLabProject:
		projectID := url.PathEscape(intg.Spec.GitLab.Project)
		glState := state
		if state == "open" {
			glState = "opened"
		}
		glPath := fmt.Sprintf(
			"/api/v4/projects/%s/issues?state=%s&per_page=30&page=%s&order_by=updated_at",
			projectID, glState, page,
		)
		if labels != "" {
			glPath += "&labels=" + url.QueryEscape(labels)
		}
		h.proxyGitLabAPI(w, r, token, intg.Spec.GitLab.BaseURL, glPath)
	default:
		writeError(w, http.StatusBadRequest, "issue browsing not supported for kind %s", intg.Spec.Kind)
	}
}

// BrowseResourcePipelines proxies CI pipeline listing (GitLab only).
// GET /agents/{ns}/{name}/integrations/{intgName}/pipelines?ref=&page=
func (h *Handlers) BrowseResourcePipelines(w http.ResponseWriter, r *http.Request) {
	intg, token, err := h.resolveIntegrationAndToken(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return
	}

	ref := r.URL.Query().Get("ref")
	page := r.URL.Query().Get("page")
	if page == "" {
		page = "1"
	}

	switch intg.Spec.Kind {
	case agentsv1alpha1.IntegrationKindGitLabProject:
		projectID := url.PathEscape(intg.Spec.GitLab.Project)
		path := fmt.Sprintf(
			"/api/v4/projects/%s/pipelines?per_page=20&page=%s&order_by=id&sort=desc",
			projectID, page,
		)
		if ref != "" {
			path += "&ref=" + url.QueryEscape(ref)
		}
		h.proxyGitLabAPI(w, r, token, intg.Spec.GitLab.BaseURL, path)
	default:
		writeError(w, http.StatusBadRequest, "pipeline browsing not supported for kind %s", intg.Spec.Kind)
	}
}

// ── Helpers ──
// resolveIntegrationAndToken gets the Integration and its API token from the K8s secret.
func (h *Handlers) resolveIntegrationAndToken(r *http.Request) (*agentsv1alpha1.Integration, string, error) {
	ns := chi.URLParam(r, "ns")
	// Agent-scoped routes name the integration param "intgName"; the
	// non-agent-scoped group workspace routes (/integrations/{ns}/{name}/...)
	// name it "name". Accept either so both route trees share this resolver.
	intgName := chi.URLParam(r, "intgName")
	if intgName == "" {
		intgName = chi.URLParam(r, "name")
	}

	intg, err := h.k8s.GetIntegration(r.Context(), ns, intgName)
	if err != nil {
		return nil, "", fmt.Errorf("integration not found: %w", err)
	}

	if intg.Status.Phase != agentsv1alpha1.IntegrationPhaseReady {
		return nil, "", fmt.Errorf("integration %s is not ready (phase: %s)", intgName, intg.Status.Phase)
	}

	token, err := h.k8s.GetIntegrationCredentials(r.Context(), ns, intg)
	if err != nil {
		slog.Warn("no credentials for integration, proceeding without auth", "integration", intgName, "error", err)
		token = ""
	}

	return intg, token, nil
}

func (h *Handlers) proxyGitHubAPI(w http.ResponseWriter, r *http.Request, token string, cfg *agentsv1alpha1.GitHubResourceConfig, path string) {
	baseURL := "https://api.github.com"
	if cfg != nil && cfg.APIURL != "" {
		baseURL = strings.TrimRight(cfg.APIURL, "/")
	}

	apiURL := baseURL + path
	req, err := http.NewRequestWithContext(r.Context(), "GET", apiURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create request: %s", err)
		return
	}

	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "GitHub API unreachable: %s", err)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (h *Handlers) proxyGitLabAPI(w http.ResponseWriter, r *http.Request, token string, baseURL string, path string) {
	h.proxyGitLabAPIWithMethod(w, r, http.MethodGet, token, baseURL, path, nil)
}

// proxyGitLabAPIWithMethod proxies an arbitrary-method request to the GitLab
// API using the Integration's token. A non-nil body is forwarded as
// application/json. Used by the work-board for write actions (merge, notes,
// label moves) in addition to GET browsing.
func (h *Handlers) proxyGitLabAPIWithMethod(w http.ResponseWriter, r *http.Request, method, token, baseURL, path string, body io.Reader) {
	apiURL := strings.TrimRight(baseURL, "/") + path
	req, err := http.NewRequestWithContext(r.Context(), method, apiURL, body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create request: %s", err)
		return
	}

	if token != "" {
		setGitLabAuth(req, token, r.Context())
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "GitLab API unreachable: %s", err)
		return
	}
	defer resp.Body.Close()

	// Translate upstream 401/403 from GitLab to 502 so the frontend doesn't
	// confuse a GitLab token rejection with our own auth middleware's 401.
	status := resp.StatusCode
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		slog.Warn("GitLab API auth failure (upstream)", "status", status, "path", path, "body", string(respBody))
		writeError(w, http.StatusBadGateway, "GitLab API returned %d: %s", status, string(respBody))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	io.Copy(w, resp.Body)
}

func refOrDefault(ref, defaultBranch string) string {
	if ref != "" {
		return ref
	}
	if defaultBranch != "" {
		return defaultBranch
	}
	return "main"
}

// Suppress unused import warning for json (used in future enrichment)
var _ = json.Marshal
