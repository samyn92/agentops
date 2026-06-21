// User-scoped workspace discovery via GitLab OIDC.
//
// The BFF queries GitLab with the user's OIDC token to discover accessible
// groups (with subgroups) and projects. The frontend renders this as a tree-
// style browser. Starred items are surfaced separately for quick access.
package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
)

// ── Response types ──

// WorkspaceGroup is a GitLab group the user has access to.
type WorkspaceGroup struct {
	ID          int              `json:"id"`
	Name        string           `json:"name"`
	FullPath    string           `json:"fullPath"`
	WebURL      string           `json:"webUrl"`
	AvatarURL   string           `json:"avatarUrl,omitempty"`
	Description string           `json:"description,omitempty"`
	ParentID    *int             `json:"parentId,omitempty"` // nil = top-level
	Subgroups   []WorkspaceGroup `json:"subgroups,omitempty"`
	Projects    []WorkspaceProject `json:"projects,omitempty"`
}

// WorkspaceProject is a GitLab project visible to the user.
type WorkspaceProject struct {
	ID                int      `json:"id"`
	Name              string   `json:"name"`
	Path              string   `json:"path"`
	PathWithNamespace string   `json:"pathWithNamespace"`
	WebURL            string   `json:"webUrl"`
	AvatarURL         string   `json:"avatarUrl,omitempty"`
	Description       string   `json:"description,omitempty"`
	DefaultBranch     string   `json:"defaultBranch,omitempty"`
	Visibility        string   `json:"visibility,omitempty"`
	LastActivityAt    string   `json:"lastActivityAt,omitempty"`
	StarCount         int      `json:"starCount"`
	ForksCount        int      `json:"forksCount"`
	OpenIssuesCount   int      `json:"openIssuesCount"`
	Topics            []string `json:"topics,omitempty"`
	Archived          bool     `json:"archived"`
	Starred           bool     `json:"starred"` // user has starred this project
	NamespaceKind     string   `json:"namespaceKind,omitempty"` // "group" or "user"
	NamespacePath     string   `json:"namespacePath,omitempty"` // parent group/user path
}

// WorkspacesResponse is the top-level response for GET /api/v1/workspaces.
type WorkspacesResponse struct {
	Groups   []WorkspaceGroup   `json:"groups"`
	Starred  []WorkspaceProject `json:"starred"`  // projects the user starred
	Projects []WorkspaceProject `json:"projects"` // standalone (outside listed groups)
}

// ── GitLab API response shapes ──

type glGroupFull struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	FullPath    string `json:"full_path"`
	WebURL      string `json:"web_url"`
	AvatarURL   string `json:"avatar_url"`
	Description string `json:"description"`
	ParentID    *int   `json:"parent_id"`
}

type glProjectFull struct {
	ID                int      `json:"id"`
	Name              string   `json:"name"`
	Path              string   `json:"path"`
	PathWithNamespace string   `json:"path_with_namespace"`
	WebURL            string   `json:"web_url"`
	AvatarURL         string   `json:"avatar_url"`
	Description       string   `json:"description"`
	DefaultBranch     string   `json:"default_branch"`
	Visibility        string   `json:"visibility"`
	LastActivityAt    string   `json:"last_activity_at"`
	StarCount         int      `json:"star_count"`
	ForksCount        int      `json:"forks_count"`
	OpenIssuesCount   int      `json:"open_issues_count"`
	Topics            []string `json:"topics"`
	Archived          bool     `json:"archived"`
	Namespace         struct {
		Kind     string `json:"kind"`
		FullPath string `json:"full_path"`
	} `json:"namespace"`
}

// ListWorkspaces returns the user's GitLab groups (with subgroups + their
// projects inlined), starred projects, and standalone projects not belonging
// to any listed group. GET /api/v1/workspaces
func (h *Handlers) ListWorkspaces(w http.ResponseWriter, r *http.Request) {
	tok := h.userToken(r)
	if tok == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	baseURL := gitlabBaseURL()
	var (
		groups       []glGroupFull
		projects     []glProjectFull
		starred      []glProjectFull
		groupErr     error
		projErr      error
		starErr      error
		wg           sync.WaitGroup
	)

	// Fetch groups, projects, and starred in parallel.
	wg.Add(3)
	go func() {
		defer wg.Done()
		groupErr = gitlabGetJSON(r.Context(), tok, baseURL,
			"/api/v4/groups?min_access_level=20&per_page=100&order_by=name&sort=asc&with_custom_attributes=false", &groups)
	}()
	go func() {
		defer wg.Done()
		projErr = gitlabGetJSON(r.Context(), tok, baseURL,
			"/api/v4/projects?min_access_level=20&membership=true&per_page=100&order_by=last_activity_at&sort=desc&with_custom_attributes=false", &projects)
	}()
	go func() {
		defer wg.Done()
		starErr = gitlabGetJSON(r.Context(), tok, baseURL,
			"/api/v4/projects?starred=true&per_page=50&order_by=last_activity_at&sort=desc", &starred)
	}()
	wg.Wait()

	if groupErr != nil {
		slog.Warn("workspace discovery: groups fetch failed", "error", groupErr)
	}
	if projErr != nil {
		slog.Warn("workspace discovery: projects fetch failed", "error", projErr)
	}
	if starErr != nil {
		slog.Debug("workspace discovery: starred fetch failed", "error", starErr)
	}
	if groupErr != nil && projErr != nil {
		writeError(w, http.StatusBadGateway, "failed to discover workspaces: groups=%s, projects=%s", groupErr, projErr)
		return
	}

	// Build starred project ID set for marking projects.
	starredIDs := make(map[int]bool, len(starred))
	for _, s := range starred {
		starredIDs[s.ID] = true
	}

	// Convert projects to response type.
	convertProject := func(p glProjectFull) WorkspaceProject {
		return WorkspaceProject{
			ID:                p.ID,
			Name:              p.Name,
			Path:              p.Path,
			PathWithNamespace: p.PathWithNamespace,
			WebURL:            p.WebURL,
			AvatarURL:         p.AvatarURL,
			Description:       p.Description,
			DefaultBranch:     p.DefaultBranch,
			Visibility:        p.Visibility,
			LastActivityAt:    p.LastActivityAt,
			StarCount:         p.StarCount,
			ForksCount:        p.ForksCount,
			OpenIssuesCount:   p.OpenIssuesCount,
			Topics:            p.Topics,
			Archived:          p.Archived,
			Starred:           starredIDs[p.ID],
			NamespaceKind:     p.Namespace.Kind,
			NamespacePath:     p.Namespace.FullPath,
		}
	}

	// Build group hierarchy: map groups by full_path for tree construction.
	groupByPath := make(map[string]*WorkspaceGroup, len(groups))
	topGroups := make([]WorkspaceGroup, 0)

	// First pass: create all group nodes.
	for _, g := range groups {
		wg := WorkspaceGroup{
			ID:          g.ID,
			Name:        g.Name,
			FullPath:    g.FullPath,
			WebURL:      g.WebURL,
			AvatarURL:   g.AvatarURL,
			Description: g.Description,
			ParentID:    g.ParentID,
		}
		groupByPath[g.FullPath] = &wg
	}

	// Second pass: build parent-child relationships.
	for path, g := range groupByPath {
		parentPath := parentGroupPath(path)
		if parent, ok := groupByPath[parentPath]; ok {
			parent.Subgroups = append(parent.Subgroups, *g)
		} else {
			topGroups = append(topGroups, *g)
		}
	}

	// Sort top-level groups by name.
	sort.Slice(topGroups, func(i, j int) bool {
		return topGroups[i].Name < topGroups[j].Name
	})

	// Sort subgroups recursively.
	for i := range topGroups {
		sortSubgroups(&topGroups[i])
	}

	// Assign projects to their groups.
	groupPathSet := make(map[string]bool, len(groups))
	for _, g := range groups {
		groupPathSet[g.FullPath] = true
	}

	standaloneProjects := make([]WorkspaceProject, 0)
	for _, p := range projects {
		wp := convertProject(p)
		if p.Namespace.Kind == "group" && groupPathSet[p.Namespace.FullPath] {
			// This project belongs to a listed group — attach it.
			if g, ok := groupByPath[p.Namespace.FullPath]; ok {
				g.Projects = append(g.Projects, wp)
			}
		} else {
			standaloneProjects = append(standaloneProjects, wp)
		}
	}

	// Rebuild top-level groups from the pointers (since we modified them).
	finalGroups := make([]WorkspaceGroup, 0, len(topGroups))
	for _, tg := range topGroups {
		rebuilt := rebuildGroup(tg.FullPath, groupByPath)
		finalGroups = append(finalGroups, rebuilt)
	}

	// Build starred response.
	starredResp := make([]WorkspaceProject, 0, len(starred))
	for _, s := range starred {
		starredResp = append(starredResp, convertProject(s))
	}

	writeJSON(w, http.StatusOK, WorkspacesResponse{
		Groups:   finalGroups,
		Starred:  starredResp,
		Projects: standaloneProjects,
	})
}

// rebuildGroup reconstructs a group from the map (since projects were added to
// the pointer map entries after the tree was initially built).
func rebuildGroup(path string, byPath map[string]*WorkspaceGroup) WorkspaceGroup {
	g := byPath[path]
	if g == nil {
		return WorkspaceGroup{}
	}
	result := *g
	// Rebuild subgroups recursively.
	rebuilt := make([]WorkspaceGroup, 0, len(result.Subgroups))
	for _, sg := range result.Subgroups {
		rebuilt = append(rebuilt, rebuildGroup(sg.FullPath, byPath))
	}
	result.Subgroups = rebuilt
	return result
}

// sortSubgroups sorts subgroups alphabetically, recursively.
func sortSubgroups(g *WorkspaceGroup) {
	sort.Slice(g.Subgroups, func(i, j int) bool {
		return g.Subgroups[i].Name < g.Subgroups[j].Name
	})
	for i := range g.Subgroups {
		sortSubgroups(&g.Subgroups[i])
	}
}

// parentGroupPath returns the parent group path from a full group path.
// e.g. "org/team/subteam" → "org/team"
func parentGroupPath(fullPath string) string {
	idx := strings.LastIndex(fullPath, "/")
	if idx < 0 {
		return ""
	}
	return fullPath[:idx]
}

// ── Dispatch Authorization ──

// verifyProjectAccess verifies the user has Developer+ access on a target
// project before allowing agent dispatch.
func (h *Handlers) verifyProjectAccess(r *http.Request, projectID string) error {
	tok := h.userToken(r)
	if tok == "" {
		return fmt.Errorf("authentication required")
	}

	baseURL := gitlabBaseURL()

	type memberInfo struct {
		AccessLevel int `json:"access_level"`
	}

	var members []memberInfo
	path := fmt.Sprintf("/api/v4/projects/%s/members/all?user_ids=self", projectID)
	if err := gitlabGetJSON(r.Context(), tok, baseURL, path, &members); err != nil {
		slog.Debug("members/all check failed, allowing dispatch", "project", projectID, "error", err)
		return nil
	}

	if len(members) == 0 {
		return fmt.Errorf("you don't have access to project %s", projectID)
	}
	if members[0].AccessLevel < 30 {
		return fmt.Errorf("you need Developer+ access (level 30+) to dispatch agents on project %s, you have level %d",
			projectID, members[0].AccessLevel)
	}
	return nil
}
