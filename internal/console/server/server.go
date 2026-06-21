// HTTP server with chi router, middleware, CORS, and optional GitLab OIDC auth.
package server

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/riandyrn/otelchi"

	"github.com/samyn92/agentops/internal/console/auth"
	"github.com/samyn92/agentops/internal/console/handlers"
	"github.com/samyn92/agentops/internal/console/k8s"
	"github.com/samyn92/agentops/internal/console/multiplexer"
)

// Config holds server configuration.
type Config struct {
	Addr   string // listen address, e.g. ":8080"
	Dev    bool   // development mode (relaxed CORS)
	WebDir string // path to static web assets (empty = no static serving)
}

// Server is the console backend HTTP server.
type Server struct {
	cfg  Config
	http *http.Server
}

// New creates a new server with all routes configured.
func New(cfg Config, k8sClient *k8s.Client, mux *multiplexer.Multiplexer) *Server {
	r := chi.NewRouter()

	// ── Middleware ──
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(otelchi.Middleware("agentops-console", otelchi.WithChiRoutes(r)))

	// CORS
	corsOpts := cors.Options{
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type", "X-Requested-With"},
		AllowCredentials: true,
		MaxAge:           300,
	}
	if cfg.Dev {
		corsOpts.AllowedOrigins = []string{"*"}
	}
	r.Use(cors.Handler(corsOpts))

	// ── GitLab OIDC auth (optional — disabled when env vars are absent) ──
	var authProvider *auth.Auth
	if authCfg := auth.ConfigFromEnv(); authCfg != nil {
		var err error
		authProvider, err = auth.New(authCfg)
		if err != nil {
			slog.Error("failed to initialize GitLab OIDC auth", "error", err)
		} else {
			slog.Info("GitLab OIDC auth enabled",
				"clientID", authCfg.ClientID,
				"redirectURL", authCfg.RedirectURL,
				"baseURL", authCfg.BaseURL,
			)
		}
	} else {
		slog.Info("GitLab OIDC auth disabled (GITLAB_OAUTH_CLIENT_ID not set)")
	}

	// Auth routes (outside /api/v1 — the browser hits these directly).
	if authProvider != nil {
		r.Get("/auth/login", authProvider.HandleLogin)
		r.Get("/auth/callback", authProvider.HandleCallback)
		r.Post("/auth/logout", authProvider.HandleLogout)
		r.Get("/auth/logout", authProvider.HandleLogout)
		r.Get("/auth/me", authProvider.HandleMe)
	} else {
		// When auth is disabled, /auth/me returns a synthetic unauthenticated
		// response so the frontend can detect "no auth configured" and skip
		// the login UI gracefully.
		r.Get("/auth/me", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"authenticated":false,"authDisabled":true}`))
		})
	}

	// ── Handlers ──
	h := handlers.New(k8sClient, mux, authProvider)

	r.Route("/api/v1", func(r chi.Router) {
		// Login wall: when OIDC is configured, all API routes require a valid
		// session. Unauthenticated requests get 401; the frontend redirects to
		// /auth/login. This also injects the user's GitLab access token into
		// request context (auth.TokenFromContext) for downstream handlers.
		if authProvider != nil {
			r.Use(authProvider.RequireAuth)
		}

		// SSE / streaming endpoints (no timeout — long-lived connections)
		r.Group(func(r chi.Router) {
			r.Get("/events", mux.ServeGlobalSSE)
			r.Get("/watch", h.WatchResources)
			r.Post("/agents/{ns}/{name}/stream", h.AgentPromptStream)
		})

		// REST endpoints (with timeout)
		r.Group(func(r chi.Router) {
			r.Use(chimw.Timeout(60 * time.Second))

			// User-scoped workspace discovery (multi-tenant OIDC)
			r.Get("/workspaces", h.ListWorkspaces)

			// Agents
			r.Get("/agents", h.ListAgents)
			r.Get("/agents/{ns}/{name}", h.GetAgent)
			r.Get("/agents/{ns}/{name}/config", h.GetAgentConfig)
			r.Get("/agents/{ns}/{name}/status", h.GetAgentStatus)

			// Agent conversation (proxied to agent runtime — sessionless)
			r.Post("/agents/{ns}/{name}/prompt", h.AgentPrompt)
			r.Post("/agents/{ns}/{name}/steer", h.AgentSteer)
			r.Delete("/agents/{ns}/{name}/abort", h.AgentAbort)

			// Agent live config (proxied to agent runtime)
			r.Get("/agents/{ns}/{name}/working-memory", h.AgentGetWorkingMemory)
			r.Post("/agents/{ns}/{name}/memory/extract", h.AgentMemoryExtract)

			// Interactive control (proxied to agent runtime)
			r.Post("/agents/{ns}/{name}/permission/{pid}/reply", h.ReplyToPermission)
			r.Post("/agents/{ns}/{name}/question/{qid}/reply", h.ReplyToQuestion)

			// Agent memory (proxied to agentops-memory)
			r.Get("/agents/{ns}/{name}/memory/enabled", h.MemoryEnabled)
			r.Get("/agents/{ns}/{name}/memory/observations", h.ListMemoryObservations)
			r.Get("/agents/{ns}/{name}/memory/observations/{obsId}", h.GetMemoryObservation)
			r.Post("/agents/{ns}/{name}/memory/observations", h.CreateMemoryObservation)
			r.Patch("/agents/{ns}/{name}/memory/observations/{obsId}", h.UpdateMemoryObservation)
			r.Delete("/agents/{ns}/{name}/memory/observations/{obsId}", h.DeleteMemoryObservation)
			r.Get("/agents/{ns}/{name}/memory/search", h.SearchMemory)
			r.Get("/agents/{ns}/{name}/memory/context", h.GetMemoryContext)
			r.Get("/agents/{ns}/{name}/memory/stats", h.GetMemoryStats)
			r.Get("/agents/{ns}/{name}/memory/sessions", h.ListMemorySessions)
			r.Get("/agents/{ns}/{name}/memory/timeline", h.GetMemoryTimeline)

			// Agent Runs
			r.Get("/agentruns", h.ListAgentRuns)
			r.Get("/agentruns/{ns}/{name}", h.GetAgentRun)
			// Console-initiated dispatch (direct AgentRun creation, incl. the CI
			// repair loop with retry-budget enforcement).
			r.Post("/agentruns", h.DispatchAgentRun)

			// Channels
			r.Get("/channels", h.ListChannels)
			r.Get("/channels/{ns}/{name}", h.GetChannel)

			// Integrations
			r.Get("/integrations", h.ListIntegrations)
			r.Get("/integrations/{ns}/{name}", h.GetIntegration)
			r.Get("/agents/{ns}/{name}/integrations", h.ListIntegrationsForAgent)

			// Integration browsing (proxy to GitHub/GitLab APIs)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/files", h.BrowseResourceFiles)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/files/content", h.BrowseResourceFileContent)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/commits", h.BrowseResourceCommits)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/branches", h.BrowseResourceBranches)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/mergerequests", h.BrowseResourceMergeRequests)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/issues", h.BrowseResourceIssues)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/pipelines", h.BrowseResourcePipelines)

			// Work board (GitLab-project write/read: merge gate, diff, notes, label moves)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/mergerequests/{iid}", h.GetMergeRequest)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/mergerequests/{iid}/changes", h.GetMergeRequestChanges)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/mergerequests/{iid}/notes", h.ListMergeRequestNotes)
			r.Post("/agents/{ns}/{name}/integrations/{intgName}/mergerequests/{iid}/notes", h.CreateMergeRequestNote)
			r.Get("/agents/{ns}/{name}/integrations/{intgName}/mergerequests/{iid}/pipelines", h.ListMergeRequestPipelines)
			r.Put("/agents/{ns}/{name}/integrations/{intgName}/mergerequests/{iid}/merge", h.MergeMergeRequest)
			r.Put("/agents/{ns}/{name}/integrations/{intgName}/issues/{iid}/labels", h.UpdateIssueLabels)

			// GitLab group workspace (gitlab-group integration: group-wide
			// observability across every project). Not agent-scoped — the group
			// integration is identified directly by {ns}/{name}.
			r.Get("/integrations/{ns}/{name}/group/projects", h.GroupProjects)
			r.Get("/integrations/{ns}/{name}/group/issues", h.GroupIssues)
			r.Get("/integrations/{ns}/{name}/group/merge_requests", h.GroupMergeRequests)
			r.Get("/integrations/{ns}/{name}/group/labels", h.GroupLabels)
			r.Get("/integrations/{ns}/{name}/group/members", h.GroupMembers)
			// Server-side run↔card join + trace cross-links (Phase 5).
			r.Get("/integrations/{ns}/{name}/group/runs", h.GroupRuns)

			// DevOps enrichment: group-wide CI/CD health + delivery planning.
			r.Get("/integrations/{ns}/{name}/group/pipelines", h.GroupPipelines)
			r.Get("/integrations/{ns}/{name}/group/milestones", h.GroupMilestones)
			// Project drill-down (group token, addressed by numeric project id).
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}", h.GroupProjectDetail)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/pipelines", h.GroupProjectPipelines)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/commits", h.GroupProjectCommits)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/branches", h.GroupProjectBranches)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/languages", h.GroupProjectLanguages)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/releases", h.GroupProjectReleases)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/contributors", h.GroupProjectContributors)
			// Deeper detail: CI jobs/logs + issue body & discussion.
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/issues/{iid}", h.GroupProjectIssue)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/issues/{iid}/notes", h.GroupProjectIssueNotes)
			r.Post("/integrations/{ns}/{name}/group/projects/{projectID}/issues/{iid}/notes", h.GroupProjectAddIssueNote)
			r.Put("/integrations/{ns}/{name}/group/projects/{projectID}/issues/{iid}", h.GroupProjectUpdateIssue)
			r.Post("/integrations/{ns}/{name}/group/projects/{projectID}/issues/{iid}/refine", h.GroupProjectIssueRefine)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/issues/{iid}/closed_by", h.GroupProjectIssueClosedBy)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/pipelines/{pipelineID}/jobs", h.GroupProjectPipelineJobs)
			r.Get("/integrations/{ns}/{name}/group/projects/{projectID}/jobs/{jobID}/trace", h.GroupProjectJobTrace)

			// Per-project board actions reachable via a group integration
			// ({ns}/{name}) plus a ?project=<id> query param identifying the
			// card's project. Mirror the agent-scoped work-board routes above
			// and share the same handlers (boardTarget handles both shapes).
			r.Get("/integrations/{ns}/{name}/mergerequests/{iid}", h.GetMergeRequest)
			r.Get("/integrations/{ns}/{name}/mergerequests/{iid}/changes", h.GetMergeRequestChanges)
			r.Get("/integrations/{ns}/{name}/mergerequests/{iid}/notes", h.ListMergeRequestNotes)
			r.Post("/integrations/{ns}/{name}/mergerequests/{iid}/notes", h.CreateMergeRequestNote)
			r.Get("/integrations/{ns}/{name}/mergerequests/{iid}/pipelines", h.ListMergeRequestPipelines)
			r.Put("/integrations/{ns}/{name}/mergerequests/{iid}/merge", h.MergeMergeRequest)
			r.Put("/integrations/{ns}/{name}/issues/{iid}/labels", h.UpdateIssueLabels)

			// Traces (proxy to Tempo)
			r.Get("/traces", h.SearchTraces)
			r.Get("/traces/{traceID}", h.GetTrace)

			// Kubernetes (legacy — kept for backward compatibility)
			r.Get("/kubernetes/namespaces", h.ListNamespaces)
			r.Get("/kubernetes/namespaces/{ns}/pods", h.ListPods)

			// Kubernetes resource browser (enhanced)
			r.Get("/kubernetes/browse/namespaces", h.ListNamespacesEnhanced)
			r.Get("/kubernetes/browse/namespaces/{ns}/summary", h.ListNamespaceResourceSummary)
			r.Get("/kubernetes/browse/namespaces/{ns}/pods", h.ListPodsEnhanced)
			r.Get("/kubernetes/browse/namespaces/{ns}/deployments", h.ListDeployments)
			r.Get("/kubernetes/browse/namespaces/{ns}/statefulsets", h.ListStatefulSets)
			r.Get("/kubernetes/browse/namespaces/{ns}/daemonsets", h.ListDaemonSets)
			r.Get("/kubernetes/browse/namespaces/{ns}/jobs", h.ListJobs)
			r.Get("/kubernetes/browse/namespaces/{ns}/cronjobs", h.ListCronJobs)
			r.Get("/kubernetes/browse/namespaces/{ns}/services", h.ListServicesK8s)
			r.Get("/kubernetes/browse/namespaces/{ns}/ingresses", h.ListIngresses)
			r.Get("/kubernetes/browse/namespaces/{ns}/configmaps", h.ListConfigMaps)
			r.Get("/kubernetes/browse/namespaces/{ns}/secrets", h.ListSecretsMetadata)
			r.Get("/kubernetes/browse/namespaces/{ns}/events", h.ListEventsK8s)
		})
	})

	// Health check (outside /api/v1)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Static files (SPA fallback)
	if cfg.WebDir != "" {
		staticHandler := http.FileServer(http.Dir(cfg.WebDir))
		r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
			// Try static file first
			path := filepath.Join(cfg.WebDir, filepath.Clean(r.URL.Path))
			if _, err := os.Stat(path); err == nil {
				http.StripPrefix("/", staticHandler).ServeHTTP(w, r)
				return
			}
			// Fall back to index.html for SPA client-side routing
			http.ServeFile(w, r, filepath.Join(cfg.WebDir, "index.html"))
		})
	}

	return &Server{
		cfg: cfg,
		http: &http.Server{
			Addr:         cfg.Addr,
			Handler:      r,
			ReadTimeout:  15 * time.Second,
			WriteTimeout: 0, // disabled for SSE
			IdleTimeout:  120 * time.Second,
		},
	}
}

// Start begins listening. Blocks until the server stops.
func (s *Server) Start() error {
	slog.Info("HTTP server listening", "addr", s.cfg.Addr)
	return s.http.ListenAndServe()
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}
