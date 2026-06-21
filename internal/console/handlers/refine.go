// Plan refinement endpoint — orchestrates agent-assisted plan revision.
//
// POST /api/v1/integrations/{ns}/{name}/group/projects/{projectID}/issues/{iid}/refine
// body: { "feedback": "...", "agent": "svc-pm" }
//
// Flow:
//  1. Fetch the issue (for description/context)
//  2. Prompt the specified agent with the issue context + human feedback
//  3. Post the agent's response as a GitLab note on the issue
//  4. Return the note to the frontend
//
// This keeps the entire refinement conversation in GitLab (visible in web UI,
// readable by agents on next context injection, attributed to the bot user).
package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// RefineRequest is the JSON body for the plan refinement endpoint.
type RefineRequest struct {
	Feedback string `json:"feedback"` // Human's refinement instructions
	Agent    string `json:"agent"`    // Agent name to prompt (e.g. "svc-pm")
}

// RefineResponse wraps the agent's output and the posted note.
type RefineResponse struct {
	Output string `json:"output"` // Agent's response text
	NoteID int    `json:"noteId"` // GitLab note ID (posted to the issue)
}

// GroupProjectIssueRefine orchestrates a plan refinement cycle:
// fetch issue context → prompt agent → post response as note (as bot) → return.
// POST .../group/projects/{projectID}/issues/{iid}/refine
func (h *Handlers) GroupProjectIssueRefine(w http.ResponseWriter, r *http.Request) {
	// Resolve workspace — gives us baseURL + user's token for reading.
	baseURL, pid, token, ok := h.groupProjectScope(w, r)
	if !ok {
		return
	}

	// Also resolve the Integration's bot token — used for posting the agent's
	// note so it appears as the bot service account, not the human.
	intg, botToken, _ := h.resolveIntegrationAndToken(r)
	if botToken == "" && intg != nil {
		slog.Warn("refine: no bot token for integration, agent note will post as user",
			"integration", intg.Name)
	}
	// For the note: prefer bot token so it shows as the bot. Fall back to user's token.
	noteToken := botToken
	if noteToken == "" {
		noteToken = token
	}

	iid := chi.URLParam(r, "iid")
	if iid == "" {
		writeError(w, http.StatusBadRequest, "missing issue iid")
		return
	}

	var req RefineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: %s", err)
		return
	}
	if req.Feedback == "" {
		writeError(w, http.StatusBadRequest, "feedback is required")
		return
	}
	if req.Agent == "" {
		writeError(w, http.StatusBadRequest, "agent name is required")
		return
	}

	// 1. Fetch the issue for context.
	type issueBody struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		IID         int    `json:"iid"`
		WebURL      string `json:"web_url"`
	}
	var issue issueBody
	issuePath := fmt.Sprintf("/api/v4/projects/%s/issues/%s", url.PathEscape(pid), url.PathEscape(iid))
	if err := gitlabGetJSON(r.Context(), token, baseURL, issuePath, &issue); err != nil {
		slog.Warn("refine: failed to fetch issue", "error", err)
		// Non-fatal — proceed with just feedback if issue fetch fails.
	}

	// 2. Build the prompt with full context.
	prompt := buildRefinePrompt(issue.Title, issue.Description, issue.IID, req.Feedback)

	// 3. Prompt the agent.
	agentNs := "agents" // Default namespace for agents
	agent, err := h.k8s.GetAgent(r.Context(), agentNs, req.Agent)
	if err != nil {
		writeError(w, http.StatusBadRequest, "agent %q not found: %s", req.Agent, err)
		return
	}
	agentURL := h.k8s.GetAgentServiceURL(agent)

	promptBody, _ := json.Marshal(map[string]string{"prompt": prompt})
	agentReq, err := http.NewRequestWithContext(r.Context(), "POST", agentURL+"/prompt", bytes.NewReader(promptBody))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create agent request: %s", err)
		return
	}
	agentReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 120 * time.Second} // Agents can be slow
	agentResp, err := client.Do(agentReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "agent unreachable: %s", err)
		return
	}
	defer agentResp.Body.Close()

	if agentResp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(agentResp.Body, 512))
		writeError(w, http.StatusBadGateway, "agent returned %d: %s", agentResp.StatusCode, string(respBody))
		return
	}

	var agentOutput struct {
		Output string `json:"output"`
	}
	if err := json.NewDecoder(agentResp.Body).Decode(&agentOutput); err != nil {
		writeError(w, http.StatusBadGateway, "failed to decode agent response: %s", err)
		return
	}

	if agentOutput.Output == "" {
		writeError(w, http.StatusBadGateway, "agent returned empty response")
		return
	}

	// 4. Update the issue DESCRIPTION (and optionally TITLE) with the agent's refined plan.
	// The description IS the authoritative plan document.
	// Extract a title from the first markdown heading if present.
	updateFields := map[string]string{"description": agentOutput.Output}
	if title := extractTitle(agentOutput.Output); title != "" {
		updateFields["title"] = title
	}
	updateBody, _ := json.Marshal(updateFields)
	updatePath := fmt.Sprintf("/api/v4/projects/%s/issues/%s", url.PathEscape(pid), url.PathEscape(iid))

	updateReq, err := http.NewRequestWithContext(r.Context(), "PUT", baseURL+updatePath, bytes.NewReader(updateBody))
	if err != nil {
		slog.Error("refine: failed to create update request", "error", err)
		writeJSON(w, http.StatusOK, RefineResponse{Output: agentOutput.Output})
		return
	}
	if noteToken == botToken && botToken != "" {
		updateReq.Header.Set("PRIVATE-TOKEN", noteToken)
	} else {
		updateReq.Header.Set("Authorization", "Bearer "+noteToken)
	}
	updateReq.Header.Set("Content-Type", "application/json")

	updateResp, err := client.Do(updateReq)
	if err != nil {
		slog.Error("refine: failed to update issue description", "error", err)
	} else {
		updateResp.Body.Close()
	}

	// 5. Post a note summarizing what was changed (for audit trail).
	noteText := fmt.Sprintf("**Plan updated** based on feedback:\n\n> %s\n\nThe issue description has been updated with the refined plan.",
		req.Feedback)
	noteBody, _ := json.Marshal(map[string]string{"body": noteText})
	notePath := fmt.Sprintf("/api/v4/projects/%s/issues/%s/notes", url.PathEscape(pid), url.PathEscape(iid))

	noteReq, err := http.NewRequestWithContext(r.Context(), "POST", baseURL+notePath, bytes.NewReader(noteBody))
	if err != nil {
		slog.Error("refine: failed to create note request", "error", err)
		writeJSON(w, http.StatusOK, RefineResponse{Output: agentOutput.Output})
		return
	}
	if noteToken == botToken && botToken != "" {
		noteReq.Header.Set("PRIVATE-TOKEN", noteToken)
	} else {
		noteReq.Header.Set("Authorization", "Bearer "+noteToken)
	}
	noteReq.Header.Set("Content-Type", "application/json")

	noteResp, err := client.Do(noteReq)
	if err != nil {
		slog.Error("refine: failed to post note", "error", err)
		writeJSON(w, http.StatusOK, RefineResponse{Output: agentOutput.Output})
		return
	}
	defer noteResp.Body.Close()

	var postedNote struct {
		ID int `json:"id"`
	}
	json.NewDecoder(noteResp.Body).Decode(&postedNote)

	slog.Info("plan refinement completed",
		"issue", iid, "agent", req.Agent, "noteId", postedNote.ID,
		"outputLen", len(agentOutput.Output))

	writeJSON(w, http.StatusOK, RefineResponse{
		Output: agentOutput.Output,
		NoteID: postedNote.ID,
	})
}

func buildRefinePrompt(title, description string, iid int, feedback string) string {
	var b bytes.Buffer
	b.WriteString("You are refining a plan for a work item. Your output will REPLACE the issue description (the authoritative plan document).\n\n")
	b.WriteString("Write a complete, self-contained plan in markdown. Do NOT include conversational text — only the plan itself.\n\n")

	if iid > 0 {
		fmt.Fprintf(&b, "## Issue #%d: %s\n\n", iid, title)
	}
	if description != "" {
		b.WriteString("## Current Plan\n\n")
		b.WriteString(description)
		b.WriteString("\n\n")
	}
	b.WriteString("## Human Feedback\n\n")
	b.WriteString(feedback)
	b.WriteString("\n\n")
	b.WriteString("## Instructions\n\n")
	b.WriteString("Output ONLY the updated plan document in markdown. Include:\n")
	b.WriteString("- Objective\n- Technical approach\n- Files to create/modify\n- Acceptance criteria (as checkboxes)\n- Estimated effort\n\n")
	b.WriteString("Your entire response becomes the new issue description. Be structured and actionable.")
	return b.String()
}

// extractTitle pulls a concise title from the agent's markdown output.
// Looks for the first H1 or H2 heading and uses that. Falls back to empty.
func extractTitle(markdown string) string {
	for _, line := range strings.Split(markdown, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			return strings.TrimSpace(line[2:])
		}
		if strings.HasPrefix(line, "## ") {
			return strings.TrimSpace(line[3:])
		}
	}
	return ""
}
