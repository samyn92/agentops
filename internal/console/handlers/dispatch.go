// Console-initiated AgentRun dispatch.
//
// The work board's drag-to-dispatch is GitLab-label-native (the bridge fires the
// implementer when a card lands on a trigger label). This handler adds the
// complementary *direct* dispatch the report's CI repair loop needs (§9.2, §25):
// the console creates an AgentRun for a chosen agent, optionally pinned to an
// existing MR's feature branch so a "fix" run reworks the SAME branch rather than
// branching a fresh agent/issue-N. Created runs carry the same gitlab-* join
// annotations the bridge stamps, so they overlay on their card exactly like a
// bridge-fired run, plus ci-fix bookkeeping for the retry-budget guardrail.
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	agentsv1alpha1 "github.com/samyn92/agentops/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// defaultCIFixBudget caps how many console-dispatched fix runs may target one MR
// before the board blocks further (auto or manual) dispatch and the card must
// get human attention. Overridable per-request via DispatchRequest.RetryBudget.
const defaultCIFixBudget = 2

// DispatchRequest is the JSON body for POST /agentruns. Only AgentRef + Prompt
// are required; the rest scope the run to a GitLab work item and (for fix runs)
// pin it to an existing branch with retry-budget bookkeeping.
type DispatchRequest struct {
	// Required.
	AgentRef string `json:"agentRef"`
	Prompt   string `json:"prompt"`

	// Namespace defaults to the agent's namespace lookup (the cluster has one
	// agents namespace in practice); explicit value wins.
	Namespace string `json:"namespace,omitempty"`

	// Git workspace. When set, the run clones the repo and works on Branch. For a
	// CI fix this is the MR's source branch (rework in place); IntegrationRef is
	// the gitlab-group integration, Project the full path inside the group.
	IntegrationRef string `json:"integrationRef,omitempty"`
	Branch         string `json:"branch,omitempty"`
	BaseBranch     string `json:"baseBranch,omitempty"`
	Project        string `json:"project,omitempty"`

	// GitLab join keys — mirror the bridge's annotations so the run overlays on
	// its card. ProjectRef is the annotation value (path or numeric id); IssueIID
	// is the work-item iid; MRIID is the merge request the fix targets.
	ProjectRef string `json:"projectRef,omitempty"`
	IssueIID   string `json:"issueIID,omitempty"`
	MRIID      string `json:"mrIID,omitempty"`

	// Intent hint (e.g. "change" for a fix). The executing agent finalizes the
	// real intent in status.outcome.
	Intent string `json:"intent,omitempty"`

	// CIFix marks this as a CI repair dispatch — enables the retry-budget check
	// (counts existing fix runs for MRIID) and stamps the ci-fix-attempt
	// annotation. RetryBudget overrides defaultCIFixBudget when > 0.
	CIFix       bool `json:"ciFix,omitempty"`
	RetryBudget int  `json:"retryBudget,omitempty"`
}

// DispatchResponse echoes the created run plus, for blocked fix dispatches, why.
type DispatchResponse struct {
	Run       string `json:"run,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	AgentRef  string `json:"agentRef,omitempty"`
	Attempt   int    `json:"attempt,omitempty"` // 1-based ci-fix attempt this run represents
	Budget    int    `json:"budget,omitempty"`
	Blocked   bool   `json:"blocked,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// DispatchAgentRun creates an AgentRun on behalf of the console operator.
// POST /api/v1/agentruns
func (h *Handlers) DispatchAgentRun(w http.ResponseWriter, r *http.Request) {
	var req DispatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: %s", err)
		return
	}
	req.AgentRef = strings.TrimSpace(req.AgentRef)
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.AgentRef == "" || req.Prompt == "" {
		writeError(w, http.StatusBadRequest, "agentRef and prompt are required")
		return
	}

	// Agent dispatch authorization: verify the user has Developer+ access on the
	// target project before allowing dispatch. This prevents a user from
	// dispatching agents on repos they can't push to.
	if req.ProjectRef != "" && h.userToken(r) != "" {
		if err := h.verifyProjectAccess(r, req.ProjectRef); err != nil {
			writeError(w, http.StatusForbidden, "dispatch denied: %s", err)
			return
		}
	}

	// Resolve the target agent so we (a) get a definitive namespace and (b) can
	// reject dispatching to a daemon (daemons run via /prompt, not AgentRuns).
	ns := req.Namespace
	agent, err := h.findAgent(r, ns, req.AgentRef)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%s", err)
		return
	}
	ns = agent.Namespace
	if agent.Spec.Mode == agentsv1alpha1.AgentModeDaemon {
		writeError(w, http.StatusBadRequest,
			"agent %q is a daemon; dispatch a task agent (daemons run via the chat /prompt endpoint, not AgentRuns)", req.AgentRef)
		return
	}

	// CI-fix retry budget: count console fix runs already spent on this MR and
	// refuse once the budget is gone, so a failing pipeline can't loop forever.
	budget := req.RetryBudget
	if budget <= 0 {
		budget = defaultCIFixBudget
	}
	attempt := 0
	if req.CIFix {
		if req.MRIID == "" {
			writeError(w, http.StatusBadRequest, "ciFix dispatch requires mrIID")
			return
		}
		spent, err := h.countCIFixRuns(r, req.MRIID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to count fix runs: %s", err)
			return
		}
		if spent >= budget {
			writeJSON(w, http.StatusConflict, DispatchResponse{
				Blocked: true,
				Budget:  budget,
				Attempt: spent,
				Reason: fmt.Sprintf(
					"CI fix budget exhausted for MR !%s (%d/%d attempts). This card needs human attention.",
					req.MRIID, spent, budget),
			})
			return
		}
		attempt = spent + 1
	}

	run := buildDispatchRun(ns, &req, attempt)
	created, err := h.k8s.CreateAgentRun(r.Context(), run)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create agent run: %s", err)
		return
	}

	writeJSON(w, http.StatusCreated, DispatchResponse{
		Run:       created.GetName(),
		Namespace: created.GetNamespace(),
		AgentRef:  req.AgentRef,
		Attempt:   attempt,
		Budget:    budget,
	})
}

// findAgent resolves an agent by name, honoring an explicit namespace when given
// and otherwise scanning the list (the cluster runs a single agents namespace).
func (h *Handlers) findAgent(r *http.Request, ns, name string) (*agentsv1alpha1.Agent, error) {
	if ns != "" {
		a, err := h.k8s.GetAgent(r.Context(), ns, name)
		if err != nil {
			return nil, fmt.Errorf("agent %s/%s not found: %w", ns, name, err)
		}
		return a, nil
	}
	list, err := h.k8s.ListAgents(r.Context())
	if err != nil {
		return nil, fmt.Errorf("list agents: %w", err)
	}
	for i := range list.Items {
		if list.Items[i].Name == name {
			return &list.Items[i], nil
		}
	}
	return nil, fmt.Errorf("agent %q not found in any namespace", name)
}

// countCIFixRuns counts existing console-dispatched fix runs for a given MR iid
// (those carrying the agentops.dev/gitlab-mr annotation). This is the durable,
// reload-surviving retry counter — the same value GroupRuns surfaces as
// ciFixAttempts so the UI and the guardrail agree.
func (h *Handlers) countCIFixRuns(r *http.Request, mrIID string) (int, error) {
	runs, err := h.k8s.ListAgentRuns(r.Context())
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range runs.Items {
		if runs.Items[i].GetAnnotations()[annGitlabMR] == mrIID {
			n++
		}
	}
	return n, nil
}

// buildDispatchRun assembles the AgentRun CR: source=console, GenerateName so the
// operator allocates a unique name, the gitlab-* join annotations (so it overlays
// on its card like a bridge run), optional git workspace pinned to a branch, and
// the ci-fix bookkeeping annotations.
func buildDispatchRun(ns string, req *DispatchRequest, attempt int) *agentsv1alpha1.AgentRun {
	ann := map[string]string{}
	if req.IssueIID != "" {
		ann[annGitlabIID] = req.IssueIID
	}
	if req.ProjectRef != "" {
		ann[annGitlabProject] = req.ProjectRef
	}
	if req.MRIID != "" {
		ann[annGitlabTarget] = "mr"
		ann[annGitlabMR] = req.MRIID
	} else if req.IssueIID != "" {
		ann[annGitlabTarget] = "issue"
	}
	if attempt > 0 {
		ann[annCIFixAttempt] = strconv.Itoa(attempt)
	}

	run := &agentsv1alpha1.AgentRun{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: req.AgentRef + "-",
			Namespace:    ns,
			Labels: map[string]string{
				"agents.agentops.io/source": "console",
			},
			Annotations: ann,
		},
		Spec: agentsv1alpha1.AgentRunSpec{
			AgentRef:  req.AgentRef,
			Prompt:    req.Prompt,
			Source:    agentsv1alpha1.AgentRunSourceConsole,
			SourceRef: "console",
		},
	}
	if len(ann) == 0 {
		run.ObjectMeta.Annotations = nil
	}
	if req.IntegrationRef != "" && req.Branch != "" {
		run.Spec.Git = &agentsv1alpha1.AgentRunGitSpec{
			IntegrationRef: req.IntegrationRef,
			Branch:         req.Branch,
			BaseBranch:     req.BaseBranch,
			Project:        req.Project,
		}
	}
	if req.Intent != "" {
		run.Spec.Outcome = &agentsv1alpha1.AgentRunOutcomeSpec{
			Intent: agentsv1alpha1.AgentRunIntent(req.Intent),
		}
	}
	return run
}
