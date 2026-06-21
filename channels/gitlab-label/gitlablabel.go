// Package gitlablabel implements the GitLab label-driven work-board channel.
//
// Unlike the webhook-based gitlab channel, this bridge POLLS the GitLab REST
// API (zero external dependencies — stdlib net/http with a PRIVATE-TOKEN
// header) for issues or merge requests carrying one of the configured
// trigger labels (e.g. agent::todo, agent::changes-requested). For each new
// match it renders the prompt template and either prompts a daemon agent or
// creates an AgentRun, stamping GitLab join annotations so the console can
// correlate runs with work-board cards.
//
// Idempotency is a property of the label protocol: the agent's first action
// flips agent::todo -> agent::in-progress, so the item stops matching. A short
// TTL in-memory seen-set covers the transition window between firing and the
// label flip to avoid duplicate runs.
package gitlablabel

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/samyn92/agentops/channels/internal/bridge"
)

// Poller polls GitLab for labelled issues/MRs and fires agents.
type Poller struct {
	cfg    *bridge.Config
	client *bridge.AgentClient
	http   *http.Client
	logger *slog.Logger

	baseURL string
	project string // project path, e.g. "group/project" (project-scoped)
	group   string // group path (group-scoped); mutually exclusive with project
	token   string
	target  string   // "issues" or "merge_requests"
	labels  []string // trigger labels (OR semantics)
	state   string   // "opened" or "all"

	// Task-mode git workspace: when integrationRef is set, the bridge stamps
	// AgentRun.spec.git so the runtime clones the repo and enables native
	// gitlab_* tools. Empty for daemon agents (which need no AgentRun).
	integrationRef string
	baseBranch     string

	// inProgressLabel is the scoped label the bridge moves an item to the
	// instant it fires the agent (deterministic half of the hybrid label
	// protocol). The trigger label is removed and this is added, so the item
	// stops matching immediately — idempotency no longer relies on the LLM.
	// The agent is responsible for the second transition (-> needs-review)
	// after it opens the MR, driven by the prompt template.
	inProgressLabel string

	// reviewLabel is the deterministic backstop for that second transition.
	// LLM agents skip the in-progress -> needs-review flip often enough that
	// the board can't rely on it, so each poll the bridge also asks GitLab
	// which MRs would close an in-progress issue; if a live MR exists, it
	// promotes the card to this label itself (issue targets only — the
	// closed_by relationship has no merge-request equivalent). Empty disables
	// the backstop.
	reviewLabel string

	// maxRetries bounds automatic failure recovery: a card whose AgentRun
	// failed is re-queued onto its original trigger label up to this many
	// times before the bridge gives up and leaves it for a human (with a note).
	maxRetries int

	mu       sync.Mutex
	seen     map[string]time.Time // join-key -> first-seen time
	ttl      time.Duration        // how long a seen entry suppresses re-firing
	attempts map[int]int          // iid -> failed-run recovery attempts
	gaveUp   map[int]bool         // iid -> human-attention note already posted

	// board publishes real-time board_changed events to NATS so the console
	// updates the work board the instant a card's column changes — no UI poll.
	// nil when NATS_URL is unset (graceful: the console's slow poll covers it).
	board *boardPublisher
	// lastLabel remembers the column label we last observed per iid, so the
	// poll loop can detect and publish out-of-band moves (human/CLI/agent
	// relabels) that didn't go through the bridge's own transition().
	lastLabel map[int]string
	// allLabels is the full set of board column labels scanned for external
	// moves (GITLAB_BOARD_LABELS, defaults to the canonical six).
	allLabels []string
	// strayLabels are non-column labels agents occasionally invent (e.g.
	// agent::done) that would make a card vanish; the bridge normalizes a card
	// on one of these (with a live MR) back to the review label. Configurable
	// via GITLAB_STRAY_LABELS (CSV); defaults to agent::done.
	strayLabels []string
}

// New builds a gitlab-label poller from the shared bridge config plus the
// GitLab-specific env vars set by the operator.
func New(cfg *bridge.Config, interval time.Duration, logger *slog.Logger) *Poller {
	target := envOrDefault("GITLAB_TARGET", "issues")
	if target != "issues" && target != "merge_requests" {
		target = "issues"
	}

	// seen-set TTL must outlive the gap between firing and the agent flipping
	// the label, but stay short so a stuck item eventually re-fires.
	ttl := 3 * interval
	if ttl < 2*time.Minute {
		ttl = 2 * time.Minute
	}

	maxRetries := 2
	if v := os.Getenv("GITLAB_MAX_RETRIES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			maxRetries = n
		}
	}

	return &Poller{
		cfg:     cfg,
		client:  bridge.NewAgentClient(logger),
		http:    &http.Client{Timeout: 20 * time.Second},
		logger:  logger,
		baseURL: strings.TrimRight(os.Getenv("GITLAB_BASE_URL"), "/"),
		project: os.Getenv("GITLAB_PROJECT"),
		group:   os.Getenv("GITLAB_GROUP"),
		token:   os.Getenv("GITLAB_TOKEN"),
		target:  target,
		labels:  parseCSV(os.Getenv("GITLAB_LABELS")),
		state:   envOrDefault("GITLAB_STATE", "opened"),
		seen:    make(map[string]time.Time),
		ttl:     ttl,

		integrationRef: os.Getenv("GITLAB_INTEGRATION_REF"),
		baseBranch:     envOrDefault("GITLAB_BASE_BRANCH", "main"),

		inProgressLabel: envOrDefault("GITLAB_IN_PROGRESS_LABEL", "agent::in-progress"),
		reviewLabel:     envOrDefault("GITLAB_REVIEW_LABEL", "agent::needs-review"),
		maxRetries:      maxRetries,
		attempts:        make(map[int]int),
		gaveUp:          make(map[int]bool),

		board:     newBoardPublisher(logger),
		lastLabel: make(map[int]string),
		allLabels: parseCSV(os.Getenv("GITLAB_BOARD_LABELS")),
		strayLabels: func() []string {
			if v := parseCSV(os.Getenv("GITLAB_STRAY_LABELS")); len(v) > 0 {
				return v
			}
			return []string{"agent::done", "agent::complete", "agent::completed", "agent::finished"}
		}(),
	}
}

// glItem is the subset of a GitLab issue/MR REST object we care about.
// The REST list endpoints return labels as a flat array of strings.
type glItem struct {
	IID       int      `json:"iid"`
	Title     string   `json:"title"`
	WebURL    string   `json:"web_url"`
	State     string   `json:"state"`
	ProjectID int      `json:"project_id"`
	Labels    []string `json:"labels"`
}

// Poll runs one poll cycle: list matching items per trigger label, dedup, and
// fire the agent for any item not already in the seen-set.
func (p *Poller) Poll(ctx context.Context) {
	p.purgeExpired()

	if p.token == "" {
		p.logger.Error("GITLAB_TOKEN not set; cannot poll")
		return
	}
	if p.baseURL == "" || (p.project == "" && p.group == "") {
		p.logger.Error("GitLab base URL / project / group not configured")
		return
	}
	if len(p.labels) == 0 {
		p.logger.Error("no trigger labels configured")
		return
	}

	// GitLab's `labels` query is AND across the CSV; our trigger labels are
	// alternatives (OR), so we issue one request per label and union by iid.
	matched := map[int]matchedItem{}
	for _, label := range p.labels {
		items, err := p.list(ctx, label)
		if err != nil {
			p.logger.Error("list failed", "label", label, "error", err)
			continue
		}
		for _, it := range items {
			if _, exists := matched[it.IID]; !exists {
				matched[it.IID] = matchedItem{item: it, label: label}
			}
		}
	}

	for _, m := range matched {
		if ctx.Err() != nil {
			return
		}
		p.fire(ctx, m.item, m.label)
	}

	// Deterministic HANDOFF backstop (in-progress -> needs-review): promote any
	// in-progress issue that already has a live MR closing it, even when the
	// agent forgot to flip the label. Runs for BOTH daemon and task agents (the
	// signal is an external GitLab object, not an AgentRun) and only for issue
	// boards, where the closed_by relationship exists.
	if p.target == "issues" && p.inProgressLabel != "" && p.reviewLabel != "" {
		p.promoteReviewable(ctx)
		// Normalize stray terminal labels: agents sometimes invent a label like
		// `agent::done` instead of the mandated needs-review. Such a card carries
		// no board column, so it VANISHES from the board. Move any card on a known
		// stray label that has a live MR to needs-review so it stays visible.
		p.normalizeStrayLabels(ctx)
	}

	// Failure backstop: cards the bridge already moved to in-progress no longer
	// match any trigger label, so the loop above can't see them. Sweep them
	// separately and re-queue any whose AgentRun definitively failed. Only task
	// agents have an AgentRun to inspect; daemon agents are skipped.
	if !p.cfg.IsDaemon() && p.inProgressLabel != "" {
		p.recoverStuck(ctx)
	}

	// Real-time board freshness: detect column changes made OUTSIDE the bridge
	// (a human drag in the console, a relabel in the GitLab UI, a merge that
	// closed an issue) and publish board_changed for them. This is what lets
	// every move — not just the bridge's own — reflect on the board instantly.
	if p.board != nil {
		p.detectExternalMoves(ctx)
	}
}

// boardLabels returns the full set of work-board column labels to scan for
// out-of-band moves. Defaults to the canonical six; override via
// GITLAB_BOARD_LABELS (CSV) if the column set differs.
func (p *Poller) boardLabels() []string {
	if len(p.allLabels) > 0 {
		return p.allLabels
	}
	return []string{
		"agent::planning", "agent::todo", "agent::in-progress",
		"agent::needs-review", "agent::changes-requested", "agent::approved",
	}
}

// detectExternalMoves lists every board column and emits board_changed for any
// card whose current column differs from what we last recorded (in lastLabel).
// Bridge-initiated moves already updated lastLabel in transition(), so this
// only fires for changes the bridge didn't make. Issues are queried in all
// states so a merged-and-closed card is still observed.
func (p *Poller) detectExternalMoves(ctx context.Context) {
	// Snapshot current column label per iid across all board columns.
	current := map[int]glItem{}
	curLabel := map[int]string{}
	for _, label := range p.boardLabels() {
		items, err := p.listState(ctx, label, "all")
		if err != nil {
			continue // best-effort
		}
		for _, it := range items {
			// A card may carry several agent:: labels transiently; keep the
			// highest-precedence (latest stage) one for its column identity.
			if _, seen := curLabel[it.IID]; !seen || stageRank(label) > stageRank(curLabel[it.IID]) {
				curLabel[it.IID] = label
				current[it.IID] = it
			}
		}
	}

	for iid, label := range curLabel {
		if ctx.Err() != nil {
			return
		}
		p.mu.Lock()
		prev, had := p.lastLabel[iid]
		p.lastLabel[iid] = label
		p.mu.Unlock()
		if had && prev != label {
			it := current[iid]
			p.board.publishBoardChanged(it.ProjectID, iid, p.target, prev, label, it.State, it.WebURL, it.Title)
			p.logger.Info("board_changed (external move)", "iid", iid, "from", prev, "to", label)
		}
	}
}

// stageRank gives the pipeline position of a column label (higher = later), so
// a card carrying multiple agent:: labels is attributed to its furthest stage.
func stageRank(label string) int {
	switch label {
	case "agent::planning":
		return 0
	case "agent::todo":
		return 1
	case "agent::in-progress":
		return 2
	case "agent::needs-review":
		return 3
	case "agent::changes-requested":
		return 4
	case "agent::approved":
		return 5
	}
	return -1
}

type matchedItem struct {
	item  glItem
	label string
}

// list fetches items carrying the given single label, using the poller's
// configured state filter.
func (p *Poller) list(ctx context.Context, label string) ([]glItem, error) {
	return p.listState(ctx, label, p.state)
}

// listState fetches items carrying the given single label filtered by the given
// GitLab state ("opened"/"closed"/"all").
func (p *Poller) listState(ctx context.Context, label, state string) ([]glItem, error) {
	var scope, scopePath string
	if p.project != "" {
		scope, scopePath = "projects", p.project
	} else {
		scope, scopePath = "groups", p.group
	}

	// url.QueryEscape encodes "/" as %2F, which GitLab requires for path-based IDs.
	endpoint := fmt.Sprintf("%s/api/v4/%s/%s/%s",
		p.baseURL, scope, url.QueryEscape(scopePath), p.target)

	q := url.Values{}
	q.Set("labels", label)
	q.Set("state", state)
	q.Set("per_page", "100")
	reqURL := endpoint + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", p.token)
	req.Header.Set("Accept", "application/json")

	resp, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("gitlab API %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var items []glItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return items, nil
}

// fire renders the prompt and dispatches the agent for one matched item,
// recording it in the seen-set to suppress duplicate firing during the
// label-transition window.
func (p *Poller) fire(ctx context.Context, it glItem, label string) {
	key := p.seenKey(it.IID, label)
	if p.alreadySeen(key) {
		return
	}

	iidStr := strconv.Itoa(it.IID)
	projectRef := p.project
	if projectRef == "" {
		// For group-scoped polls, extract the project path from the issue's web_url.
		// Format: https://gitlab.com/<group>/<project>/-/issues/<iid>
		projectRef = extractProjectPath(it.WebURL)
		if projectRef == "" {
			// Last resort: numeric ID (runtime may reject this for group integrations).
			projectRef = strconv.Itoa(it.ProjectID)
		}
	}

	data := map[string]interface{}{
		"channel": p.cfg.ChannelName,
		"agent":   p.cfg.AgentRef,
		"gitlab": map[string]interface{}{
			"target":  p.target,
			"iid":     iidStr,
			"project": projectRef,
			"web_url": it.WebURL,
			"title":   it.Title,
			"label":   label,
			"state":   it.State,
		},
		"item": it,
	}

	prompt, err := bridge.RenderPrompt(p.cfg.PromptTemplate, data)
	if err != nil {
		p.logger.Error("render prompt failed", "iid", it.IID, "error", err)
		return
	}

	annotations := map[string]string{
		"agentops.dev/gitlab-iid":     iidStr,
		"agentops.dev/gitlab-target":  p.target,
		"agentops.dev/gitlab-project": projectRef,
		// Remember the trigger label so failure-recovery can re-queue the card
		// back onto the right column (todo vs changes-requested) if the run dies.
		"agentops.dev/gitlab-trigger": label,
	}
	metadata := map[string]string{
		"channel": p.cfg.ChannelName,
		"type":    "gitlab-label",
		"iid":     iidStr,
		"target":  p.target,
		"label":   label,
	}

	// For task agents, hand the bridge the git workspace coordinates so it
	// stamps AgentRun.spec.git — the runtime then clones the repo and enables
	// the native gitlab_* tools. The feature branch is per-item; on issues we
	// derive it from the iid, on MRs we reuse the MR's own source branch.
	if p.integrationRef != "" {
		metadata["gitResourceRef"] = p.integrationRef
		metadata["gitBaseBranch"] = p.baseBranch
		metadata["gitBranch"] = fmt.Sprintf("agent/issue-%s", iidStr)
		// For group integrations, pass the project path so the runtime knows
		// which specific repo within the group to clone.
		metadata["gitProject"] = projectRef
	}

	p.logger.Info("firing agent for matched item",
		"target", p.target, "iid", it.IID, "label", label, "title", it.Title)

	if p.cfg.IsDaemon() {
		// Move the card off its trigger label to in-progress FIRST, then prompt.
		// A daemon's reasoning can take longer than our HTTP client timeout, so
		// awaiting the prompt before transitioning would leave the card on its
		// trigger label and re-fire it every poll (a storm), spawning duplicate
		// daemon turns. The daemon still receives and processes the prompt; we
		// just don't block the idempotency transition on its (slow) response.
		if p.inProgressLabel != "" && label != p.inProgressLabel {
			if err := p.transition(ctx, it, label, p.inProgressLabel); err != nil {
				p.logger.Error("label transition failed",
					"iid", it.IID, "from", label, "to", p.inProgressLabel, "error", err)
			} else {
				p.logger.Info("label transitioned",
					"iid", it.IID, "from", label, "to", p.inProgressLabel)
			}
		}
		p.markSeen(key)

		// Carry the card identity as headers so the runtime stamps any delegated
		// child runs with the gitlab-* join annotations (deterministic; the
		// daemon's LLM never has to thread the iid through delegation).
		headers := map[string]string{
			"X-AgentOps-GitLab-IID":     iidStr,
			"X-AgentOps-GitLab-Project": projectRef,
			"X-AgentOps-GitLab-Target":  p.target,
		}
		if err := p.client.PromptDaemon(ctx, p.cfg.AgentURL, prompt, metadata, headers); err != nil {
			// The daemon is likely still processing (slow reasoning > client
			// timeout); the card is already on in-progress + seen, so we won't
			// re-fire. Log and move on rather than reverting.
			p.logger.Warn("prompt daemon did not ack in time (it may still be working)",
				"iid", it.IID, "error", err)
		}
		return
	}

	if err := p.client.CreateAgentRun(ctx, &bridge.AgentRunRequest{
		AgentRef:    p.cfg.AgentRef,
		ChannelName: p.cfg.ChannelName,
		Prompt:      prompt,
		Metadata:    metadata,
		Annotations: annotations,
	}); err != nil {
		p.logger.Error("create AgentRun failed", "iid", it.IID, "error", err)
		return
	}

	// Task agents: the AgentRun create is fast + authoritative, so transition
	// after it succeeds. Deterministic half of the hybrid label protocol — the
	// item stops matching on the next poll without relying on the LLM.
	if p.inProgressLabel != "" && label != p.inProgressLabel {
		if err := p.transition(ctx, it, label, p.inProgressLabel); err != nil {
			p.logger.Error("label transition failed",
				"iid", it.IID, "from", label, "to", p.inProgressLabel, "error", err)
		} else {
			p.logger.Info("label transitioned",
				"iid", it.IID, "from", label, "to", p.inProgressLabel)
		}
	}

	p.markSeen(key)
}

// extractProjectPath extracts the project path from a GitLab issue/MR web URL.
// Input:  "https://gitlab.com/samyn92-lab/billing-svc/-/issues/7"
// Output: "samyn92-lab/billing-svc"
func extractProjectPath(webURL string) string {
	// Find "/-/" which separates the project path from the resource type.
	idx := strings.Index(webURL, "/-/")
	if idx < 0 {
		return ""
	}
	// Strip the base URL prefix (everything up to the first path after the host).
	path := webURL[:idx]
	// Remove scheme + host: find the third "/" (after https://host/)
	slashes := 0
	for i, c := range path {
		if c == '/' {
			slashes++
			if slashes == 3 {
				return path[i+1:]
			}
		}
	}
	return ""
}

// transition moves an item from one label to another via the GitLab REST API
// (PUT issues/merge_requests with add_labels/remove_labels). It always targets
// the item's own project (projects/{project_id}/...), so it works for both
// project- and group-scoped pollers.
func (p *Poller) transition(ctx context.Context, it glItem, from, to string) error {
	endpoint := fmt.Sprintf("%s/api/v4/projects/%d/%s/%d",
		p.baseURL, it.ProjectID, p.target, it.IID)

	q := url.Values{}
	q.Set("add_labels", to)
	q.Set("remove_labels", from)
	reqURL := endpoint + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, reqURL, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", p.token)
	req.Header.Set("Accept", "application/json")

	resp, err := p.http.Do(req)
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("gitlab API %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	// Real-time board update: this is the single chokepoint for every label
	// move the bridge makes (fire/promote/recover), so one publish here covers
	// them all. Record the new label so the poll loop doesn't re-emit it as an
	// "external" change.
	p.rememberLabel(it.IID, to)
	if p.board != nil {
		p.board.publishBoardChanged(it.ProjectID, it.IID, p.target, from, to, it.State, it.WebURL, it.Title)
	}
	return nil
}

// rememberLabel records the last column label observed for an iid (used to
// detect out-of-band moves on the next poll).
func (p *Poller) rememberLabel(iid int, label string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.lastLabel == nil {
		p.lastLabel = make(map[int]string)
	}
	p.lastLabel[iid] = label
}

// glMR is the subset of a merge request returned by the issue "closed_by"
// endpoint that we need to judge whether an issue's deliverable already exists.
type glMR struct {
	IID    int    `json:"iid"`
	State  string `json:"state"` // opened|closed|merged|locked
	WebURL string `json:"web_url"`
}

// promoteReviewable is the deterministic backstop for the second label HANDOFF
// (in-progress -> needs-review). Agents are prompted to flip this label after
// they open the MR, but LLMs skip the step often enough (~1 in 3 runs) that the
// board needs a structural guarantee. For every issue parked on the in-progress
// label, the bridge asks GitLab which MRs would close it; if at least one such
// MR is still live (open or merged, i.e. not an abandoned/closed MR), the
// deliverable is real and the card is moved to needs-review for a human —
// independent of whether the agent remembered to do it itself.
func (p *Poller) promoteReviewable(ctx context.Context) {
	items, err := p.list(ctx, p.inProgressLabel)
	if err != nil {
		p.logger.Error("promote: list in-progress failed",
			"label", p.inProgressLabel, "error", err)
		return
	}

	for _, it := range items {
		if ctx.Err() != nil {
			return
		}
		mrs, err := p.closingMRs(ctx, it)
		if err != nil {
			p.logger.Error("promote: closed_by lookup failed", "iid", it.IID, "error", err)
			continue
		}
		if !hasLiveMR(mrs) {
			continue
		}
		if err := p.transition(ctx, it, p.inProgressLabel, p.reviewLabel); err != nil {
			p.logger.Error("promote: transition failed",
				"iid", it.IID, "to", p.reviewLabel, "error", err)
			continue
		}
		// The card left the in-progress column on the strength of a real
		// deliverable: clear its recovery budget and seen entries so a later
		// changes-requested cycle isn't suppressed or treated as a prior failure.
		p.clearAttempts(it.IID)
		p.clearSeen(it.IID)
		p.logger.Info("promote: card moved to review (closing MR exists)",
			"iid", it.IID, "to", p.reviewLabel)
	}
}

// normalizeStrayLabels rescues cards that an agent parked on a non-column label
// it invented (e.g. agent::done) instead of the mandated review label. Such a
// card matches no board column and disappears from the board. For each known
// stray label, the bridge lists issues carrying it and — if the issue has a
// live MR (so the work is real) — moves it to the review label, stripping the
// stray. Deterministic backstop against LLM label drift, mirroring promote.
func (p *Poller) normalizeStrayLabels(ctx context.Context) {
	for _, stray := range p.strayLabels {
		if stray == "" || stray == p.reviewLabel {
			continue
		}
		items, err := p.listState(ctx, stray, "all") // closed too: a merged MR may have closed it
		if err != nil {
			p.logger.Error("normalize: list stray failed", "label", stray, "error", err)
			continue
		}
		for _, it := range items {
			if ctx.Err() != nil {
				return
			}
			mrs, err := p.closingMRs(ctx, it)
			if err != nil {
				p.logger.Error("normalize: closed_by lookup failed", "iid", it.IID, "error", err)
				continue
			}
			if !hasLiveMR(mrs) {
				// No real deliverable — leave it for a human rather than guess.
				continue
			}
			if err := p.transition(ctx, it, stray, p.reviewLabel); err != nil {
				p.logger.Error("normalize: transition failed",
					"iid", it.IID, "from", stray, "to", p.reviewLabel, "error", err)
				continue
			}
			p.clearAttempts(it.IID)
			p.clearSeen(it.IID)
			p.logger.Info("normalize: stray label rescued to review",
				"iid", it.IID, "from", stray, "to", p.reviewLabel)
		}
	}
}

// closingMRs returns the merge requests GitLab knows will close this issue when
// merged (the issue's "closed_by" set). Always targets the item's own project
// by numeric ID, so it works for both project- and group-scoped pollers.
func (p *Poller) closingMRs(ctx context.Context, it glItem) ([]glMR, error) {
	endpoint := fmt.Sprintf("%s/api/v4/projects/%d/issues/%d/closed_by",
		p.baseURL, it.ProjectID, it.IID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", p.token)
	req.Header.Set("Accept", "application/json")

	resp, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("gitlab API %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var mrs []glMR
	if err := json.NewDecoder(resp.Body).Decode(&mrs); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return mrs, nil
}

// hasLiveMR reports whether any closing MR is still a viable deliverable (open
// or already merged) rather than abandoned (closed/locked). A single live MR is
// enough to treat the issue's work as done and ready for human review.
func hasLiveMR(mrs []glMR) bool {
	for _, mr := range mrs {
		if mr.State == "opened" || mr.State == "merged" {
			return true
		}
	}
	return false
}

// recoverStuck sweeps items currently parked on the in-progress label and
// re-queues any whose latest AgentRun definitively failed. Cards in this column
// no longer match any trigger label, so the normal Poll loop can't see them —
// this is the only path that unwedges a run that died mid-flight.
func (p *Poller) recoverStuck(ctx context.Context) {
	items, err := p.list(ctx, p.inProgressLabel)
	if err != nil {
		p.logger.Error("recover: list in-progress failed",
			"label", p.inProgressLabel, "error", err)
		return
	}

	for _, it := range items {
		if ctx.Err() != nil {
			return
		}
		st, err := p.client.LatestRunForIID(ctx, p.cfg.ChannelName, strconv.Itoa(it.IID))
		if err != nil {
			p.logger.Error("recover: lookup run failed", "iid", it.IID, "error", err)
			continue
		}
		if !st.Found {
			// No AgentRun joined to this card yet (race between firing and the
			// run object appearing). Leave it for the next sweep.
			continue
		}
		switch st.Phase {
		case "Succeeded":
			// Run finished cleanly; the card is awaiting human review or the
			// agent simply hasn't flipped the label yet. Reset the budget.
			p.clearAttempts(it.IID)
		case "Failed":
			p.recoverFailed(ctx, it, st)
		}
	}
}

// recoverFailed re-queues a card whose run failed, back onto its ORIGINAL
// trigger label (todo vs changes-requested), up to maxRetries times. Past the
// budget it posts a single human-attention note and leaves the card parked in
// in-progress (the failed-run badge is already visible on the board).
func (p *Poller) recoverFailed(ctx context.Context, it glItem, st bridge.RunStatus) {
	trigger := st.Trigger
	if trigger == "" {
		// Older runs (or a missing annotation) can't be safely routed back to a
		// specific column; don't guess. Surface it once for a human.
		if p.markGaveUp(it.IID) {
			_ = p.addNote(ctx, it,
				"AgentOps: run failed and no original trigger label was recorded; needs manual triage.")
		}
		return
	}

	n := p.bumpAttempts(it.IID)
	if n > p.maxRetries {
		if p.markGaveUp(it.IID) {
			_ = p.addNote(ctx, it, fmt.Sprintf(
				"AgentOps: agent run failed %d times (max %d); giving up automatic retries. Card left in %s for manual attention.",
				n-1, p.maxRetries, p.inProgressLabel))
			p.logger.Warn("recover: gave up after max retries",
				"iid", it.IID, "attempts", n-1, "max", p.maxRetries)
		}
		return
	}

	// Move the card back to its trigger column so the next Poll re-fires it.
	if err := p.transition(ctx, it, p.inProgressLabel, trigger); err != nil {
		p.logger.Error("recover: re-queue transition failed",
			"iid", it.IID, "to", trigger, "error", err)
		return
	}
	// Drop seen entries so the re-queued card isn't suppressed by the TTL window.
	p.clearSeen(it.IID)
	_ = p.addNote(ctx, it, fmt.Sprintf(
		"AgentOps: agent run failed; re-queued to %s (attempt %d/%d).",
		trigger, n, p.maxRetries))
	p.logger.Info("recover: re-queued failed card",
		"iid", it.IID, "to", trigger, "attempt", n, "max", p.maxRetries)
}

// addNote posts a comment to the item via the GitLab REST notes endpoint.
func (p *Poller) addNote(ctx context.Context, it glItem, body string) error {
	endpoint := fmt.Sprintf("%s/api/v4/projects/%d/%s/%d/notes",
		p.baseURL, it.ProjectID, p.target, it.IID)

	q := url.Values{}
	q.Set("body", body)
	reqURL := endpoint + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", p.token)
	req.Header.Set("Accept", "application/json")

	resp, err := p.http.Do(req)
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("gitlab API %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	return nil
}

// bumpAttempts increments and returns the recovery attempt count for an iid.
func (p *Poller) bumpAttempts(iid int) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.attempts[iid]++
	return p.attempts[iid]
}

// clearAttempts resets the recovery budget for an iid (called on success).
func (p *Poller) clearAttempts(iid int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.attempts, iid)
	delete(p.gaveUp, iid)
}

// markGaveUp records that the human-attention note has been posted for an iid,
// returning true only the first time so the note is posted exactly once.
func (p *Poller) markGaveUp(iid int) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.gaveUp[iid] {
		return false
	}
	p.gaveUp[iid] = true
	return true
}

// clearSeen drops any seen-set entries for an iid so a re-queued card can fire
// again immediately instead of waiting out the TTL window.
func (p *Poller) clearSeen(iid int) {
	suffix := fmt.Sprintf("#%d", iid)
	p.mu.Lock()
	defer p.mu.Unlock()
	for k := range p.seen {
		if strings.HasSuffix(k, suffix) {
			delete(p.seen, k)
		}
	}
}

func (p *Poller) seenKey(iid int, label string) string {
	return fmt.Sprintf("%s/%s#%d", p.target, label, iid)
}

func (p *Poller) alreadySeen(key string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, ok := p.seen[key]
	return ok
}

func (p *Poller) markSeen(key string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.seen[key] = time.Now()
}

func (p *Poller) purgeExpired() {
	now := time.Now()
	p.mu.Lock()
	defer p.mu.Unlock()
	for k, t := range p.seen {
		if now.Sub(t) > p.ttl {
			delete(p.seen, k)
		}
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func parseCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
