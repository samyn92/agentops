// Memory proxy — resolves per-agent agentops-memory URL from the Agent CR and proxies
// HTTP requests to the agentops-memory REST API.
package handlers

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	agentsv1alpha1 "github.com/samyn92/agentops/api/v1alpha1"

	"github.com/samyn92/agentops/internal/console/k8s"
)

// memoryDefaultPort is the default port agentops-memory serves on.
const memoryDefaultPort = 7437

// resolveMemoryURL determines the agentops-memory HTTP URL for an agent by reading spec.memory.serverRef.
// Resolution order:
//  1. MEMORY_URL_OVERRIDE env var (dev mode) — also checks legacy ENGRAM_URL_OVERRIDE
//  2. Fallback: http://{serverRef}.{ns}.svc:7437
//
// Returns ("", "") if the agent has no memory configured.
func resolveMemoryURL(ctx context.Context, k8sClient *k8s.Client, agent *agentsv1alpha1.Agent) (memoryURL string, project string) {
	if agent.Spec.Memory == nil || agent.Spec.Memory.ServerRef == "" {
		return "", ""
	}

	serverRef := agent.Spec.Memory.ServerRef
	ns := agent.Namespace

	project = agent.Spec.Memory.Project
	if project == "" {
		project = agent.Name
	}

	// Dev override (check new name first, then legacy)
	if override := os.Getenv("MEMORY_URL_OVERRIDE"); override != "" {
		return override, project
	}
	if override := os.Getenv("ENGRAM_URL_OVERRIDE"); override != "" {
		return override, project
	}

	// Standard K8s service DNS resolution
	memURL := fmt.Sprintf("http://%s.%s.svc:%d", serverRef, ns, memoryDefaultPort)
	slog.Debug("resolved memory URL via service DNS", "serverRef", serverRef, "url", memURL)
	return memURL, project
}

// memoryClient is a reusable HTTP client for agentops-memory requests.
var memoryClient = &http.Client{Timeout: 15 * time.Second}

// proxyToMemory proxies a request to the agentops-memory REST API for a specific agent.
// It resolves the memory URL, adds the project query parameter, and forwards the request.
func proxyToMemory(
	ctx context.Context,
	k8sClient *k8s.Client,
	agent *agentsv1alpha1.Agent,
	method string,
	memoryPath string,
	body io.Reader,
	extraQuery map[string]string,
) (*http.Response, error) {
	memoryURL, project := resolveMemoryURL(ctx, k8sClient, agent)
	if memoryURL == "" {
		return nil, fmt.Errorf("agent %s/%s has no memory configured", agent.Namespace, agent.Name)
	}

	// Build URL with query parameters
	targetURL := memoryURL + memoryPath

	qp := url.Values{}
	// Add project param for endpoints that scope by project
	needsProject := strings.HasSuffix(memoryPath, "/recent") ||
		memoryPath == "/search" ||
		memoryPath == "/context" ||
		memoryPath == "/stats"
	if needsProject && project != "" {
		qp.Set("project", project)
	}
	for k, v := range extraQuery {
		qp.Set(k, v)
	}
	if len(qp) > 0 {
		targetURL += "?" + qp.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, method, targetURL, body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// Propagate W3C trace context to agentops-memory for distributed tracing
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))

	slog.Debug("proxying to agentops-memory", "method", method, "url", targetURL)
	return memoryClient.Do(req)
}
