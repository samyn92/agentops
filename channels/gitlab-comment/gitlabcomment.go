// Package gitlabcomment implements the GitLab comment-driven planning channel.
//
// Where the gitlab-label bridge reacts to LABELS, this bridge reacts to issue
// COMMENTS. It polls the GitLab REST API (zero external dependencies — stdlib
// net/http with a PRIVATE-TOKEN header) for issues carrying the planning label
// (default agent::planning) and, for each, inspects the comment thread. When a
// human leaves a comment that the planner agent has not yet answered, it prompts
// the (daemon) planner so it can refine the PLAN — i.e. the issue description —
// and reply in the thread.
//
// Trigger semantics are derived purely from GitLab state, so they survive bridge
// restarts without a persisted cursor: a human note is "unaddressed" when its id
// is greater than the planner's most recent note id (the planner's last turn).
// Once the planner replies, its note id rises above the human note and the item
// stops matching. A short in-memory suppression window prevents double-dispatch
// in the gap between firing and the planner posting its reply.
package gitlabcomment

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
	"time"

	"github.com/samyn92/agentops/channels/internal/bridge"
)

// Poller polls GitLab planning issues for unanswered human comments and prompts
// the planner daemon to refine the plan.
type Poller struct {
	cfg    *bridge.Config
	client *bridge.AgentClient
	http   *http.Client
	logger *slog.Logger

	baseURL string
	project string // project path (project-scoped); mutually exclusive with group
	group   string // group path (group-scoped)
	token   string
	state   string

	// planningLabel scopes which issues this bridge watches. Only issues
	// carrying it are inspected for new comments, so the bridge never polls the
	// entire backlog's comment threads.
	planningLabel string

	// botID/botUser identify the token's own user so the planner's own notes
	// (posted with the same integration token) are never mistaken for a human
	// comment — which would otherwise create an infinite self-reply loop.
	botID   int64
	botUser string

	// firedAt suppresses re-dispatch for an iid while a fire is in flight, keyed
	// by the human-comment frontier it was fired for. It auto-resolves when the
	// planner replies (its note rises above the frontier) or after suppressTTL.
	firedAt     map[int]firedRec
	suppressTTL time.Duration
}

type firedRec struct {
	humanMax int64
	at       time.Time
}

// New builds a gitlab-comment poller from the shared bridge config plus the
// GitLab-specific env vars set by the operator.
func New(cfg *bridge.Config, interval time.Duration, logger *slog.Logger) *Poller {
	ttl := 3 * interval
	if ttl < 2*time.Minute {
		ttl = 2 * time.Minute
	}
	return &Poller{
		cfg:           cfg,
		client:        bridge.NewAgentClient(logger),
		http:          &http.Client{Timeout: 20 * time.Second},
		logger:        logger,
		baseURL:       strings.TrimRight(os.Getenv("GITLAB_BASE_URL"), "/"),
		project:       os.Getenv("GITLAB_PROJECT"),
		group:         os.Getenv("GITLAB_GROUP"),
		token:         os.Getenv("GITLAB_TOKEN"),
		state:         envOrDefault("GITLAB_STATE", "opened"),
		planningLabel: envOrDefault("GITLAB_PLANNING_LABEL", "agent::planning"),
		firedAt:       make(map[int]firedRec),
		suppressTTL:   ttl,
	}
}

// glIssue is the subset of a GitLab issue REST object we care about. The list
// endpoint returns the description and labels inline.
type glIssue struct {
	IID         int      `json:"iid"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	WebURL      string   `json:"web_url"`
	State       string   `json:"state"`
	ProjectID   int      `json:"project_id"`
	Labels      []string `json:"labels"`
}

// glNote is the subset of a GitLab note (comment) object we care about.
type glNote struct {
	ID     int64  `json:"id"`
	Body   string `json:"body"`
	System bool   `json:"system"`
	Author struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
		Name     string `json:"name"`
	} `json:"author"`
	CreatedAt string `json:"created_at"`
}

// Poll runs one cycle: ensure bot identity is known, list planning issues, and
// for each fire the planner if there is an unanswered human comment.
func (p *Poller) Poll(ctx context.Context) {
	if p.token == "" {
		p.logger.Error("GITLAB_TOKEN not set; cannot poll")
		return
	}
	if p.baseURL == "" || (p.project == "" && p.group == "") {
		p.logger.Error("GitLab base URL / project / group not configured")
		return
	}
	if !p.cfg.IsDaemon() {
		p.logger.Error("gitlab-comment requires a daemon planner agent; AGENT_MODE is not daemon")
		return
	}

	// Bot identity is mandatory: without it we cannot distinguish the planner's
	// own notes from a human's and would self-loop. Skip the whole cycle until
	// it resolves rather than risk a runaway reply storm.
	if err := p.ensureBotIdentity(ctx); err != nil {
		p.logger.Error("cannot resolve bot identity; skipping poll", "error", err)
		return
	}

	issues, err := p.listPlanningIssues(ctx)
	if err != nil {
		p.logger.Error("list planning issues failed", "error", err)
		return
	}
	p.purgeStale(issues)

	for _, it := range issues {
		if ctx.Err() != nil {
			return
		}
		p.pollIssue(ctx, it)
	}
}

// ensureBotIdentity fetches and caches GET /user (the token's own user) so the
// planner's notes can be filtered out of the human-comment detection.
func (p *Poller) ensureBotIdentity(ctx context.Context) error {
	if p.botID != 0 {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/api/v4/user", nil)
	if err != nil {
		return err
	}
	req.Header.Set("PRIVATE-TOKEN", p.token)
	req.Header.Set("Accept", "application/json")
	resp, err := p.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("gitlab API %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var u struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return err
	}
	if u.ID == 0 {
		return fmt.Errorf("gitlab /user returned no id")
	}
	p.botID, p.botUser = u.ID, u.Username
	p.logger.Info("resolved bot identity", "id", u.ID, "username", u.Username)
	return nil
}

// listPlanningIssues fetches issues carrying the planning label, project- or
// group-scoped depending on configuration.
func (p *Poller) listPlanningIssues(ctx context.Context) ([]glIssue, error) {
	var scope, scopePath string
	if p.project != "" {
		scope, scopePath = "projects", p.project
	} else {
		scope, scopePath = "groups", p.group
	}
	endpoint := fmt.Sprintf("%s/api/v4/%s/%s/issues",
		p.baseURL, scope, url.QueryEscape(scopePath))

	q := url.Values{}
	q.Set("labels", p.planningLabel)
	q.Set("state", p.state)
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
	var issues []glIssue
	if err := json.NewDecoder(resp.Body).Decode(&issues); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return issues, nil
}

// pollIssue inspects one planning issue's thread and fires the planner when a
// human comment is newer than the planner's last reply.
func (p *Poller) pollIssue(ctx context.Context, it glIssue) {
	notes, err := p.listNotes(ctx, it.ProjectID, it.IID)
	if err != nil {
		p.logger.Error("list notes failed", "iid", it.IID, "error", err)
		return
	}

	// The planner's last turn = highest id among its own (non-system) notes.
	// A human note is "unaddressed" only if it lands after that.
	var lastPlannerNote int64
	for _, n := range notes {
		if n.System {
			continue
		}
		if p.isBot(n) && n.ID > lastPlannerNote {
			lastPlannerNote = n.ID
		}
	}

	var unaddressed []glNote
	var humanMax int64
	for _, n := range notes {
		if n.System || p.isBot(n) {
			continue
		}
		if n.ID <= lastPlannerNote {
			continue // the planner already replied after this comment
		}
		unaddressed = append(unaddressed, n)
		if n.ID > humanMax {
			humanMax = n.ID
		}
	}

	if len(unaddressed) == 0 {
		delete(p.firedAt, it.IID) // planner has caught up; clear suppression
		return
	}

	// Suppress re-dispatch for the same human-comment frontier while the planner
	// is still working, unless the suppression window has expired (planner may
	// have failed to reply, so allow a retry).
	if rec, ok := p.firedAt[it.IID]; ok && rec.humanMax == humanMax && time.Since(rec.at) < p.suppressTTL {
		return
	}

	if err := p.fire(ctx, it, unaddressed); err != nil {
		p.logger.Error("fire planner failed", "iid", it.IID, "error", err)
		return // do not record; retry on the next tick
	}
	p.firedAt[it.IID] = firedRec{humanMax: humanMax, at: time.Now()}
}

// listNotes returns an issue's comment thread, oldest first.
func (p *Poller) listNotes(ctx context.Context, projectID, iid int) ([]glNote, error) {
	endpoint := fmt.Sprintf("%s/api/v4/projects/%d/issues/%d/notes",
		p.baseURL, projectID, iid)
	q := url.Values{}
	q.Set("sort", "asc")
	q.Set("order_by", "created_at")
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
	var notes []glNote
	if err := json.NewDecoder(resp.Body).Decode(&notes); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return notes, nil
}

// fire renders the planner prompt for the unanswered comments and dispatches it
// to the daemon planner.
func (p *Poller) fire(ctx context.Context, it glIssue, unaddressed []glNote) error {
	iidStr := strconv.Itoa(it.IID)
	projectRef := p.project
	if projectRef == "" {
		projectRef = strconv.Itoa(it.ProjectID)
	}

	var b strings.Builder
	for _, n := range unaddressed {
		who := n.Author.Username
		if who == "" {
			who = n.Author.Name
		}
		fmt.Fprintf(&b, "@%s: %s\n", who, strings.TrimSpace(n.Body))
	}
	newComments := strings.TrimSpace(b.String())

	data := map[string]interface{}{
		"channel": p.cfg.ChannelName,
		"agent":   p.cfg.AgentRef,
		"gitlab": map[string]interface{}{
			"target":      "issues",
			"iid":         iidStr,
			"project":     projectRef,
			"web_url":     it.WebURL,
			"title":       it.Title,
			"description": it.Description,
			"label":       p.planningLabel,
			"state":       it.State,
		},
		"new_comments": newComments,
	}

	prompt, err := bridge.RenderPrompt(p.cfg.PromptTemplate, data)
	if err != nil {
		return fmt.Errorf("render prompt: %w", err)
	}

	metadata := map[string]string{
		"channel": p.cfg.ChannelName,
		"type":    "gitlab-comment",
		"iid":     iidStr,
		"target":  "issues",
		"project": projectRef,
	}

	p.logger.Info("firing planner for unanswered comment",
		"iid", it.IID, "comments", len(unaddressed), "title", it.Title)
	return p.client.PromptDaemon(ctx, p.cfg.AgentURL, prompt, metadata, nil)
}

func (p *Poller) isBot(n glNote) bool {
	return n.Author.ID == p.botID || (p.botUser != "" && n.Author.Username == p.botUser)
}

// purgeStale drops suppression entries for issues that no longer carry the
// planning label (e.g. handed off to agent::todo or closed).
func (p *Poller) purgeStale(issues []glIssue) {
	live := make(map[int]bool, len(issues))
	for _, it := range issues {
		live[it.IID] = true
	}
	for iid := range p.firedAt {
		if !live[iid] {
			delete(p.firedAt, iid)
		}
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
