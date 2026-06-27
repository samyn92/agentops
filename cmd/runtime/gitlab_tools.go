/*
Agent Runtime — Fantasy (Go)

Native GitLab tools. These replace the OCI-packaged mcp-gitlab server with
direct calls to the official GitLab Go SDK via the self-contained gitlab
package. Tools are auto-enabled when GITLAB_TOKEN is present (injected by the
operator from a bound gitlab-group / gitlab-project Integration). Write tools
are registered only when the client is read-write (GITLAB_READONLY != "true").
*/
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"charm.land/fantasy"
	"github.com/samyn92/agentops/cmd/runtime/gitlab"
)

// gitlabClient is the process-wide GitLab client, initialized in gitlabTools.
var gitlabClient *gitlab.Client

const maxGitLabBulkItems = 20

// jsonResponse marshals v to indented JSON as a tool text response.
func jsonResponse(v any) (fantasy.ToolResponse, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fantasy.NewTextErrorResponse(fmt.Sprintf("marshal result: %v", err)), nil
	}
	return fantasy.NewTextResponse(string(b)), nil
}

// glErr converts a client error into an appropriate tool response. Allow-list
// and read-only violations are surfaced as plain (non-Go) errors so the model
// understands the boundary rather than treating it as a transient failure.
func glErr(err error) (fantasy.ToolResponse, error) {
	return fantasy.NewTextErrorResponse(err.Error()), nil
}

// ── Read tools ──────────────────────────────────────────────────────────────

type glProjectInput struct {
	Project string `json:"project,omitempty" description:"Project path (group/repo) or numeric ID. Omit to use the agent's bound project."`
}

func newGitLabGetProjectTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_get_project",
		"Get GitLab project info (description, visibility, default branch, web URL).",
		func(_ context.Context, in glProjectInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			p, err := gitlabClient.GetProject(in.Project)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(p)
		})
}

type glListGroupProjectsInput struct {
	Group  string `json:"group,omitempty" description:"Group full path. Omit to use the agent's bound group."`
	Search string `json:"search,omitempty" description:"Optional name filter."`
}

func newGitLabListGroupProjectsTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_list_group_projects",
		"List projects within a GitLab group (includes subgroups). Filtered to the agent's allowed projects.",
		func(_ context.Context, in glListGroupProjectsInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			projects, err := gitlabClient.ListGroupProjects(in.Group, in.Search)
			if err != nil {
				return glErr(err)
			}
			out := make([]map[string]any, 0, len(projects))
			for _, p := range projects {
				out = append(out, map[string]any{
					"id":   p.ID,
					"path": p.PathWithNamespace,
					"name": p.Name,
					"url":  p.WebURL,
				})
			}
			return jsonResponse(out)
		})
}

type glSearchInput struct {
	Query string `json:"query" description:"Search query for project names/paths."`
}

func newGitLabSearchTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_search",
		"Search GitLab projects (scoped to the agent's bound group when configured). Filtered to allowed projects.",
		func(_ context.Context, in glSearchInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			projects, err := gitlabClient.SearchProjects(in.Query)
			if err != nil {
				return glErr(err)
			}
			out := make([]map[string]any, 0, len(projects))
			for _, p := range projects {
				out = append(out, map[string]any{
					"id":   p.ID,
					"path": p.PathWithNamespace,
					"name": p.Name,
					"url":  p.WebURL,
				})
			}
			return jsonResponse(out)
		})
}

type glListMRsInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	State   string `json:"state,omitempty" description:"MR state: opened (default) / closed / merged / all."`
}

func newGitLabListMRsTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_list_mrs",
		"List merge requests for a project.",
		func(_ context.Context, in glListMRsInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			mrs, err := gitlabClient.ListMergeRequests(in.Project, in.State)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(mrs)
		})
}

type glMRInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID     int64  `json:"iid" description:"Merge request IID (project-scoped number)."`
}

func newGitLabGetMRTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_get_mr",
		"Get details of a specific merge request.",
		func(_ context.Context, in glMRInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			mr, err := gitlabClient.GetMergeRequest(in.Project, in.IID)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(mr)
		})
}

func newGitLabGetMRDiffTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_get_mr_diff",
		"Get the per-file diffs/changes of a merge request.",
		func(_ context.Context, in glMRInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			diffs, err := gitlabClient.GetMergeRequestDiffs(in.Project, in.IID)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(diffs)
		})
}

type glListIssuesInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	State   string `json:"state,omitempty" description:"Issue state: opened (default) / closed / all."`
	Labels  string `json:"labels,omitempty" description:"Comma-separated label filter."`
}

func newGitLabListIssuesTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_list_issues",
		"List issues for a named project, the agent default project, or the bound group. If the default project is inaccessible and a group is bound, this falls back to recursively discovered group projects.",
		func(_ context.Context, in glListIssuesInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			issues, err := gitlabClient.ListIssuesForScope(in.Project, in.State, in.Labels)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(issues)
		})
}

type glListGroupIssuesInput struct {
	Group  string `json:"group,omitempty" description:"Group full path. Omit to use the agent's bound group."`
	State  string `json:"state,omitempty" description:"Issue state: opened (default) / closed / all."`
	Labels string `json:"labels,omitempty" description:"Comma-separated label filter."`
	Search string `json:"search,omitempty" description:"Optional issue search query."`
}

func newGitLabListGroupIssuesTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_list_group_issues",
		"List issues across projects in a GitLab group, including subgroup projects. Use this for group-wide issue inventory.",
		func(_ context.Context, in glListGroupIssuesInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			issues, err := gitlabClient.ListGroupIssues(in.Group, in.State, in.Labels, in.Search)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(issues)
		})
}

type glIssueInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID     int64  `json:"iid" description:"Issue IID (project-scoped number)."`
}

func newGitLabGetIssueTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_get_issue",
		"Get details of a specific issue.",
		func(_ context.Context, in glIssueInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			issue, err := gitlabClient.GetIssue(in.Project, in.IID)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(issue)
		})
}

type glListPipelinesInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	Ref     string `json:"ref,omitempty" description:"Filter by git ref (branch/tag)."`
}

func newGitLabListPipelinesTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_list_pipelines",
		"List recent CI pipelines for a project.",
		func(_ context.Context, in glListPipelinesInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			pipes, err := gitlabClient.ListPipelines(in.Project, in.Ref)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(pipes)
		})
}

type glPipelineInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	ID      int64  `json:"id" description:"Pipeline ID."`
}

func newGitLabGetPipelineTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_get_pipeline",
		"Get details of a specific CI pipeline (status, ref, sha, web URL).",
		func(_ context.Context, in glPipelineInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			p, err := gitlabClient.GetPipeline(in.Project, in.ID)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(p)
		})
}

// ── Write tools (registered only when read-write) ───────────────────────────

type glCreateMRInput struct {
	Project      string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	Title        string `json:"title" description:"MR title."`
	Description  string `json:"description,omitempty" description:"MR description (Markdown)."`
	SourceBranch string `json:"source_branch" description:"Source branch with changes."`
	TargetBranch string `json:"target_branch" description:"Target branch to merge into (e.g. main)."`
}

func newGitLabCreateMRTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_create_mr",
		"Create a new merge request.",
		func(_ context.Context, in glCreateMRInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			mr, err := gitlabClient.CreateMergeRequest(in.Project, in.Title, in.Description, in.SourceBranch, in.TargetBranch)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(mr)
		})
}

type glUpdateMRInput struct {
	Project     string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID         int64  `json:"iid" description:"Merge request IID."`
	Title       string `json:"title,omitempty" description:"New MR title."`
	Description string `json:"description,omitempty" description:"New MR description (Markdown)."`
	Labels      string `json:"labels,omitempty" description:"Comma-separated labels to set."`
}

func newGitLabUpdateMRTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_update_mr",
		"Update a merge request (title, description, labels).",
		func(_ context.Context, in glUpdateMRInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			mr, err := gitlabClient.UpdateMergeRequest(in.Project, in.IID, in.Title, in.Description, in.Labels)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(mr)
		})
}

type glMRNoteInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID     int64  `json:"iid" description:"Merge request IID."`
	Body    string `json:"body" description:"Note body (Markdown supported)."`
}

func newGitLabAddMRNoteTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_add_mr_note",
		"Add a comment (note) to a merge request.",
		func(_ context.Context, in glMRNoteInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			n, err := gitlabClient.AddMergeRequestNote(in.Project, in.IID, in.Body)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(n)
		})
}

type glUpdateIssueInput struct {
	Project      string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID          int64  `json:"iid" description:"Issue IID (project-scoped number)."`
	Labels       string `json:"labels,omitempty" description:"Comma-separated labels to SET (replaces all labels). Prefer add_labels/remove_labels for the work-board state machine."`
	AddLabels    string `json:"add_labels,omitempty" description:"Comma-separated labels to add, e.g. 'agent::in-progress'."`
	RemoveLabels string `json:"remove_labels,omitempty" description:"Comma-separated labels to remove, e.g. 'agent::todo'."`
	AssigneeID   int64  `json:"assignee_id,omitempty" description:"User ID to assign. Omit/0 to leave unchanged."`
	StateEvent   string `json:"state_event,omitempty" description:"Issue state change: 'close' or 'reopen'. Omit to leave unchanged."`
}

func newGitLabUpdateIssueTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_update_issue",
		"Update an issue's labels/assignee/state. Use add_labels/remove_labels to move a work-board card between columns (e.g. add 'agent::in-progress', remove 'agent::todo').",
		func(_ context.Context, in glUpdateIssueInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			issue, err := gitlabClient.UpdateIssue(in.Project, in.IID, in.Labels, in.AddLabels, in.RemoveLabels, in.AssigneeID, in.StateEvent)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(issue)
		})
}

type glIssueNoteInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID     int64  `json:"iid" description:"Issue IID."`
	Body    string `json:"body" description:"Note body (Markdown supported)."`
}

func newGitLabAddIssueNoteTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_add_issue_note",
		"Add a comment (note) to an issue.",
		func(_ context.Context, in glIssueNoteInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			n, err := gitlabClient.AddIssueNote(in.Project, in.IID, in.Body)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(n)
		})
}

type glListMRNotesInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID     int64  `json:"iid" description:"Merge request IID."`
}

func newGitLabListMRNotesTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_list_mr_notes",
		"List the discussion comments (notes) on a merge request, oldest first. Use this to read human review feedback when reworking a change-requested MR. System notes are excluded.",
		func(_ context.Context, in glListMRNotesInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			notes, err := gitlabClient.ListMergeRequestNotes(in.Project, in.IID)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(notes)
		})
}

type glListIssueNotesInput struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID     int64  `json:"iid" description:"Issue IID."`
}

func newGitLabListIssueNotesTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_list_issue_notes",
		"List the comment thread on an issue, oldest first. Use this to read the human's clarification comments while refining a PLAN. Returns each note's author and body.",
		func(_ context.Context, in glListIssueNotesInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			notes, err := gitlabClient.ListIssueNotes(in.Project, in.IID)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(notes)
		})
}

type glCreateIssueInput struct {
	Project     string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	Title       string `json:"title" description:"Issue title (the plan's headline)."`
	Description string `json:"description" description:"Issue description in Markdown. This IS the PLAN body."`
	Labels      string `json:"labels,omitempty" description:"Comma-separated labels. Use 'agent::planning' to place the plan into the planning lane for iterative refinement."`
}

func newGitLabCreateIssueTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_create_issue",
		"Create a new issue. The description is the PLAN (Markdown). Apply the 'agent::planning' label to open it for clarification before hand-off to implementation (agent::todo).",
		func(_ context.Context, in glCreateIssueInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			issue, err := gitlabClient.CreateIssue(in.Project, in.Title, in.Description, in.Labels)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(issue)
		})
}

type glUpdateIssueContentInput struct {
	Project     string `json:"project,omitempty" description:"Project path or ID. Omit to use bound project."`
	IID         int64  `json:"iid" description:"Issue IID (project-scoped number)."`
	Title       string `json:"title,omitempty" description:"New title. Omit to leave unchanged."`
	Description string `json:"description,omitempty" description:"New Markdown description (the refined PLAN). Omit to leave unchanged."`
}

func newGitLabUpdateIssueContentTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_update_issue_content",
		"Rewrite an issue's title and/or description. Use this to keep the PLAN (the issue body) in sync as the clarification thread refines requirements. For labels/state use gitlab_update_issue.",
		func(_ context.Context, in glUpdateIssueContentInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			issue, err := gitlabClient.UpdateIssueContent(in.Project, in.IID, in.Title, in.Description)
			if err != nil {
				return glErr(err)
			}
			return jsonResponse(issue)
		})
}

type glBulkCreateIssueItem struct {
	Project     string `json:"project,omitempty" description:"Project path or ID. Omit only when the agent is bound to a single project."`
	Title       string `json:"title" description:"Issue title."`
	Description string `json:"description" description:"Issue description in Markdown."`
	Labels      string `json:"labels,omitempty" description:"Comma-separated labels to set on the created issue."`
}

type glBulkCreateIssuesInput struct {
	DryRun *bool                   `json:"dry_run,omitempty" description:"Defaults to true when omitted. Keep true to preview the issue creation plan; set false only after explicit user approval."`
	Issues []glBulkCreateIssueItem `json:"issues" description:"Issues to create. Maximum 20 per call."`
}

type glBulkUpdateIssueItem struct {
	Project      string `json:"project,omitempty" description:"Project path or ID. Omit only when the agent is bound to a single project."`
	IID          int64  `json:"iid" description:"Issue IID (project-scoped number)."`
	Labels       string `json:"labels,omitempty" description:"Comma-separated labels to SET (replaces all labels)."`
	AddLabels    string `json:"add_labels,omitempty" description:"Comma-separated labels to add."`
	RemoveLabels string `json:"remove_labels,omitempty" description:"Comma-separated labels to remove."`
	AssigneeID   int64  `json:"assignee_id,omitempty" description:"User ID to assign. Omit/0 to leave unchanged."`
	StateEvent   string `json:"state_event,omitempty" description:"Issue state change: 'close' or 'reopen'. Omit to leave unchanged."`
}

type glBulkUpdateIssuesInput struct {
	DryRun *bool                   `json:"dry_run,omitempty" description:"Defaults to true when omitted. Keep true to preview issue updates; set false only after explicit user approval."`
	Issues []glBulkUpdateIssueItem `json:"issues" description:"Issues to update. Maximum 20 per call."`
}

type glBulkIssueNoteItem struct {
	Project string `json:"project,omitempty" description:"Project path or ID. Omit only when the agent is bound to a single project."`
	IID     int64  `json:"iid" description:"Issue IID (project-scoped number)."`
	Body    string `json:"body" description:"Note body in Markdown."`
}

type glBulkAddIssueNotesInput struct {
	DryRun *bool                 `json:"dry_run,omitempty" description:"Defaults to true when omitted. Keep true to preview notes; set false only after explicit user approval."`
	Notes  []glBulkIssueNoteItem `json:"notes" description:"Issue notes to add. Maximum 20 per call."`
}

type glBulkResult struct {
	Action  string       `json:"action"`
	DryRun  bool         `json:"dry_run"`
	Total   int          `json:"total"`
	OK      int          `json:"ok"`
	Failed  int          `json:"failed"`
	Results []glBulkItem `json:"results"`
	Warning string       `json:"warning,omitempty"`
}

type glBulkItem struct {
	Index   int            `json:"index"`
	Project string         `json:"project,omitempty"`
	IID     int64          `json:"iid,omitempty"`
	OK      bool           `json:"ok"`
	Error   string         `json:"error,omitempty"`
	Result  map[string]any `json:"result,omitempty"`
	Plan    map[string]any `json:"plan,omitempty"`
}

func bulkDryRun(v *bool) bool {
	if v == nil {
		return true
	}
	return *v
}

func validateBulkSize(count int) error {
	if count == 0 {
		return fmt.Errorf("at least one item is required")
	}
	if count > maxGitLabBulkItems {
		return fmt.Errorf("too many items: got %d, max %d", count, maxGitLabBulkItems)
	}
	return nil
}

func newGitLabBulkCreateIssuesTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_bulk_create_issues",
		"Create issues across multiple GitLab projects for Lab-PM/factory planning. Defaults to dry_run=true; call once to preview, then set dry_run=false only after user approval.",
		func(_ context.Context, in glBulkCreateIssuesInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			if err := validateBulkSize(len(in.Issues)); err != nil {
				return glErr(err)
			}
			dryRun := bulkDryRun(in.DryRun)
			out := glBulkResult{Action: "create_issues", DryRun: dryRun, Total: len(in.Issues)}
			if dryRun {
				out.Warning = "dry_run=true: no GitLab issues were created. Re-run with dry_run=false after explicit user approval."
			}
			for i, item := range in.Issues {
				result := glBulkItem{Index: i}
				project, err := gitlabClient.ResolveProject(item.Project)
				result.Project = project
				if err != nil {
					result.Error = err.Error()
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				if strings.TrimSpace(item.Title) == "" {
					result.Error = "title is required"
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				if dryRun {
					result.OK = true
					result.Plan = map[string]any{
						"project":     project,
						"title":       item.Title,
						"description": item.Description,
						"labels":      item.Labels,
					}
					out.OK++
					out.Results = append(out.Results, result)
					continue
				}
				issue, err := gitlabClient.CreateIssue(project, item.Title, item.Description, item.Labels)
				if err != nil {
					result.Error = err.Error()
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				result.OK = true
				result.IID = int64(issue.IID)
				result.Result = map[string]any{
					"iid":     issue.IID,
					"title":   issue.Title,
					"state":   issue.State,
					"web_url": issue.WebURL,
				}
				out.OK++
				out.Results = append(out.Results, result)
			}
			return jsonResponse(out)
		})
}

func newGitLabBulkUpdateIssuesTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_bulk_update_issues",
		"Bulk update GitLab issues across projects: labels, add/remove labels, assignee, and close/reopen. Defaults to dry_run=true; execute only after user approval.",
		func(_ context.Context, in glBulkUpdateIssuesInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			if err := validateBulkSize(len(in.Issues)); err != nil {
				return glErr(err)
			}
			dryRun := bulkDryRun(in.DryRun)
			out := glBulkResult{Action: "update_issues", DryRun: dryRun, Total: len(in.Issues)}
			if dryRun {
				out.Warning = "dry_run=true: no GitLab issues were updated. Re-run with dry_run=false after explicit user approval."
			}
			for i, item := range in.Issues {
				result := glBulkItem{Index: i, IID: item.IID}
				project, err := gitlabClient.ResolveProject(item.Project)
				result.Project = project
				if err != nil {
					result.Error = err.Error()
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				if item.IID <= 0 {
					result.Error = "iid must be greater than zero"
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				if item.Labels == "" && item.AddLabels == "" && item.RemoveLabels == "" && item.AssigneeID <= 0 && item.StateEvent == "" {
					result.Error = "at least one update field is required"
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				if dryRun {
					result.OK = true
					result.Plan = map[string]any{
						"project":       project,
						"iid":           item.IID,
						"labels":        item.Labels,
						"add_labels":    item.AddLabels,
						"remove_labels": item.RemoveLabels,
						"assignee_id":   item.AssigneeID,
						"state_event":   item.StateEvent,
					}
					out.OK++
					out.Results = append(out.Results, result)
					continue
				}
				issue, err := gitlabClient.UpdateIssue(project, item.IID, item.Labels, item.AddLabels, item.RemoveLabels, item.AssigneeID, item.StateEvent)
				if err != nil {
					result.Error = err.Error()
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				result.OK = true
				result.Result = map[string]any{
					"iid":     issue.IID,
					"title":   issue.Title,
					"state":   issue.State,
					"labels":  issue.Labels,
					"web_url": issue.WebURL,
				}
				out.OK++
				out.Results = append(out.Results, result)
			}
			return jsonResponse(out)
		})
}

func newGitLabBulkAddIssueNotesTool() fantasy.AgentTool {
	return fantasy.NewAgentTool("gitlab_bulk_add_issue_notes",
		"Add comments to multiple GitLab issues across projects. Defaults to dry_run=true; execute only after user approval.",
		func(_ context.Context, in glBulkAddIssueNotesInput, _ fantasy.ToolCall) (fantasy.ToolResponse, error) {
			if err := validateBulkSize(len(in.Notes)); err != nil {
				return glErr(err)
			}
			dryRun := bulkDryRun(in.DryRun)
			out := glBulkResult{Action: "add_issue_notes", DryRun: dryRun, Total: len(in.Notes)}
			if dryRun {
				out.Warning = "dry_run=true: no GitLab issue notes were added. Re-run with dry_run=false after explicit user approval."
			}
			for i, item := range in.Notes {
				result := glBulkItem{Index: i, IID: item.IID}
				project, err := gitlabClient.ResolveProject(item.Project)
				result.Project = project
				if err != nil {
					result.Error = err.Error()
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				if item.IID <= 0 {
					result.Error = "iid must be greater than zero"
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				if strings.TrimSpace(item.Body) == "" {
					result.Error = "body is required"
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				if dryRun {
					result.OK = true
					result.Plan = map[string]any{
						"project": project,
						"iid":     item.IID,
						"body":    item.Body,
					}
					out.OK++
					out.Results = append(out.Results, result)
					continue
				}
				note, err := gitlabClient.AddIssueNote(project, item.IID, item.Body)
				if err != nil {
					result.Error = err.Error()
					out.Failed++
					out.Results = append(out.Results, result)
					continue
				}
				result.OK = true
				result.Result = map[string]any{
					"id":   note.ID,
					"body": note.Body,
				}
				out.OK++
				out.Results = append(out.Results, result)
			}
			return jsonResponse(out)
		})
}

// gitlabTools initializes the GitLab client from the environment and returns the
// native GitLab tools. Returns nil when GITLAB_TOKEN is not set. Write tools are
// included only when the client is read-write.
func gitlabTools() []fantasy.AgentTool {
	if !gitlab.IsConfigured() {
		return nil
	}
	c, err := gitlab.NewFromEnv()
	if err != nil {
		slog.Warn("gitlab tools disabled", "error", err)
		return nil
	}
	gitlabClient = c

	tools := []fantasy.AgentTool{
		newGitLabGetProjectTool(),
		newGitLabListGroupProjectsTool(),
		newGitLabSearchTool(),
		newGitLabListMRsTool(),
		newGitLabGetMRTool(),
		newGitLabGetMRDiffTool(),
		newGitLabListMRNotesTool(),
		newGitLabListIssuesTool(),
		newGitLabListGroupIssuesTool(),
		newGitLabGetIssueTool(),
		newGitLabListIssueNotesTool(),
		newGitLabListPipelinesTool(),
		newGitLabGetPipelineTool(),
	}
	if !c.ReadOnly() {
		tools = append(tools,
			newGitLabCreateMRTool(),
			newGitLabUpdateMRTool(),
			newGitLabAddMRNoteTool(),
			newGitLabUpdateIssueTool(),
			newGitLabAddIssueNoteTool(),
			newGitLabCreateIssueTool(),
			newGitLabUpdateIssueContentTool(),
			newGitLabBulkCreateIssuesTool(),
			newGitLabBulkUpdateIssuesTool(),
			newGitLabBulkAddIssueNotesTool(),
		)
	}
	slog.Info("native gitlab tools enabled",
		"count", len(tools), "readOnly", c.ReadOnly(),
		"group", c.Group(), "project", c.DefaultProject())
	return tools
}
