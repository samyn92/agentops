// HTTP handlers for the console backend API.
package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/samyn92/agentops/internal/console/auth"
	"github.com/samyn92/agentops/internal/console/k8s"
	"github.com/samyn92/agentops/internal/console/multiplexer"
)

// Handlers holds all HTTP handler methods.
type Handlers struct {
	k8s  *k8s.Client
	mux  *multiplexer.Multiplexer
	auth *auth.AuthManager // nil when OIDC is disabled
}

// tracer is used to emit per-SSE-event child spans so delegation results and
// other FEP events show up in Tempo live — without waiting for the long-lived
// parent stream span to close (which only happens at client disconnect).
var tracer = otel.Tracer("agentops-console/handlers")

// sanitizePathParam rejects path parameters that contain path traversal characters.
// This prevents URL path injection when the param is interpolated into upstream URLs.
func sanitizePathParam(param string) bool {
	return !strings.Contains(param, "/") && !strings.Contains(param, "..") && param != ""
}

// New creates a new Handlers instance. auth may be nil (OIDC disabled).
func New(k8sClient *k8s.Client, mux *multiplexer.Multiplexer, auth *auth.AuthManager) *Handlers {
	return &Handlers{
		k8s:  k8sClient,
		mux:  mux,
		auth: auth,
	}
}

// userTokenOrFallback returns the logged-in user's GitLab access token if OIDC
// is enabled and the user has a valid session, else returns empty string. Write
// actions (merge, approve, comment) should prefer the user's token so GitLab
// records the action under the human's identity, not the agent bot's.
func (h *Handlers) userTokenOrFallback(w http.ResponseWriter, r *http.Request) string {
	if h.auth == nil {
		return ""
	}
	tok, err := h.auth.UserAccessToken(w, r)
	if err != nil {
		slog.Debug("user token unavailable, falling back to bot token", "error", err)
		return ""
	}
	return tok
}

// userToken returns the user's OIDC access token from request context (set by
// the RequireAuth middleware). When OIDC is disabled returns "". This is the
// primary token source in the multi-tenant model — ALL GitLab reads use this.
func (h *Handlers) userToken(r *http.Request) string {
	return auth.TokenFromContext(r.Context())
}

// gitlabBaseURL returns the GitLab base URL. Reads from env or defaults to
// https://gitlab.com. Used by workspace discovery and OIDC-proxied routes that
// don't go through an Integration CRD.
func gitlabBaseURL() string {
	if v := os.Getenv("GITLAB_BASE_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://gitlab.com"
}

// setGitLabAuth sets the appropriate authentication header on a GitLab API
// request. OAuth2 tokens (from OIDC) use "Authorization: Bearer", while
// Personal/Group/Project Access Tokens use "PRIVATE-TOKEN". We detect which one
// by checking if the token matches the user's OIDC token from request context.
func setGitLabAuth(req *http.Request, token string, ctx context.Context) {
	userToken := auth.TokenFromContext(ctx)
	if userToken != "" && token == userToken {
		// OAuth2 access token from OIDC — use Bearer header.
		req.Header.Set("Authorization", "Bearer "+token)
	} else {
		// Personal/Group/Project Access Token — use PRIVATE-TOKEN header.
		req.Header.Set("PRIVATE-TOKEN", token)
	}
}

// ── Agent endpoints ──

func (h *Handlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := h.k8s.ListAgents(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agents: %s", err)
		return
	}

	type delegationResponse struct {
		Team      []string `json:"team"`
		MaxFanOut int      `json:"maxFanOut,omitempty"`
	}

	type agentResponse struct {
		Name       string              `json:"name"`
		Namespace  string              `json:"namespace"`
		Mode       string              `json:"mode"`
		Model      string              `json:"model"`
		Image      string              `json:"image"`
		Phase      string              `json:"phase"`
		Ready      int32               `json:"readyReplicas"`
		Schedule   string              `json:"schedule,omitempty"`
		Delegation *delegationResponse `json:"delegation,omitempty"`
	}

	resp := make([]agentResponse, 0, len(agents.Items))
	for _, a := range agents.Items {
		ar := agentResponse{
			Name:      a.Name,
			Namespace: a.Namespace,
			Mode:      string(a.Spec.Mode),
			Model:     a.Spec.Model,
			Image:     a.Spec.Image,
			Phase:     string(a.Status.Phase),
			Ready:     a.Status.ReadyReplicas,
			Schedule:  a.Spec.Schedule,
		}
		if a.Spec.Delegation != nil {
			ar.Delegation = &delegationResponse{
				Team:      a.Spec.Delegation.Team,
				MaxFanOut: a.Spec.Delegation.MaxFanOut,
			}
		}
		resp = append(resp, ar)
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	writeJSON(w, http.StatusOK, agent)
}

// GetAgentConfig returns the operator-generated runtime config (from the agent's ConfigMap).
// This includes the platformProtocol field that is not stored on the CRD itself.
func (h *Handlers) GetAgentConfig(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	cmName := name + "-config"
	cm, err := h.k8s.GetConfigMap(r.Context(), ns, cmName)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent config not found: %s", err)
		return
	}

	raw, ok := cm.Data["config.json"]
	if !ok {
		writeError(w, http.StatusNotFound, "config.json key not found in ConfigMap %s", cmName)
		return
	}

	// Return the raw JSON directly (it's already valid JSON from the operator)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, raw)
}

func (h *Handlers) GetAgentStatus(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	// Task agents have no long-running pod — return a synthetic status
	if agent.Spec.Mode == "task" {
		writeJSON(w, http.StatusOK, map[string]any{
			"mode":   "task",
			"status": "ready",
		})
		return
	}

	// Proxy to agent runtime /status
	url := h.k8s.GetAgentServiceURL(agent)
	resp, err := proxyGET(r.Context(), url+"/status")
	if err != nil {
		writeError(w, http.StatusBadGateway, "agent unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// ── Agent conversation endpoints (proxied to runtime) ──

func (h *Handlers) AgentPrompt(w http.ResponseWriter, r *http.Request) {
	h.proxyToAgent(w, r, "POST", "/prompt", r.Body)
}

func (h *Handlers) AgentSteer(w http.ResponseWriter, r *http.Request) {
	h.proxyToAgent(w, r, "POST", "/steer", r.Body)
}

func (h *Handlers) AgentAbort(w http.ResponseWriter, r *http.Request) {
	h.proxyToAgent(w, r, "DELETE", "/abort", nil)
}

// AgentGetWorkingMemory returns the current messages in the agent's working memory.
func (h *Handlers) AgentGetWorkingMemory(w http.ResponseWriter, r *http.Request) {
	h.proxyToAgent(w, r, "GET", "/working-memory", nil)
}

// AgentMemoryExtract proxies AI-assisted memory extraction to the agent runtime.
// The runtime reads its working memory, calls its model, and returns a structured observation.
func (h *Handlers) AgentMemoryExtract(w http.ResponseWriter, r *http.Request) {
	h.proxyToAgent(w, r, "POST", "/memory/extract", r.Body)
}

// AgentPromptStream proxies a streaming prompt to the agent runtime.
// FEP events are delivered globally via NATS; this handler only relays to the requesting client.
func (h *Handlers) AgentPromptStream(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	// Parent span for the whole SSE relay. This closes when the client
	// disconnects — don't rely on it for live visibility; we emit short
	// child spans per FEP event below so they flush through the batcher
	// while the long-lived parent is still open.
	ctx, parentSpan := tracer.Start(r.Context(), "agent.prompt.stream",
		trace.WithAttributes(
			attribute.String("agent.namespace", ns),
			attribute.String("agent.name", name),
		),
	)
	defer parentSpan.End()
	r = r.WithContext(ctx)

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	baseURL := h.k8s.GetAgentServiceURL(agent)
	url := fmt.Sprintf("%s/prompt/stream", baseURL)

	// Read the request body so we can forward it (capped at 1 MiB)
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body: %s", err)
		return
	}

	// Create proxy request
	proxyReq, err := http.NewRequestWithContext(r.Context(), "POST", url, bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create request: %s", err)
		return
	}
	proxyReq.Header.Set("Content-Type", "application/json")
	proxyReq.Header.Set("Accept", "text/event-stream")
	// Propagate W3C trace context to agent runtime for distributed tracing
	otel.GetTextMapPropagator().Inject(r.Context(), propagation.HeaderCarrier(proxyReq.Header))

	client := &http.Client{Timeout: 0} // no timeout for SSE
	resp, err := client.Do(proxyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "agent unreachable: %s", err)
		return
	}

	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		proxyResponse(w, resp)
		return
	}

	// Set SSE headers on our response
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Relay SSE events to the requesting client.
	// Global delivery to other browser tabs is handled by the NATS subscriber
	// in the multiplexer — no need to inject into eventC here.
	scanner := newSSEScanner(resp.Body)
	eventCount := 0
	for scanner.Scan() {
		data := scanner.Data()
		if data == "" {
			continue
		}

		// Peek at the event type to emit a short-lived child span. These
		// close immediately and are exported by the SDK batcher even while
		// the parent SSE span is still open, giving live visibility in
		// Tempo for delegation results, tool calls, stream finish, etc.
		// Deltas are high-frequency — we skip them to avoid span spam.
		var peek struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal([]byte(data), &peek)
		if peek.Type != "" && !isHighFrequencyFEPEvent(peek.Type) {
			_, evSpan := tracer.Start(ctx, "fep.event."+peek.Type,
				trace.WithAttributes(
					attribute.String("fep.event.type", peek.Type),
					attribute.Int("fep.event.index", eventCount),
				),
			)
			evSpan.End()
		}
		eventCount++

		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	parentSpan.SetAttributes(attribute.Int("fep.event.count", eventCount))
	resp.Body.Close()
}

// isHighFrequencyFEPEvent returns true for FEP event types that fire many
// times per prompt (e.g. per-token streaming). We skip span emission for
// these to keep trace volume sane; their presence is still reflected in
// the parent span's fep.event.count attribute.
func isHighFrequencyFEPEvent(t string) bool {
	switch t {
	case "text_delta", "reasoning_delta", "tool_input_delta":
		return true
	}
	return false
}

// ── Interactive control ──

func (h *Handlers) ReplyToPermission(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "pid")
	h.proxyToAgent(w, r, "POST", fmt.Sprintf("/permission/%s/reply", pid), r.Body)
}

func (h *Handlers) ReplyToQuestion(w http.ResponseWriter, r *http.Request) {
	qid := chi.URLParam(r, "qid")
	h.proxyToAgent(w, r, "POST", fmt.Sprintf("/question/%s/reply", qid), r.Body)
}

// ── AgentRun endpoints ──

func (h *Handlers) ListAgentRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := h.k8s.ListAgentRuns(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agent runs: %s", err)
		return
	}
	writeJSON(w, http.StatusOK, runs.Items)
}

func (h *Handlers) GetAgentRun(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	run, err := h.k8s.GetAgentRun(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent run not found: %s", err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// ── Channel endpoints ──

func (h *Handlers) ListChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := h.k8s.ListChannels(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channels: %s", err)
		return
	}
	writeJSON(w, http.StatusOK, channels.Items)
}

func (h *Handlers) GetChannel(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	ch, err := h.k8s.GetChannel(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "channel not found: %s", err)
		return
	}
	writeJSON(w, http.StatusOK, ch)
}

// ── Kubernetes resource endpoints ──

func (h *Handlers) ListNamespaces(w http.ResponseWriter, r *http.Request) {
	nsList, err := h.k8s.ListNamespaces(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list namespaces: %s", err)
		return
	}

	type nsInfo struct {
		Name   string `json:"name"`
		Status string `json:"status"`
	}

	resp := make([]nsInfo, 0, len(nsList.Items))
	for _, ns := range nsList.Items {
		resp = append(resp, nsInfo{
			Name:   ns.Name,
			Status: string(ns.Status.Phase),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handlers) ListPods(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")

	pods, err := h.k8s.ListPods(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list pods: %s", err)
		return
	}

	type podInfo struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
		Phase     string `json:"phase"`
		Ready     string `json:"ready"`
		Node      string `json:"node"`
	}

	resp := make([]podInfo, 0, len(pods.Items))
	for _, p := range pods.Items {
		readyCount := 0
		for _, cs := range p.Status.ContainerStatuses {
			if cs.Ready {
				readyCount++
			}
		}
		resp = append(resp, podInfo{
			Name:      p.Name,
			Namespace: p.Namespace,
			Phase:     string(p.Status.Phase),
			Ready:     fmt.Sprintf("%d/%d", readyCount, len(p.Spec.Containers)),
			Node:      p.Spec.NodeName,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

// ── K8s resource watch (SSE) ──

func (h *Handlers) WatchResources(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	unsubscribe := h.k8s.Watcher().Subscribe(func(event k8s.ResourceEvent) {
		data, err := json.Marshal(map[string]string{
			"type":         string(event.Type),
			"resourceKind": event.ResourceKind,
			"namespace":    event.Namespace,
			"name":         event.Name,
		})
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: resource.changed\ndata: %s\n\n", data)
		flusher.Flush()
	})
	defer unsubscribe()

	// Send connected event
	fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
	flusher.Flush()

	// Block until client disconnects
	<-r.Context().Done()
}

// ── Memory (agentops-memory) endpoints ──

// MemoryEnabled checks if an agent has memory configured.
func (h *Handlers) MemoryEnabled(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	enabled := agent.Spec.Memory != nil && agent.Spec.Memory.ServerRef != ""
	project := name
	if agent.Spec.Memory != nil && agent.Spec.Memory.Project != "" {
		project = agent.Spec.Memory.Project
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": enabled,
		"project": project,
	})
}

// ListMemoryObservations returns recent observations for an agent from agentops-memory.
func (h *Handlers) ListMemoryObservations(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	extra := map[string]string{}
	if limit := r.URL.Query().Get("limit"); limit != "" {
		extra["limit"] = limit
	}
	if obsType := r.URL.Query().Get("type"); obsType != "" {
		extra["type"] = obsType
	}
	if scope := r.URL.Query().Get("scope"); scope != "" {
		extra["scope"] = scope
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "GET", "/observations/recent", nil, extra)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// GetMemoryObservation returns a single observation by ID from agentops-memory.
func (h *Handlers) GetMemoryObservation(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")
	obsID := chi.URLParam(r, "obsId")

	if !sanitizePathParam(obsID) {
		writeError(w, http.StatusBadRequest, "invalid observation ID")
		return
	}

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "GET", fmt.Sprintf("/observations/%s", obsID), nil, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// CreateMemoryObservation creates a new observation in agentops-memory for an agent.
// The request body should contain: { type, title, content, tags?, scope?, topic_key? }
// session_id and project are injected automatically.
func (h *Handlers) CreateMemoryObservation(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	// Read body, decode, inject project, re-encode (capped at 1 MiB)
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body: %s", err)
		return
	}

	var obs map[string]any
	if err := json.Unmarshal(body, &obs); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: %s", err)
		return
	}

	// Inject project (scoped to agent name)
	project := name
	if agent.Spec.Memory != nil && agent.Spec.Memory.Project != "" {
		project = agent.Spec.Memory.Project
	}
	obs["project"] = project

	// agentops-memory enforces a FK from observations -> sessions, so the session must exist.
	// For user-created observations from the console ("Remember this", "Extract from
	// conversation"), we use a synthetic console session and ensure it exists.
	if _, ok := obs["session_id"]; !ok {
		sessionID := fmt.Sprintf("console-%s-%s", ns, name)
		obs["session_id"] = sessionID

		// Ensure the console session exists (idempotent — ignore errors if it already exists)
		sessionBody, _ := json.Marshal(map[string]string{
			"id":      sessionID,
			"project": project,
		})
		resp, err := proxyToMemory(r.Context(), h.k8s, agent, "POST", "/sessions", strings.NewReader(string(sessionBody)), nil)
		if err != nil {
			slog.Debug("failed to ensure console session", "error", err)
		} else {
			resp.Body.Close()
		}
	}

	encoded, _ := json.Marshal(obs)

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "POST", "/observations", strings.NewReader(string(encoded)), nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// UpdateMemoryObservation updates an observation by ID in agentops-memory.
func (h *Handlers) UpdateMemoryObservation(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")
	obsID := chi.URLParam(r, "obsId")

	if !sanitizePathParam(obsID) {
		writeError(w, http.StatusBadRequest, "invalid observation ID")
		return
	}

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "PATCH", fmt.Sprintf("/observations/%s", obsID), r.Body, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// DeleteMemoryObservation deletes an observation by ID from agentops-memory.
func (h *Handlers) DeleteMemoryObservation(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")
	obsID := chi.URLParam(r, "obsId")

	if !sanitizePathParam(obsID) {
		writeError(w, http.StatusBadRequest, "invalid observation ID")
		return
	}

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	extra := map[string]string{}
	if hard := r.URL.Query().Get("hard"); hard == "true" {
		extra["hard"] = "true"
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "DELETE", fmt.Sprintf("/observations/%s", obsID), nil, extra)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// SearchMemory searches observations in agentops-memory for an agent.
func (h *Handlers) SearchMemory(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	extra := map[string]string{}
	if q := r.URL.Query().Get("q"); q != "" {
		extra["q"] = q
	}
	if limit := r.URL.Query().Get("limit"); limit != "" {
		extra["limit"] = limit
	}
	if obsType := r.URL.Query().Get("type"); obsType != "" {
		extra["type"] = obsType
	}
	if scope := r.URL.Query().Get("scope"); scope != "" {
		extra["scope"] = scope
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "GET", "/search", nil, extra)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// GetMemoryContext returns the recent memory context for an agent from agentops-memory.
func (h *Handlers) GetMemoryContext(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	extra := map[string]string{}
	if scope := r.URL.Query().Get("scope"); scope != "" {
		extra["scope"] = scope
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "GET", "/context", nil, extra)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// GetMemoryStats returns memory statistics from agentops-memory.
func (h *Handlers) GetMemoryStats(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "GET", "/stats", nil, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// ListMemorySessions returns recent sessions (work periods) for an agent.
func (h *Handlers) ListMemorySessions(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	extra := map[string]string{}
	if limit := r.URL.Query().Get("limit"); limit != "" {
		extra["limit"] = limit
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "GET", "/sessions/recent", nil, extra)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// GetMemoryTimeline returns chronological context around an observation.
func (h *Handlers) GetMemoryTimeline(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	extra := map[string]string{}
	if obsID := r.URL.Query().Get("observation_id"); obsID != "" {
		extra["observation_id"] = obsID
	}
	if before := r.URL.Query().Get("before"); before != "" {
		extra["before"] = before
	}
	if after := r.URL.Query().Get("after"); after != "" {
		extra["after"] = after
	}

	resp, err := proxyToMemory(r.Context(), h.k8s, agent, "GET", "/timeline", nil, extra)
	if err != nil {
		writeError(w, http.StatusBadGateway, "memory service unreachable: %s", err)
		return
	}
	defer resp.Body.Close()
	proxyResponse(w, resp)
}

// ── Agent proxy helper ──

func (h *Handlers) proxyToAgent(w http.ResponseWriter, r *http.Request, method, path string, body io.Reader) {
	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	agent, err := h.k8s.GetAgent(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found: %s", err)
		return
	}

	baseURL := h.k8s.GetAgentServiceURL(agent)
	url := baseURL + path

	proxyReq, err := http.NewRequestWithContext(r.Context(), method, url, body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create request: %s", err)
		return
	}
	if body != nil {
		proxyReq.Header.Set("Content-Type", "application/json")
	}
	// Propagate W3C trace context to agent runtime for distributed tracing
	otel.GetTextMapPropagator().Inject(r.Context(), propagation.HeaderCarrier(proxyReq.Header))

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(proxyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "agent unreachable: %s", err)
		return
	}
	defer resp.Body.Close()

	proxyResponse(w, resp)
}

// ── SSE scanner ──

type sseScanner struct {
	body    io.ReadCloser
	buf     []byte
	readBuf []byte // reusable read buffer
	data    string
}

func newSSEScanner(body io.ReadCloser) *sseScanner {
	return &sseScanner{body: body, readBuf: make([]byte, 32*1024)}
}

func (s *sseScanner) Scan() bool {
	for {
		// Drain complete frames from the buffer BEFORE blocking on Read().
		// Multiple SSE frames may arrive in a single TCP segment; returning
		// them immediately prevents stalls during fast event bursts (e.g.
		// tool_input_delta → tool_input_end → tool_call).
		for {
			idx := bytes.Index(s.buf, []byte("\n\n"))
			if idx < 0 {
				break
			}
			frame := string(s.buf[:idx])
			s.buf = s.buf[idx+2:]

			// Extract data line
			for _, line := range strings.Split(frame, "\n") {
				if len(line) > 6 && line[:6] == "data: " {
					s.data = line[6:]
					return true
				}
			}
		}

		// No complete frames in buffer — read more from upstream.
		n, err := s.body.Read(s.readBuf)
		if n > 0 {
			s.buf = append(s.buf, s.readBuf[:n]...)
		}
		if err != nil {
			// On EOF, try to parse any remaining buffer as a final frame.
			// The upstream may close without a trailing \n\n.
			if len(s.buf) > 0 {
				frame := string(s.buf)
				s.buf = nil
				for _, line := range strings.Split(strings.TrimRight(frame, "\n"), "\n") {
					if len(line) > 6 && line[:6] == "data: " {
						s.data = line[6:]
						return true
					}
				}
			}
			return false
		}
	}
}

func (s *sseScanner) Data() string {
	return s.data
}

// ── Response helpers ──

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to encode response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func proxyGET(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	return http.DefaultClient.Do(req)
}

func proxyResponse(w http.ResponseWriter, resp *http.Response) {
	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
