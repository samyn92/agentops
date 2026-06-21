# PLAN: agentops-eval — Agent Evaluation System

> Status: **Draft**  
> Scope: Standalone Go binary, in-cluster on k3s, CRD promotion later  
> Target agents: pr-reviewer, cluster-healthcheck, ci-watcher  

---

## 1. Overview

`agentops-eval` is a standalone Go binary that evaluates agent behavior by querying
existing OTEL traces from Tempo. It runs in-cluster on the local k3s node, produces
JSON reports, and uses hybrid grading (deterministic verifiers + LLM-as-judge).

**What it is NOT (yet):** A CRD, an operator controller, or a CI pipeline step.
Those come later once the eval logic stabilizes.

### Design Principles

1. **Trace-first** — All eval data comes from Tempo. No synthetic task injection in v1.
2. **Deterministic by default** — LLM judge only for natural language quality assessment.
3. **Agent-specific checks** — Each agent has its own eval profile with tailored verifiers.
4. **JSON reports** — Machine-readable output for future CRD status promotion and console integration.
5. **Regression-ready** — Baselines defined from scratch, stored as golden JSON, diffed on each run.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    agentops-eval binary                   │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │  Tempo   │  │  Deterministic│  │   LLM Judge       │ │
│  │  Client  │  │  Verifiers    │  │   (optional)      │ │
│  └────┬─────┘  └──────┬───────┘  └────────┬───────────┘ │
│       │               │                    │             │
│       ▼               ▼                    ▼             │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Eval Engine                            │ │
│  │  1. Fetch traces from Tempo for target agent       │ │
│  │  2. Parse span tree (OTLP JSON → internal model)   │ │
│  │  3. Run deterministic checks per agent profile     │ │
│  │  4. Run LLM judge on flagged outputs (optional)    │ │
│  │  5. Score, compare against baseline, emit report   │ │
│  └─────────────────────────────────────────────────────┘ │
│                          │                               │
│                          ▼                               │
│                   JSON Report (stdout / file)            │
└──────────────────────────────────────────────────────────┘
         │
         │ queries
         ▼
┌─────────────────┐
│  Tempo           │
│  (observability) │
│  :3200           │
└─────────────────┘
```

### In-Cluster Deployment

The eval binary runs as a **Job** or **CronJob** in the `agent-system` namespace.
During development, it runs ad-hoc via `just eval-*` recipes from the dev pod or
directly from the host (since Tempo is accessible via NodePort or cluster DNS).

### Service Dependencies

| Service | Access | Purpose |
|---------|--------|---------|
| Tempo | `tempo.observability.svc.cluster.local:3200` | Trace data source |
| LLM Provider | Via Provider CR secrets (optional) | LLM-as-judge grading |

---

## 3. Trace Data Model

The eval binary consumes Tempo's OTLP JSON response and builds an internal
trace model optimized for evaluation. This maps directly to the span hierarchy
the runtime already produces.

### Span Hierarchy (from agentops-runtime tracing)

```
agent.prompt                          ← root span (one per prompt execution)
├── agent.step [step.number=1]        ← per LLM turn
│   ├── gen_ai.stream                 ← LLM call (streaming)
│   │   ├── event: gen_ai.content.prompt
│   │   └── event: gen_ai.content.completion
│   ├── tool.execute: github_get_pr   ← tool execution
│   │   └── mcp.call: github/github_get_pr
│   └── tool.execute: github_get_pr_diff
│       └── mcp.call: github/github_get_pr_diff
├── agent.step [step.number=2]
│   ├── gen_ai.stream
│   └── tool.execute: mem_save
└── agent.step [step.number=3]
    └── gen_ai.stream                 ← final response (no tools)
```

### Internal Trace Model (Go types)

```go
// EvalTrace is the parsed, eval-friendly representation of a Tempo trace.
type EvalTrace struct {
    TraceID     string        `json:"traceId"`
    AgentName   string        `json:"agentName"`
    StartTime   time.Time     `json:"startTime"`
    Duration    time.Duration `json:"duration"`
    Steps       []EvalStep    `json:"steps"`
    TotalTokens TokenUsage    `json:"totalTokens"`
    FinalOutput string        `json:"finalOutput"`  // from last gen_ai.content.completion
    Error       string        `json:"error,omitempty"`
}

type EvalStep struct {
    Number      int            `json:"number"`
    LLMCall     *LLMCallInfo   `json:"llmCall,omitempty"`
    ToolCalls   []ToolCallInfo `json:"toolCalls"`
    Duration    time.Duration  `json:"duration"`
}

type LLMCallInfo struct {
    Model         string     `json:"model"`
    Provider      string     `json:"provider"`
    InputTokens   int64      `json:"inputTokens"`
    OutputTokens  int64      `json:"outputTokens"`
    Prompt        string     `json:"prompt"`       // from gen_ai.content.prompt event
    Completion    string     `json:"completion"`    // from gen_ai.content.completion event
    FinishReason  string     `json:"finishReason"`
}

type ToolCallInfo struct {
    Name       string        `json:"name"`
    Type       string        `json:"type"`     // mcp, memory, builtin, etc.
    Input      string        `json:"input"`
    Output     string        `json:"output"`
    Error      string        `json:"error,omitempty"`
    Duration   time.Duration `json:"duration"`
    MCPServer  string        `json:"mcpServer,omitempty"`
}

type TokenUsage struct {
    Input     int64 `json:"input"`
    Output    int64 `json:"output"`
    Reasoning int64 `json:"reasoning,omitempty"`
    CacheRead int64 `json:"cacheRead,omitempty"`
}
```

### Key Tempo Attributes Used

These are the attributes the eval binary extracts from spans (already emitted by the runtime):

| Attribute | Source Span | Eval Use |
|-----------|------------|----------|
| `agent.name` | `agent.prompt` | Filter traces by agent |
| `step.number` | `agent.step` | Reconstruct step sequence |
| `step.tool_call_count` | `agent.step` | Tool call efficiency metrics |
| `gen_ai.request.model` | `gen_ai.stream` | Model identification |
| `gen_ai.usage.input_tokens` | `gen_ai.stream` | Token accounting |
| `gen_ai.usage.output_tokens` | `gen_ai.stream` | Token accounting |
| `gen_ai.response.finish_reasons` | `gen_ai.stream` | Completion quality |
| `tool.name` | `tool.execute: *` | Tool identification |
| `tool.type` | `tool.execute: *` | Tool classification |
| `tool.error` | `tool.execute: *` | Error detection |
| `tool.duration_ms` | `tool.execute: *` | Performance tracking |
| `gen_ai.content.prompt` | event on `gen_ai.stream` | Input analysis |
| `gen_ai.content.completion` | event on `gen_ai.stream` | Output grading |
| `tool.input` / `tool.output` | event on root span | Tool call analysis |

---

## 4. Eval Profiles — Per-Agent Check Definitions

Each agent has an **eval profile** that defines which checks to run.
Checks are categorized as:

- **structural** — Validates the shape of the trace (tool sequence, output format)
- **behavioral** — Validates what the agent did (correct tools, correct order)
- **efficiency** — Validates resource usage (token budget, tool call count, latency)
- **quality** — LLM-judged assessment of natural language outputs

### 4.1 pr-reviewer

The pr-reviewer agent reviews pull requests. Its traces should show:
1. Reading the PR diff before making a decision
2. Producing a structured verdict (approve/reject/comment)
3. Catching known-bad patterns when present
4. Efficient tool usage (no redundant API calls)

```yaml
# eval-profiles/pr-reviewer.yaml
agent: pr-reviewer
checks:

  # STRUCTURAL: Did the agent produce valid output?
  - name: valid-structured-output
    type: structural
    description: "Agent produced a valid verdict (approve, reject, request_changes, comment)"
    verifier: deterministic
    rule: |
      final_output matches one of: approve, reject, request_changes, comment
      (extracted via regex from last completion)

  # BEHAVIORAL: Did the agent read the diff before deciding?
  - name: diff-read-before-verdict
    type: behavioral
    description: "Agent called github_get_pr_diff (or gitlab_get_mr_diff) before the step containing the final verdict"
    verifier: deterministic
    rule: |
      tool_call_sequence contains "github_get_pr_diff" OR "gitlab_get_mr_diff"
      AND that call's step.number < final_verdict_step.number

  # BEHAVIORAL: Did the agent actually read PR metadata?
  - name: pr-metadata-fetched
    type: behavioral
    description: "Agent fetched PR details before reviewing"
    verifier: deterministic
    rule: |
      tool_call_sequence contains "github_get_pr" OR "gitlab_get_mr"

  # EFFICIENCY: Minimal redundant tool calls
  - name: tool-call-efficiency
    type: efficiency
    description: "No duplicate tool calls with identical inputs"
    verifier: deterministic
    rule: |
      count(duplicate_tool_calls) == 0
      where duplicate = same tool name + same input within one trace

  # EFFICIENCY: Reasonable token budget
  - name: token-budget
    type: efficiency
    description: "Total tokens under budget for a review task"
    verifier: deterministic
    rule: |
      total_tokens.input + total_tokens.output < 50000

  # EFFICIENCY: Step count within bounds
  - name: step-count
    type: efficiency
    description: "Completed review in reasonable number of steps"
    verifier: deterministic
    rule: |
      len(steps) <= 8

  # QUALITY: Review comment quality (LLM judge)
  - name: review-comment-quality
    type: quality
    description: "Review comments are specific, actionable, and technically accurate"
    verifier: llm-judge
    prompt: |
      You are evaluating a code review comment produced by an AI agent.
      The agent reviewed a pull request and produced the following output:

      <agent_output>
      {{.FinalOutput}}
      </agent_output>

      The PR diff that was reviewed:
      <pr_diff>
      {{.ToolOutput "github_get_pr_diff"}}
      </pr_diff>

      Score the review on these dimensions (1-5 each):
      1. Specificity: Does it reference specific lines/functions, or is it vague?
      2. Actionability: Can the author act on the feedback without guessing?
      3. Accuracy: Are the technical claims correct based on the diff?
      4. Completeness: Does it cover the important changes in the diff?

      Respond as JSON: {"specificity": N, "actionability": N, "accuracy": N, "completeness": N, "reasoning": "..."}

  # BEHAVIORAL: Known-issue detection (requires test fixtures)
  - name: known-issue-detection
    type: behavioral
    description: "Agent flags known-bad patterns when reviewing test PRs with planted issues"
    verifier: deterministic
    rule: |
      when test_fixture.has_known_issues:
        final_output contains reference to at least one known issue
    note: "Requires test fixtures — phase 2"
```

### 4.2 cluster-healthcheck

The cluster-healthcheck agent checks cluster health on a schedule.
Its traces should show efficient kubectl/kube-explore usage and accurate
detection of degraded resources.

```yaml
# eval-profiles/cluster-healthcheck.yaml
agent: cluster-healthcheck
checks:

  # BEHAVIORAL: Used efficient cluster-wide tools
  - name: used-kube-health
    type: behavioral
    description: "Agent used kube_health or kube_find for initial assessment (not individual kubectl_get calls)"
    verifier: deterministic
    rule: |
      tool_call_sequence contains "kube_health" OR "kube_find"
      within first 3 steps

  # BEHAVIORAL: Detection accuracy against known state
  - name: detection-accuracy
    type: behavioral
    description: "Agent correctly identified all degraded resources visible in the cluster"
    verifier: deterministic
    rule: |
      when cluster_state.degraded_resources exist:
        final_output references each degraded resource
    note: |
      Requires a cluster state snapshot taken before the eval run.
      Compare agent's findings against `kubectl get pods --field-selector=status.phase!=Running`
      and similar baseline queries.

  # EFFICIENCY: Time budget
  - name: time-budget
    type: efficiency
    description: "Completed health check within the agent's timeout"
    verifier: deterministic
    rule: |
      trace.duration < agent.spec.timeout (5m for cluster-healthcheck)

  # EFFICIENCY: Tool call relevance
  - name: tool-call-relevance
    type: efficiency
    description: "No exploratory kubectl calls unrelated to health checking"
    verifier: deterministic
    rule: |
      all tool calls are in allowed set:
        [kube_health, kube_find, kube_inspect, kube_logs, kube_topology,
         kubectl_get, kubectl_describe, kubectl_logs, kubectl_events, kubectl_top]

  # EFFICIENCY: Reasonable step count
  - name: step-count
    type: efficiency
    description: "Completed check in reasonable number of steps"
    verifier: deterministic
    rule: |
      len(steps) <= 12

  # QUALITY: Remediation quality (LLM judge)
  - name: remediation-quality
    type: quality
    description: "Suggested remediations are specific, correct, and actionable"
    verifier: llm-judge
    prompt: |
      You are evaluating a cluster health check report produced by an AI agent.

      <agent_output>
      {{.FinalOutput}}
      </agent_output>

      The cluster state the agent observed (tool outputs):
      <tool_outputs>
      {{.AllToolOutputs}}
      </tool_outputs>

      Score the health check on these dimensions (1-5 each):
      1. Detection: Did it identify all issues visible in the tool outputs?
      2. Diagnosis: Are the root cause explanations plausible given the data?
      3. Remediation: Are the suggested fixes specific and actionable (not generic)?
      4. Priority: Are critical issues flagged as higher priority than warnings?

      Respond as JSON: {"detection": N, "diagnosis": N, "remediation": N, "priority": N, "reasoning": "..."}
```

### 4.3 ci-watcher

The ci-watcher monitors CI/CD pipelines. Its traces should show
accurate status parsing and root cause identification for failures.

```yaml
# eval-profiles/ci-watcher.yaml
agent: ci-watcher
checks:

  # STRUCTURAL: Structured status output
  - name: valid-status-output
    type: structural
    description: "Agent produced a structured pipeline status report"
    verifier: deterministic
    rule: |
      final_output contains pipeline status indicators:
        (pass|success|fail|failure|running|pending|cancelled)

  # BEHAVIORAL: Status parsing accuracy
  - name: status-parsing
    type: behavioral
    description: "Agent correctly parsed pipeline statuses from GitHub/GitLab API responses"
    verifier: deterministic
    rule: |
      for each github_get_workflow_runs or gitlab_get_pipeline tool call:
        agent's reported status matches the status in the tool output JSON

  # BEHAVIORAL: Root cause identification
  - name: root-cause-identification
    type: behavioral
    description: "For failed pipelines, agent identified failing step/job"
    verifier: deterministic
    rule: |
      when tool_output contains failed pipeline:
        agent's output references the failing job/step name

  # EFFICIENCY: Response latency
  - name: response-latency
    type: efficiency
    description: "Completed pipeline check within reasonable time"
    verifier: deterministic
    rule: |
      trace.duration < 3m

  # EFFICIENCY: Tool calls are pipeline-relevant
  - name: tool-relevance
    type: efficiency
    description: "Agent only called pipeline-related tools"
    verifier: deterministic
    rule: |
      all tool calls are in allowed set:
        [github_get_workflow_runs, github_get_check_runs,
         gitlab_get_pipeline, github_get_repo, gitlab_get_project]

  # EFFICIENCY: Step count
  - name: step-count
    type: efficiency
    description: "Completed check efficiently"
    verifier: deterministic
    rule: |
      len(steps) <= 10

  # QUALITY: Root cause explanation (LLM judge)
  - name: root-cause-quality
    type: quality
    description: "Root cause explanations are accurate and helpful"
    verifier: llm-judge
    prompt: |
      You are evaluating a CI/CD pipeline report produced by an AI agent.

      <agent_output>
      {{.FinalOutput}}
      </agent_output>

      The pipeline data the agent retrieved:
      <tool_outputs>
      {{.AllToolOutputs}}
      </tool_outputs>

      Score the report on these dimensions (1-5 each):
      1. Accuracy: Does the status summary match the actual API data?
      2. Root cause: For failures, is the root cause explanation correct?
      3. Completeness: Are all monitored repos/pipelines covered?
      4. Clarity: Is the report easy to scan and act on?

      Respond as JSON: {"accuracy": N, "root_cause": N, "completeness": N, "clarity": N, "reasoning": "..."}
```

---

## 5. Memory Injection Evaluation

Memory injection quality is evaluated as a **cross-cutting concern** that applies
to any agent with `spec.memory` configured. It uses the OTEL audit trail that
agentops-memory already emits.

### How It Works

The runtime calls `GET /context?query=...` before each prompt. The memory service
records `context.injected` span events with:
- `memory.injected.observation_id`
- `memory.injected.type`
- `memory.injected.title`
- `memory.injected.rank` (BM25 score or 0 for recency)
- `memory.injected.method` (`fts5_bm25` or `recency`)

The eval binary finds these events in the Tempo trace and evaluates injection precision.

### Memory Injection Checks

```yaml
# eval-profiles/_memory-injection.yaml  (shared, applied to agents with memory enabled)
checks:

  # Was a query provided for relevance ranking?
  - name: query-provided
    type: structural
    description: "Context fetch used a query for BM25 ranking (not just recency fallback)"
    verifier: deterministic
    rule: |
      memory.fetch_context span has attribute memory.context.query_used = true

  # Were injected observations relevant to the prompt?
  - name: injection-relevance
    type: quality
    description: "Injected observations are relevant to the user's prompt"
    verifier: llm-judge
    prompt: |
      The user's prompt to the agent was:
      <prompt>
      {{.UserPrompt}}
      </prompt>

      The following observations were injected into the agent's context:
      <injected_observations>
      {{range .InjectedObservations}}
      - [{{.Type}}] {{.Title}} (rank: {{.Rank}}, method: {{.Method}})
      {{end}}
      </injected_observations>

      Score the injection quality (1-5):
      1. Relevance: Are the injected observations related to what the user asked?
      2. Noise: Were irrelevant observations included that waste context?

      Respond as JSON: {"relevance": N, "noise": N, "reasoning": "..."}

  # BM25 ranking sanity check
  - name: bm25-ranking-order
    type: structural
    description: "Higher-ranked observations appear before lower-ranked ones"
    verifier: deterministic
    rule: |
      when method = fts5_bm25:
        observations are ordered by rank (ascending, since BM25 returns negative scores)
```

---

## 6. Regression Detection

### Baseline Definition

Baselines are defined from scratch (not snapshotted from current behavior).
Each baseline is a JSON file that specifies expected ranges for key metrics.

```json
// baselines/pr-reviewer.json
{
  "agent": "pr-reviewer",
  "version": "1.0.0",
  "created": "2026-04-14",
  "expectations": {
    "max_steps": 8,
    "max_total_tokens": 50000,
    "max_duration_seconds": 120,
    "required_tool_sequence": ["github_get_pr", "github_get_pr_diff"],
    "required_checks_pass": [
      "valid-structured-output",
      "diff-read-before-verdict",
      "pr-metadata-fetched",
      "tool-call-efficiency"
    ],
    "quality_thresholds": {
      "review-comment-quality": {
        "specificity": 3,
        "actionability": 3,
        "accuracy": 3,
        "completeness": 3
      }
    }
  }
}
```

### Regression Detection Logic

```
For each eval run:
  1. Run all checks → produce check results
  2. Load baseline for the agent
  3. Compare:
     - Did any required_checks_pass fail that previously passed?  → REGRESSION
     - Did max_steps / max_tokens / max_duration exceed baseline? → REGRESSION
     - Did quality scores drop below thresholds?                  → REGRESSION
  4. Emit regression report with specific diffs
```

---

## 7. Report Format

```json
{
  "evalId": "eval-pr-reviewer-2026-04-14T10:30:00Z",
  "agent": "pr-reviewer",
  "timestamp": "2026-04-14T10:30:00Z",
  "tracesEvaluated": 5,
  "summary": {
    "totalChecks": 35,
    "passed": 30,
    "failed": 3,
    "skipped": 2,
    "score": 0.857,
    "regressions": 1
  },
  "traces": [
    {
      "traceId": "abc123...",
      "startTime": "2026-04-14T09:00:00Z",
      "duration": "45s",
      "steps": 4,
      "tokens": { "input": 12000, "output": 3500 },
      "checks": [
        {
          "name": "valid-structured-output",
          "type": "structural",
          "verifier": "deterministic",
          "passed": true,
          "details": "Output contains 'approve' verdict"
        },
        {
          "name": "diff-read-before-verdict",
          "type": "behavioral",
          "verifier": "deterministic",
          "passed": true,
          "details": "github_get_pr_diff called at step 1, verdict at step 3"
        },
        {
          "name": "review-comment-quality",
          "type": "quality",
          "verifier": "llm-judge",
          "passed": true,
          "scores": {
            "specificity": 4,
            "actionability": 5,
            "accuracy": 4,
            "completeness": 3
          },
          "reasoning": "Review references specific function names and line ranges..."
        }
      ]
    }
  ],
  "regressions": [
    {
      "check": "token-budget",
      "baseline": 50000,
      "actual": 52300,
      "delta": "+4.6%",
      "trace": "def456..."
    }
  ],
  "baseline": {
    "version": "1.0.0",
    "file": "baselines/pr-reviewer.json"
  }
}
```

---

## 8. CLI Interface

```
agentops-eval [flags]

Commands:
  run       Run evals for one or more agents
  report    Display a previous eval report
  baseline  Manage baselines (create, update, diff)

Flags:
  --agent string       Agent name to evaluate (required for run)
  --agents strings     Comma-separated agent names (evaluates all)
  --tempo-url string   Tempo base URL (default: tempo.observability.svc.cluster.local:3200)
  --since duration     Look back window for traces (default: 24h)
  --limit int          Max traces to evaluate per agent (default: 10)
  --profile-dir string Path to eval profiles (default: ./eval-profiles/)
  --baseline-dir string Path to baselines (default: ./baselines/)
  --output string      Output file path (default: stdout)
  --judge              Enable LLM-as-judge checks (default: false)
  --judge-model string Model for LLM judge (default: from env EVAL_JUDGE_MODEL)
  --judge-provider string Provider for LLM judge (default: from env EVAL_JUDGE_PROVIDER)
  --verbose            Show individual check details

Examples:
  # Eval pr-reviewer, last 24h, deterministic only
  agentops-eval run --agent pr-reviewer

  # Eval all three target agents with LLM judge
  agentops-eval run --agents pr-reviewer,cluster-healthcheck,ci-watcher --judge

  # Eval with custom time window
  agentops-eval run --agent cluster-healthcheck --since 72h --limit 20

  # Create a new baseline from current eval results
  agentops-eval baseline create --agent pr-reviewer --from-eval eval-pr-reviewer-2026-04-14.json

  # Compare current eval against baseline
  agentops-eval run --agent pr-reviewer --baseline-dir ./baselines/
```

---

## 9. Justfile Recipes

Added to `local_k3s/deploy/justfile`:

```just
# ─── Eval ───────────────────────────────────────────────────────

# Run eval for a specific agent (deterministic checks only)
eval agent:
    agentops-eval run --agent {{agent}} --tempo-url http://tempo.observability.svc.cluster.local:3200

# Run eval for a specific agent with LLM judge
eval-full agent:
    agentops-eval run --agent {{agent}} --judge --tempo-url http://tempo.observability.svc.cluster.local:3200

# Run all three target agents
eval-all:
    agentops-eval run --agents pr-reviewer,cluster-healthcheck,ci-watcher --tempo-url http://tempo.observability.svc.cluster.local:3200

# Run all with LLM judge
eval-all-full:
    agentops-eval run --agents pr-reviewer,cluster-healthcheck,ci-watcher --judge --tempo-url http://tempo.observability.svc.cluster.local:3200

# Create baseline from last eval
eval-baseline agent:
    agentops-eval baseline create --agent {{agent}}

# Show last eval report
eval-report agent:
    agentops-eval report --agent {{agent}}
```

---

## 10. Project Structure

```
agentops-eval/
├── cmd/
│   └── eval/
│       └── main.go              # CLI entry point (cobra)
├── internal/
│   ├── tempo/
│   │   ├── client.go            # Tempo HTTP client
│   │   └── parser.go            # OTLP JSON → EvalTrace
│   ├── engine/
│   │   ├── engine.go            # Eval orchestrator
│   │   ├── profile.go           # Profile loader (YAML → checks)
│   │   └── runner.go            # Check runner (dispatches to verifiers)
│   ├── verifier/
│   │   ├── structural.go        # Structural checks (output format, tool sequence)
│   │   ├── behavioral.go        # Behavioral checks (tool ordering, detection accuracy)
│   │   ├── efficiency.go        # Efficiency checks (tokens, steps, duration)
│   │   └── quality.go           # LLM-as-judge integration
│   ├── baseline/
│   │   ├── baseline.go          # Baseline loading and comparison
│   │   └── regression.go        # Regression detection logic
│   ├── report/
│   │   └── report.go            # JSON report generation
│   └── model/
│       └── types.go             # EvalTrace, EvalStep, CheckResult, etc.
├── eval-profiles/
│   ├── pr-reviewer.yaml
│   ├── cluster-healthcheck.yaml
│   ├── ci-watcher.yaml
│   └── _memory-injection.yaml   # Shared memory checks
├── baselines/
│   ├── pr-reviewer.json
│   ├── cluster-healthcheck.json
│   └── ci-watcher.json
├── go.mod
├── go.sum
├── Makefile
├── Dockerfile
└── .github/
    └── workflows/
        ├── ci.yaml
        └── release.yaml
```

---

## 11. Implementation Phases

### Phase 1: Foundation (MVP)
**Goal:** Eval binary can fetch traces from Tempo, parse them, and run basic
deterministic checks for one agent (pr-reviewer).

- [ ] Scaffold Go project with cobra CLI
- [ ] Implement Tempo HTTP client (reuse patterns from console BFF `traces.go`)
- [ ] Implement OTLP JSON parser → `EvalTrace` model
- [ ] Implement YAML profile loader
- [ ] Implement structural verifiers (output format validation)
- [ ] Implement behavioral verifiers (tool sequence checks)
- [ ] Implement efficiency verifiers (token/step/duration budgets)
- [ ] JSON report output to stdout
- [ ] pr-reviewer profile with all deterministic checks
- [ ] `just eval` recipe

**Deliverable:** `agentops-eval run --agent pr-reviewer` produces a JSON report.

### Phase 2: Multi-Agent + Baselines
**Goal:** Eval all three agents, baseline comparison, regression detection.

- [ ] cluster-healthcheck profile
- [ ] ci-watcher profile
- [ ] Baseline JSON format and loader
- [ ] Regression detection logic (compare eval results vs baseline)
- [ ] `baseline create` subcommand
- [ ] `--agents` flag for multi-agent runs

**Deliverable:** `agentops-eval run --agents pr-reviewer,cluster-healthcheck,ci-watcher`
with regression detection against baselines.

### Phase 3: LLM Judge
**Goal:** Add LLM-as-judge for quality checks.

- [ ] LLM judge client (generic, supports multiple providers via env config)
- [ ] Quality verifier implementation (template rendering + LLM call + JSON parse)
- [ ] Quality checks for all three agent profiles
- [ ] `--judge` flag
- [ ] Quality score thresholds in baselines

**Deliverable:** `agentops-eval run --agent pr-reviewer --judge` includes quality scores.

### Phase 4: Memory Injection Evaluation
**Goal:** Evaluate BM25 context injection quality using agentops-memory's OTEL audit trail.

- [ ] Parse `memory.fetch_context` spans and `context.injected` events from traces
- [ ] Implement `_memory-injection.yaml` shared checks
- [ ] Add memory injection checks to agents that have `spec.memory` configured
- [ ] Precision/recall metrics for injection relevance (LLM-judged)

**Deliverable:** Memory injection quality metrics in eval reports for memory-enabled agents.

### Phase 5: CRD Promotion (Future)
**Goal:** Promote the stable eval logic into an `AgentEval` CRD managed by the operator.

- [ ] Define AgentEval CRD types
- [ ] Implement eval controller in agentops-core
- [ ] Store eval results in CRD `.status`
- [ ] Console integration (eval results panel)
- [ ] Trigger evals on Agent/AgentRun changes

**Not in current scope** — revisit once phases 1-4 are stable.

---

## 12. Open Decisions

1. **LLM judge model** — Which model for judging? Using the same model the agent uses
   creates self-evaluation bias. Using a different/stronger model is more objective but
   costs more. Recommendation: use a different model than the agents use.

2. **Trace selection strategy** — When an agent has 100 traces in the last 24h, which
   10 do we pick? Options: most recent, random sample, stratified (mix of
   short/long/error/success). Recommendation: stratified sampling.

3. **Eval frequency** — How often should evals run? Options: on-demand only, daily cron,
   after every release. Recommendation: on-demand for now, daily cron in phase 2.

4. **Known-issue test fixtures** — pr-reviewer's `known-issue-detection` check needs
   test PRs with planted issues. How to create these? Options: actual GitHub PRs in a
   test repo, synthetic tool outputs. Deferred to phase 2.

5. **Console visibility before CRD** — Should the console show eval reports before the
   CRD exists? Could add a simple file-serving endpoint. Deferred to phase 5.

---

## 13. Relationship to Other Plans

| Plan | Relationship |
|------|-------------|
| `PLAN.md` (master spec) | Evals validate that CRD changes don't break agent behavior |
| `PLAN_delegation.md` | Once delegation is implemented, add delegation trace eval checks |
| `PLAN_intent-tools.md` | New tool tiers need new eval profiles / allowed tool sets |
| `PLAN_provider-crd.md` | Provider CRD changes could affect model fallback behavior — eval catches regressions |
| `PLAN_security-hardening.md` | ToolHooks and network policies should not break eval runs |
