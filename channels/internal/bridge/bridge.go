// Package bridge provides shared infrastructure for channel bridge servers.
//
// Each channel bridge is a standalone HTTP server that:
//  1. Receives events from an external platform (webhook, chat message, etc.)
//  2. Processes and validates the event
//  3. Either forwards to a daemon agent's HTTP API or creates an AgentRun
//
// This package provides the common parts: HTTP server lifecycle, health checks,
// agent client, and AgentRun creation via Kubernetes API.
package bridge

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// Config holds common configuration loaded from environment variables.
// The operator sets these on the channel Deployment.
type Config struct {
	// ChannelType: telegram, slack, discord, gitlab, github, webhook
	ChannelType string
	// AgentRef: name of the Agent CR
	AgentRef string
	// AgentURL: daemon agent's HTTP service URL (empty for task agents)
	AgentURL string
	// AgentMode: daemon or task
	AgentMode string
	// ChannelName: name of the Channel CR
	ChannelName string
	// PromptTemplate: Go text/template for rendering event data into prompts
	PromptTemplate string
	// WebhookSecret: shared secret for webhook signature verification
	WebhookSecret string
	// Port: HTTP listen port (default 8080)
	Port string
}

// LoadConfig reads Config from environment variables set by the operator.
func LoadConfig() *Config {
	return &Config{
		ChannelType:    os.Getenv("CHANNEL_TYPE"),
		AgentRef:       os.Getenv("AGENT_REF"),
		AgentURL:       os.Getenv("AGENT_URL"),
		AgentMode:      os.Getenv("AGENT_MODE"),
		ChannelName:    os.Getenv("CHANNEL_NAME"),
		PromptTemplate: os.Getenv("PROMPT_TEMPLATE"),
		WebhookSecret:  os.Getenv("WEBHOOK_SECRET"),
		Port:           envOrDefault("PORT", "8080"),
	}
}

// IsDaemon returns true if the target agent runs in daemon mode.
func (c *Config) IsDaemon() bool {
	return c.AgentMode == "daemon"
}

// Bridge is the common interface that channel implementations must satisfy.
type Bridge interface {
	// Handler returns the HTTP handler for the channel's webhook/event endpoint.
	Handler() http.Handler
}

// Run starts the HTTP server with graceful shutdown.
// The bridge's Handler is mounted at "/" and a health check at "/healthz".
func Run(b Bridge, cfg *Config, logger *slog.Logger) {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"status":"ok"}`)
	})
	mux.Handle("/", b.Handler())

	addr := fmt.Sprintf(":%s", cfg.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	logger.Info("channel bridge starting",
		"type", cfg.ChannelType,
		"agent", cfg.AgentRef,
		"mode", cfg.AgentMode,
		"addr", addr,
	)

	go func() {
		<-ctx.Done()
		logger.Info("shutting down")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		srv.Shutdown(shutdownCtx) //nolint:errcheck
	}()

	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
}

// Poller runs a single poll iteration against an external platform. RunPoller
// invokes Poll repeatedly on the configured interval until the context is
// cancelled. Implementations must respect ctx cancellation for graceful
// shutdown and must not panic — errors should be logged and swallowed so the
// loop keeps running.
type Poller interface {
	Poll(ctx context.Context)
}

// RunPoller drives a poll-based channel bridge. It serves a /healthz endpoint
// (so Kubernetes liveness/readiness probes pass) and runs the poll loop on the
// given interval, both sharing a context that is cancelled on SIGTERM/SIGINT.
//
// Unlike Run, there is no inbound webhook endpoint — the bridge is the source
// of truth and pulls from the platform. Poll is invoked once immediately, then
// on each interval tick.
func RunPoller(p Poller, interval time.Duration, cfg *Config, logger *slog.Logger) {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	if interval <= 0 {
		interval = 30 * time.Second
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"status":"ok"}`)
	})

	addr := fmt.Sprintf(":%s", cfg.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	logger.Info("channel poller starting",
		"type", cfg.ChannelType,
		"agent", cfg.AgentRef,
		"mode", cfg.AgentMode,
		"addr", addr,
		"interval", interval.String(),
	)

	// Health server.
	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			logger.Error("health server error", "error", err)
			cancel()
		}
	}()

	// Poll loop — fire once immediately, then on each tick.
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	p.Poll(ctx)
	for {
		select {
		case <-ctx.Done():
			logger.Info("shutting down")
			shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer shutdownCancel()
			srv.Shutdown(shutdownCtx) //nolint:errcheck
			return
		case <-ticker.C:
			p.Poll(ctx)
		}
	}
}

// AgentClient sends prompts to daemon agents and creates AgentRuns.
type AgentClient struct {
	httpClient *http.Client
	logger     *slog.Logger
}

// NewAgentClient creates a client for interacting with agents.
func NewAgentClient(logger *slog.Logger) *AgentClient {
	return &AgentClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
	}
}

// PromptRequest is sent to the daemon agent's /prompt endpoint.
type PromptRequest struct {
	Prompt   string            `json:"prompt"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

// PromptDaemon sends a prompt to a daemon agent's HTTP endpoint. Any headers in
// `headers` are attached to the request — poll-based channels use this to carry
// the work-board card identity (X-AgentOps-GitLab-*) so the runtime can stamp
// delegated child runs with the join annotations, deterministically.
func (c *AgentClient) PromptDaemon(ctx context.Context, agentURL string, prompt string, metadata map[string]string, headers map[string]string) error {
	reqBody := PromptRequest{
		Prompt:   prompt,
		Metadata: metadata,
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal prompt request: %w", err)
	}

	url := strings.TrimRight(agentURL, "/") + "/prompt"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send prompt: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("agent returned %d: %s", resp.StatusCode, string(body))
	}

	c.logger.Info("prompt sent to daemon agent", "url", url)
	return nil
}

// AgentRunRequest is the payload for creating an AgentRun.
// In the real implementation this creates a Kubernetes resource;
// for now it calls the operator's AgentRun creation endpoint.
type AgentRunRequest struct {
	AgentRef    string            `json:"agentRef"`
	ChannelName string            `json:"channelName"`
	Prompt      string            `json:"prompt"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	// Annotations are stamped onto the created AgentRun's metadata.annotations.
	// Used by poll-based channels to record join keys (e.g. the GitLab issue/MR
	// iid) so the console can correlate AgentRuns with work-board cards.
	Annotations map[string]string `json:"annotations,omitempty"`
}

// CreateAgentRun creates an AgentRun CR for a task agent using the in-cluster
// Kubernetes API. The bridge pod must have a ServiceAccount with permission to
// create AgentRun resources in its namespace.
func (c *AgentClient) CreateAgentRun(ctx context.Context, req *AgentRunRequest) error {
	namespace := envOrDefault("POD_NAMESPACE", "agents")

	// Build the AgentRun JSON manifest.
	metadata := map[string]interface{}{
		"generateName": req.AgentRef + "-",
		"namespace":    namespace,
		"labels": map[string]string{
			"agents.agentops.io/channel": req.ChannelName,
			"agents.agentops.io/source":  "channel",
		},
	}
	if len(req.Annotations) > 0 {
		annotations := make(map[string]string, len(req.Annotations))
		for k, v := range req.Annotations {
			annotations[k] = v
		}
		metadata["annotations"] = annotations
	}

	manifest := map[string]interface{}{
		"apiVersion": "agents.agentops.io/v1alpha1",
		"kind":       "AgentRun",
		"metadata":   metadata,
		"spec": map[string]interface{}{
			"agentRef":  req.AgentRef,
			"prompt":    req.Prompt,
			"source":    "channel",
			"sourceRef": req.ChannelName,
		},
	}

	// If git workspace info is provided via metadata, include it.
	if req.Metadata != nil {
		if resourceRef := req.Metadata["gitResourceRef"]; resourceRef != "" {
			gitSpec := map[string]interface{}{
				"integrationRef": resourceRef,
				"branch":         req.Metadata["gitBranch"],
			}
			if baseBranch := req.Metadata["gitBaseBranch"]; baseBranch != "" {
				gitSpec["baseBranch"] = baseBranch
			}
			if project := req.Metadata["gitProject"]; project != "" {
				gitSpec["project"] = project
			}
			manifest["spec"].(map[string]interface{})["git"] = gitSpec
		}
	}

	data, err := json.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("marshal AgentRun: %w", err)
	}

	c.logger.Info("creating AgentRun", "agent", req.AgentRef, "channel", req.ChannelName, "namespace", namespace)

	// Use in-cluster Kubernetes API.
	kc, err := newInClusterClient()
	if err != nil {
		return fmt.Errorf("create k8s client: %w", err)
	}

	url := fmt.Sprintf("%s/apis/agents.agentops.io/v1alpha1/namespaces/%s/agentruns", kc.host, namespace)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+kc.token)

	resp, err := kc.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("k8s API request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("k8s API returned %d: %s", resp.StatusCode, string(body))
	}

	// Parse response to get the created name.
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
		if md, ok := result["metadata"].(map[string]interface{}); ok {
			c.logger.Info("AgentRun created", "name", md["name"], "namespace", namespace)
		}
	}

	return nil
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// RunStatus is the subset of an AgentRun we need for failure recovery: the
// latest run's phase and the GitLab trigger label it was fired from.
type RunStatus struct {
	Name    string
	Phase   string // Pending|Queued|Running|Succeeded|Failed
	Trigger string // agentops.dev/gitlab-trigger annotation (original label)
	Found   bool
}

// LatestRunForIID lists AgentRuns for the given channel and returns the most
// recently created run joined to the given GitLab iid (via the
// agentops.dev/gitlab-iid annotation). Used by the poller to detect runs that
// failed and left their work-board card stuck in agent::in-progress.
func (c *AgentClient) LatestRunForIID(ctx context.Context, channelName, iid string) (RunStatus, error) {
	namespace := envOrDefault("POD_NAMESPACE", "agents")
	kc, err := newInClusterClient()
	if err != nil {
		return RunStatus{}, fmt.Errorf("create k8s client: %w", err)
	}

	sel := url.QueryEscape("agents.agentops.io/channel=" + channelName)
	listURL := fmt.Sprintf("%s/apis/agents.agentops.io/v1alpha1/namespaces/%s/agentruns?labelSelector=%s",
		kc.host, namespace, sel)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, listURL, nil)
	if err != nil {
		return RunStatus{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+kc.token)
	req.Header.Set("Accept", "application/json")

	resp, err := kc.httpClient.Do(req)
	if err != nil {
		return RunStatus{}, fmt.Errorf("k8s API request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return RunStatus{}, fmt.Errorf("k8s API %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var list struct {
		Items []struct {
			Metadata struct {
				Name              string            `json:"name"`
				CreationTimestamp string            `json:"creationTimestamp"`
				Annotations       map[string]string `json:"annotations"`
			} `json:"metadata"`
			Status struct {
				Phase string `json:"phase"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return RunStatus{}, fmt.Errorf("decode: %w", err)
	}

	var best RunStatus
	var bestTS string
	for _, it := range list.Items {
		if it.Metadata.Annotations["agentops.dev/gitlab-iid"] != iid {
			continue
		}
		// Lexicographic compare works for RFC3339 timestamps (same zone, Z).
		if !best.Found || it.Metadata.CreationTimestamp > bestTS {
			bestTS = it.Metadata.CreationTimestamp
			best = RunStatus{
				Name:    it.Metadata.Name,
				Phase:   it.Status.Phase,
				Trigger: it.Metadata.Annotations["agentops.dev/gitlab-trigger"],
				Found:   true,
			}
		}
	}
	return best, nil
}

// inClusterClient is a minimal Kubernetes API client using the pod's
// mounted service account token and CA certificate.
type inClusterClient struct {
	host       string
	token      string
	httpClient *http.Client
}

func newInClusterClient() (*inClusterClient, error) {
	const (
		tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
		caPath    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
	)

	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		return nil, fmt.Errorf("not running in cluster (KUBERNETES_SERVICE_HOST/PORT not set)")
	}

	token, err := os.ReadFile(tokenPath)
	if err != nil {
		return nil, fmt.Errorf("read service account token: %w", err)
	}

	// Load the cluster CA certificate.
	caCert, err := os.ReadFile(caPath)
	if err != nil {
		return nil, fmt.Errorf("read CA cert: %w", err)
	}
	caCertPool := x509.NewCertPool()
	caCertPool.AppendCertsFromPEM(caCert)

	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			RootCAs:    caCertPool,
			MinVersion: tls.VersionTLS12,
		},
	}

	// Wrap IPv6 addresses in brackets for valid URL formatting.
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}

	return &inClusterClient{
		host:  fmt.Sprintf("https://%s:%s", host, port),
		token: strings.TrimSpace(string(token)),
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   10 * time.Second,
		},
	}, nil
}
