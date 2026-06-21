// Tempo trace proxy — proxies trace queries to Grafana Tempo's HTTP API.
// Resolves the Tempo URL from TEMPO_URL env var or falls back to in-cluster DNS.
//
// The GetTrace handler transforms Tempo's OTLP response into a Jaeger-like
// structure that the frontend expects.
package handlers

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	// defaultTempoURL is the in-cluster Tempo HTTP query API endpoint.
	defaultTempoURL = "http://tempo.observability.svc.cluster.local:3200"
)

// tempoBaseURL returns the Tempo HTTP API base URL.
func tempoBaseURL() string {
	if u := os.Getenv("TEMPO_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return defaultTempoURL
}

// GetTrace fetches a single trace from Tempo and transforms the OTLP response
// into a Jaeger-like format the frontend can render.
// GET /api/v1/traces/{traceID} → Tempo GET /api/traces/{traceID}
func (h *Handlers) GetTrace(w http.ResponseWriter, r *http.Request) {
	traceID := chi.URLParam(r, "traceID")
	if traceID == "" {
		writeError(w, http.StatusBadRequest, "traceID is required")
		return
	}

	tempoURL := fmt.Sprintf("%s/api/traces/%s", tempoBaseURL(), traceID)

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, tempoURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create request: %s", err)
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "tempo unreachable: %s", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		proxyResponse(w, resp)
		return
	}

	// Parse the OTLP response (capped at 10 MiB — traces can be large)
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to read tempo response: %s", err)
		return
	}

	var otlp otlpTraceResponse
	if err := json.Unmarshal(body, &otlp); err != nil {
		writeError(w, http.StatusBadGateway, "failed to parse tempo response: %s", err)
		return
	}

	// Transform OTLP → Jaeger-like format
	jaeger := transformOTLPToJaeger(traceID, &otlp)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jaeger)
}

// SearchTraces proxies a trace search to Tempo and enriches the results
// with delegation relationship data from AgentRun CRDs.
//
// For each trace that corresponds to a delegated AgentRun (source=agent),
// the response includes parentTraceID and parentAgent so the frontend can
// render a delegation tree in the traces sidebar.
//
// GET /api/v1/traces?q=...&tags=...&limit=...&start=...&end=...
// → Tempo GET /api/search?q=...&tags=...&limit=...&start=...&end=...
func (h *Handlers) SearchTraces(w http.ResponseWriter, r *http.Request) {
	tempoURL := fmt.Sprintf("%s/api/search", tempoBaseURL())

	// Ensure start/end time range is set — Tempo only searches
	// in-memory (ingester) data when no range is given, which means
	// traces disappear from search once flushed to backend blocks.
	// Default to the last 72h (matching the configured retention).
	q := r.URL.Query()
	if q.Get("start") == "" || q.Get("end") == "" {
		now := time.Now()
		q.Set("end", strconv.FormatInt(now.Unix(), 10))
		q.Set("start", strconv.FormatInt(now.Add(-72*time.Hour).Unix(), 10))
	}
	// Enforce a minimum limit so Tempo returns all traces within the time
	// range. Tempo searches blocks in parallel and returns the first N it
	// finds — with a low limit the subset is non-deterministic across calls,
	// causing the sidebar list to shuffle on every refresh.
	if lim, _ := strconv.Atoi(q.Get("limit")); lim < 200 {
		q.Set("limit", "200")
	}
	tempoURL = fmt.Sprintf("%s?%s", tempoURL, q.Encode())

	httpClient := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, tempoURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create request: %s", err)
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "tempo unreachable: %s", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		proxyResponse(w, resp)
		return
	}

	// Parse Tempo's search response so we can enrich it (capped at 10 MiB).
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to read tempo response: %s", err)
		return
	}

	var tempoResp tempoSearchResponse
	if err := json.Unmarshal(body, &tempoResp); err != nil {
		// If we can't parse it, return the raw response as-is.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(body)
		return
	}

	// Build delegation map from AgentRun CRDs.
	delegationMap := h.buildDelegationMap(r.Context())

	// Enrich each trace with delegation info.
	enriched := make([]enrichedTraceResult, 0, len(tempoResp.Traces))
	for _, t := range tempoResp.Traces {
		et := enrichedTraceResult{
			TraceID:           t.TraceID,
			RootServiceName:   t.RootServiceName,
			RootTraceName:     t.RootTraceName,
			StartTimeUnixNano: t.StartTimeUnixNano,
			DurationMs:        t.DurationMs,
			SpanSet:           t.SpanSet,
			SpanSets:          t.SpanSets,
		}
		if info, ok := delegationMap[t.TraceID]; ok {
			et.ParentTraceID = info.parentTraceID
			et.ParentAgent = info.parentAgent
			et.ChildAgent = info.childAgent
			et.RunSource = info.runSource
		}
		enriched = append(enriched, et)
	}

	// Sort traces newest-first (descending by StartTimeUnixNano) so the
	// frontend sidebar always shows a stable, deterministic order.
	// TraceID tiebreaker ensures identical timestamps sort deterministically.
	sort.Slice(enriched, func(i, j int) bool {
		a := enriched[i].StartTimeUnixNano
		b := enriched[j].StartTimeUnixNano
		if len(a) != len(b) {
			return len(a) > len(b) // longer nanosecond string = larger number
		}
		if a != b {
			return a > b // descending
		}
		return enriched[i].TraceID < enriched[j].TraceID // stable tiebreaker
	})

	result := enrichedSearchResponse{
		Traces:  enriched,
		Metrics: tempoResp.Metrics,
	}

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	writeJSON(w, http.StatusOK, result)
}

// ── Delegation enrichment types ──

type delegationInfo struct {
	parentTraceID string
	parentAgent   string
	childAgent    string // the agent that ran (agentRef)
	runSource     string // "agent", "console", "channel", etc.
}

// buildDelegationMap creates a traceID → delegationInfo index from AgentRun CRDs.
// For runs with source=agent, we extract the parent trace ID from the
// agents.agentops.io/traceparent annotation (W3C traceparent format:
// 00-{traceID}-{spanID}-{flags}).
func (h *Handlers) buildDelegationMap(ctx context.Context) map[string]delegationInfo {
	result := make(map[string]delegationInfo)

	runs, err := h.k8s.ListAgentRuns(ctx)
	if err != nil {
		return result
	}

	for _, run := range runs.Items {
		traceID := run.Status.TraceID
		if traceID == "" {
			continue
		}

		info := delegationInfo{
			childAgent: run.Spec.AgentRef,
			runSource:  string(run.Spec.Source),
		}

		// For delegated runs (source=agent), extract parent trace ID
		// from the traceparent annotation.
		if run.Spec.Source == "agent" {
			if tp, ok := run.Annotations["agents.agentops.io/traceparent"]; ok && tp != "" {
				info.parentTraceID = extractTraceIDFromTraceparent(tp)
			}
			if pa, ok := run.Annotations["agents.agentops.io/parent-agent"]; ok && pa != "" {
				info.parentAgent = pa
			} else {
				info.parentAgent = run.Spec.SourceRef
			}
		}

		result[traceID] = info
	}

	return result
}

// extractTraceIDFromTraceparent parses a W3C traceparent header
// (format: "00-{traceID}-{spanID}-{flags}") and returns the trace ID.
func extractTraceIDFromTraceparent(tp string) string {
	parts := strings.Split(tp, "-")
	if len(parts) >= 3 {
		return parts[1]
	}
	return ""
}

// ── Tempo search response types (for parsing) ──

type tempoSearchResponse struct {
	Traces  []tempoTraceResult `json:"traces"`
	Metrics json.RawMessage    `json:"metrics,omitempty"`
}

type tempoTraceResult struct {
	TraceID           string          `json:"traceID"`
	RootServiceName   string          `json:"rootServiceName,omitempty"`
	RootTraceName     string          `json:"rootTraceName,omitempty"`
	StartTimeUnixNano string          `json:"startTimeUnixNano,omitempty"`
	DurationMs        json.RawMessage `json:"durationMs,omitempty"` // can be int or float
	SpanSet           json.RawMessage `json:"spanSet,omitempty"`
	SpanSets          json.RawMessage `json:"spanSets,omitempty"`
}

// ── Enriched search response types (what the frontend receives) ──

type enrichedSearchResponse struct {
	Traces  []enrichedTraceResult `json:"traces"`
	Metrics json.RawMessage       `json:"metrics,omitempty"`
}

type enrichedTraceResult struct {
	TraceID           string          `json:"traceID"`
	RootServiceName   string          `json:"rootServiceName,omitempty"`
	RootTraceName     string          `json:"rootTraceName,omitempty"`
	StartTimeUnixNano string          `json:"startTimeUnixNano,omitempty"`
	DurationMs        json.RawMessage `json:"durationMs,omitempty"`
	SpanSet           json.RawMessage `json:"spanSet,omitempty"`
	SpanSets          json.RawMessage `json:"spanSets,omitempty"`
	// Delegation enrichment fields (only set for delegated runs)
	ParentTraceID string `json:"parentTraceID,omitempty"`
	ParentAgent   string `json:"parentAgent,omitempty"`
	ChildAgent    string `json:"childAgent,omitempty"`
	RunSource     string `json:"runSource,omitempty"`
}

// ────────────────────────────────────────────────────────────────────
// OTLP → Jaeger transformation
// ────────────────────────────────────────────────────────────────────

// OTLP response types (subset of what Tempo returns)

type otlpTraceResponse struct {
	Batches []otlpBatch `json:"batches"`
}

type otlpBatch struct {
	Resource   otlpResource    `json:"resource"`
	ScopeSpans []otlpScopeSpan `json:"scopeSpans"`
}

type otlpResource struct {
	Attributes []otlpAttribute `json:"attributes"`
}

type otlpScopeSpan struct {
	Scope otlpScope  `json:"scope"`
	Spans []otlpSpan `json:"spans"`
}

type otlpScope struct {
	Name string `json:"name"`
}

type otlpSpan struct {
	TraceID           string          `json:"traceId"`
	SpanID            string          `json:"spanId"`
	ParentSpanID      string          `json:"parentSpanId"`
	Name              string          `json:"name"`
	Kind              string          `json:"kind"`
	StartTimeUnixNano string          `json:"startTimeUnixNano"`
	EndTimeUnixNano   string          `json:"endTimeUnixNano"`
	Attributes        []otlpAttribute `json:"attributes"`
	Status            otlpStatus      `json:"status"`
	Events            []otlpEvent     `json:"events"`
	Links             []otlpLink      `json:"links"`
}

type otlpAttribute struct {
	Key   string        `json:"key"`
	Value otlpAttrValue `json:"value"`
}

type otlpAttrValue struct {
	StringValue string  `json:"stringValue,omitempty"`
	IntValue    string  `json:"intValue,omitempty"`
	BoolValue   bool    `json:"boolValue,omitempty"`
	DoubleValue float64 `json:"doubleValue,omitempty"`
}

type otlpStatus struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type otlpEvent struct {
	TimeUnixNano string          `json:"timeUnixNano"`
	Name         string          `json:"name"`
	Attributes   []otlpAttribute `json:"attributes"`
}

type otlpLink struct {
	TraceID    string          `json:"traceId"`
	SpanID     string          `json:"spanId"`
	Attributes []otlpAttribute `json:"attributes"`
}

// Jaeger-like output types (what the frontend expects)

type jaegerResponse struct {
	Data []jaegerTrace `json:"data"`
}

type jaegerTrace struct {
	TraceID   string                   `json:"traceID"`
	Spans     []jaegerSpan             `json:"spans"`
	Processes map[string]jaegerProcess `json:"processes"`
}

type jaegerSpan struct {
	TraceID       string        `json:"traceID"`
	SpanID        string        `json:"spanID"`
	ParentSpanID  string        `json:"parentSpanID,omitempty"`
	OperationName string        `json:"operationName"`
	ServiceName   string        `json:"serviceName,omitempty"`
	StartTime     int64         `json:"startTime"` // microseconds since epoch
	Duration      int64         `json:"duration"`  // microseconds
	Tags          []jaegerTag   `json:"tags,omitempty"`
	Logs          []jaegerLog   `json:"logs,omitempty"`
	Links         []jaegerLink  `json:"links,omitempty"`
	Status        *jaegerStatus `json:"status,omitempty"`
	ProcessID     string        `json:"processID"`
}

type jaegerTag struct {
	Key   string      `json:"key"`
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
}

type jaegerLog struct {
	Timestamp int64       `json:"timestamp"`
	Fields    []jaegerTag `json:"fields"`
}

type jaegerStatus struct {
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
}

type jaegerLink struct {
	TraceID string      `json:"traceID"`
	SpanID  string      `json:"spanID"`
	Tags    []jaegerTag `json:"tags,omitempty"`
}

type jaegerProcess struct {
	ServiceName string      `json:"serviceName"`
	Tags        []jaegerTag `json:"tags,omitempty"`
}

func transformOTLPToJaeger(traceID string, otlp *otlpTraceResponse) *jaegerResponse {
	trace := jaegerTrace{
		TraceID:   traceID,
		Spans:     make([]jaegerSpan, 0),
		Processes: make(map[string]jaegerProcess),
	}

	for batchIdx, batch := range otlp.Batches {
		// Extract service name from resource attributes
		processID := fmt.Sprintf("p%d", batchIdx+1)
		serviceName := "unknown"
		var processTags []jaegerTag

		for _, attr := range batch.Resource.Attributes {
			if attr.Key == "service.name" {
				serviceName = attrString(attr.Value)
			}
			processTags = append(processTags, otlpAttrToTag(attr))
		}

		trace.Processes[processID] = jaegerProcess{
			ServiceName: serviceName,
			Tags:        processTags,
		}

		for _, scopeSpan := range batch.ScopeSpans {
			for _, span := range scopeSpan.Spans {
				startNano, _ := strconv.ParseInt(span.StartTimeUnixNano, 10, 64)
				endNano, _ := strconv.ParseInt(span.EndTimeUnixNano, 10, 64)
				startMicro := startNano / 1000
				durationMicro := (endNano - startNano) / 1000
				if durationMicro < 0 {
					durationMicro = 0
				}

				js := jaegerSpan{
					TraceID:       traceID,
					SpanID:        base64ToHex(span.SpanID),
					ParentSpanID:  base64ToHex(span.ParentSpanID),
					OperationName: span.Name,
					ServiceName:   serviceName,
					StartTime:     startMicro,
					Duration:      durationMicro,
					ProcessID:     processID,
				}

				// Convert attributes to tags
				for _, attr := range span.Attributes {
					js.Tags = append(js.Tags, otlpAttrToTag(attr))
				}

				// Convert status
				if span.Status.Code != "" {
					code := 0
					switch span.Status.Code {
					case "STATUS_CODE_OK":
						code = 1
					case "STATUS_CODE_ERROR":
						code = 2
					}
					js.Status = &jaegerStatus{
						Code:    code,
						Message: span.Status.Message,
					}
				}

				// Convert events to logs
				for _, evt := range span.Events {
					evtNano, _ := strconv.ParseInt(evt.TimeUnixNano, 10, 64)
					log := jaegerLog{
						Timestamp: evtNano / 1000,
						Fields:    []jaegerTag{{Key: "event", Type: "string", Value: evt.Name}},
					}
					for _, attr := range evt.Attributes {
						log.Fields = append(log.Fields, otlpAttrToTag(attr))
					}
					js.Logs = append(js.Logs, log)
				}

				// Convert span links (used for cross-agent trace delegation)
				for _, link := range span.Links {
					jl := jaegerLink{
						TraceID: base64ToHex(link.TraceID),
						SpanID:  base64ToHex(link.SpanID),
					}
					for _, attr := range link.Attributes {
						jl.Tags = append(jl.Tags, otlpAttrToTag(attr))
					}
					js.Links = append(js.Links, jl)
				}

				trace.Spans = append(trace.Spans, js)
			}
		}
	}

	return &jaegerResponse{
		Data: []jaegerTrace{trace},
	}
}

func otlpAttrToTag(attr otlpAttribute) jaegerTag {
	v := attr.Value
	if v.StringValue != "" {
		return jaegerTag{Key: attr.Key, Type: "string", Value: v.StringValue}
	}
	if v.IntValue != "" {
		n, _ := strconv.ParseInt(v.IntValue, 10, 64)
		return jaegerTag{Key: attr.Key, Type: "int64", Value: n}
	}
	if v.BoolValue {
		return jaegerTag{Key: attr.Key, Type: "bool", Value: v.BoolValue}
	}
	if v.DoubleValue != 0 && !math.IsNaN(v.DoubleValue) {
		return jaegerTag{Key: attr.Key, Type: "float64", Value: v.DoubleValue}
	}
	return jaegerTag{Key: attr.Key, Type: "string", Value: ""}
}

func attrString(v otlpAttrValue) string {
	if v.StringValue != "" {
		return v.StringValue
	}
	if v.IntValue != "" {
		return v.IntValue
	}
	return fmt.Sprintf("%v", v.BoolValue)
}

// base64ToHex converts a base64-encoded ID (from OTLP JSON) to a hex string
// (Jaeger convention). Returns empty string if input is empty or decode fails.
func base64ToHex(b64 string) string {
	if b64 == "" {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		// If it's already hex or not valid base64, return as-is
		return b64
	}
	return hex.EncodeToString(raw)
}
