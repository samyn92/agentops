---
title: "Observability"
linkTitle: "Observability"
weight: 5
description: "Distributed tracing, real-time streaming, and context window visibility across the entire AgentOps stack."
---

Every component in AgentOps emits OpenTelemetry traces. The runtime follows the GenAI semantic conventions for LLM-specific attributes. The console proxies traces from Tempo and enriches them with delegation metadata from AgentRun CRDs.

## Runtime tracing

The agent runtime produces rich OTEL spans for every operation in the agent loop:

### Span hierarchy

```
invoke_agent (root span)
├── gen_ai.stream / gen_ai.generate (per LLM call)
│   ├── tool.call events (recorded on the gen_ai span)
│   └── content events (prompt, completion, tool I/O)
├── memory.inject (context injection)
├── memory.save (observation writes)
└── pre_flight_budget (token estimation)
```

### GenAI semantic convention attributes

Every LLM span carries standard attributes:

| Attribute | Example |
|-----------|---------|
| `gen_ai.operation.name` | `chat`, `invoke_agent` |
| `gen_ai.provider.name` | `anthropic`, `openai`, `google` |
| `gen_ai.request.model` | `claude-sonnet-4-20250514` |
| `gen_ai.response.model` | `claude-sonnet-4-20250514` |
| `gen_ai.usage.input_tokens` | `12847` |
| `gen_ai.usage.output_tokens` | `3291` |
| `gen_ai.usage.reasoning_tokens` | `1024` |
| `gen_ai.usage.cache_read_tokens` | `8192` |
| `gen_ai.request.temperature` | `0.3` |
| `gen_ai.response.finish_reasons` | `stop` |

### Tool call events

Tool executions are recorded as `tool.call` events on the `gen_ai.generate` span. Each event includes:

- `gen_ai.tool.name` --- the tool that was called
- `gen_ai.tool.call.id` --- unique call ID
- Tool input and output (truncated to prevent span bloat)

This approach ensures that even if individual tool spans are dropped or not exported, the `gen_ai.generate` span always carries a complete record of tool activity.

### Pre-flight token budgeting

Before each LLM call, the runtime estimates token usage across five layers:

```
┌─────────────────────────────────────────────┐
│          Context Window (200K)              │
│                                             │
│  ┌─────────┐  Estimated by chars/4          │
│  │ System  │  heuristic (intentionally      │
│  │ prompt  │  conservative)                 │
│  ├─────────┤                                │
│  │ Tool    │                                │
│  │ schemas │                                │
│  ├─────────┤                                │
│  │ Memory  │  Session summaries +           │
│  │ context │  relevant observations         │
│  ├─────────┤                                │
│  │ Conver- │  Working memory trimmed        │
│  │ sation  │  to fit remaining budget       │
│  ├─────────┤                                │
│  │ User    │                                │
│  │ prompt  │                                │
│  ├─────────┤                                │
│  │ Output  │  25% reserved for              │
│  │ reserve │  generation headroom           │
│  └─────────┘                                │
└─────────────────────────────────────────────┘
```

The budget allocator produces a `pre_flight_budget` span and trims the working memory (oldest messages first) to fit the conversation budget. A reactive stop condition halts the agent loop if actual `InputTokens` from the API response exceeds the budget.

## Cross-agent trace propagation

When an agent delegates via `run_agent` or `run_agents`, trace context flows through the AgentRun CR:

1. **Parent side** --- the `run_agents` tool call span records:
   - `delegation.group_id`
   - `delegation.count`
   - `delegation.run_names`
   - `delegation.child_agent`, `delegation.child_run`, `delegation.child_namespace` (for single `run_agent`)

2. **CR transport** --- the AgentRun CR carries the W3C traceparent in `annotations["agents.agentops.io/traceparent"]`.

3. **Child side** --- when the child agent starts, it:
   - Parses the traceparent annotation
   - Creates a **span link** (not a parent-child relationship) back to the parent's span, preserving independent trace IDs
   - Sets attributes: `delegation.parent_trace_id`, `delegation.parent_span_id`, `delegation.parent_agent`, `delegation.run_name`

```
Parent trace (trace-id: aaa...)          Child trace (trace-id: bbb...)
┌──────────────────────┐                 ┌──────────────────────┐
│ invoke_agent         │                 │ invoke_agent         │
│ └─ run_agents        │  span link ──── │ (delegation attrs)   │
│    delegation.group  │                 │ └─ gen_ai.generate   │
│    delegation.count  │                 │    └─ tool.call...   │
└──────────────────────┘                 └──────────────────────┘
```

The console uses these attributes and links to build a delegation tree, enabling parent-to-child trace navigation without requiring a shared trace ID.

## Memory service tracing

The agentops-memory service (`agentops-memory`) produces a span for every HTTP handler. Key spans:

### `memory.fetch_context`

The context injection span is the most important for debugging relevance. It records:

- `memory.context.method` --- `fts5_bm25` (when a query is provided) or `recency` (fallback)
- `memory.context.result_count` --- how many observations were injected
- `memory.context.query_used` --- whether the caller passed a search query

**Per-observation injection audit trail**: the span emits an event for each injected observation with:

| Event attribute | Description |
|----------------|-------------|
| `memory.injected.observation_id` | Database row ID |
| `memory.injected.type` | `decision`, `discovery`, `lesson_learned`, etc. |
| `memory.injected.title` | Observation title |
| `memory.injected.rank` | BM25 rank (when using FTS5) or recency position |
| `memory.injected.method` | `fts5_bm25` or `recency` |

This means you can open any agent's trace, find the `memory.fetch_context` span, and see exactly which observations were injected and why --- ranked by relevance score.

### Other memory spans

- `memory.search` --- FTS5 search with `memory.search.query` and `memory.search.result_count`
- `memory.observation.write` --- records `memory.observation.action` (`created`, `updated`, `deduplicated`), `memory.observation.type`, and `memory.observation.id`
- `memory.session` --- session operations with `memory.session.id` and `memory.session.message_count`

## Console trace integration

The console BFF proxies Tempo's HTTP API and enriches trace data before sending it to the frontend:

1. **Tempo proxy** --- `/api/v1/traces/{traceID}` fetches the OTLP trace and transforms it to Jaeger-compatible format for the frontend.
2. **Delegation tree enrichment** --- the BFF looks up AgentRun CRDs matching the trace ID and builds a tree of parent/child relationships, adding delegation metadata that Tempo alone doesn't have.
3. **Tool call extraction** --- `tool.call` events from `gen_ai.generate` spans are extracted and presented as virtual rows in the timeline.
4. **Waterfall swimlane view** --- spans are grouped by service/agent and rendered as a horizontal waterfall with swimlanes.
5. **Span detail panel** --- clicking a span shows all attributes, events, and links with formatted GenAI semantic convention data.

## Fantasy Event Protocol (FEP)

FEP is the real-time streaming protocol between agent runtimes and the console. Events are delivered over **Server-Sent Events (SSE)** and cover the full agent lifecycle:

### Event categories

| Category | Events | Purpose |
|----------|--------|---------|
| **Agent lifecycle** | `agent_start`, `agent_finish`, `agent_error` | Session boundaries |
| **Step lifecycle** | `step_start`, `step_finish` | Agent loop iterations |
| **Text streaming** | `text_start`, `text_delta`, `text_end` | Token-by-token response |
| **Reasoning** | `reasoning_start`, `reasoning_delta`, `reasoning_end` | Chain-of-thought streaming |
| **Tool input** | `tool_input_start`, `tool_input_delta`, `tool_input_end` | Tool argument streaming |
| **Tool execution** | `tool_call`, `tool_result` | Tool invocation and results |
| **Sources** | `source` | Citations and references |
| **Warnings** | `warnings` | Runtime warnings |
| **Stream finish** | `stream_finish` | Per-step completion with usage |
| **Permission gates** | `permission_asked`, `permission_replied` | Tool approval workflow |
| **Interactive questions** | `question_asked`, `question_replied` | Agent-to-user questions (single/multi-select) |
| **Delegation** | `delegation.fan_out`, `delegation.run_completed`, `delegation.all_completed`, `delegation.timeout` | Parallel fan-out lifecycle |
| **Session control** | `session_idle`, `session_status` | Agent busy/idle/waiting state |

Every event carries a `timestamp` (RFC3339 UTC) and relevant metadata. Tool results include a `metadata` field with a `ui` hint that the console uses to dispatch to the appropriate tool card renderer.

## SSE multiplexer

The console BFF runs an SSE multiplexer that connects to all running daemon agents and fans out their FEP events to browser clients:

```
Agent pods                    Console BFF                  Browser
┌──────────┐                 ┌──────────────┐            ┌─────────┐
│ agent-1  │──SSE──┐         │              │            │         │
│ :4096    │       │         │  Multiplexer │──SSE────── │ Client  │
├──────────┤       ├────────▶│              │            │         │
│ agent-2  │──SSE──┘    ┌───▶│  Fan-out to  │──SSE────── │ Client  │
│ :4096    │            │    │  all browser │            │         │
├──────────┤            │    │  clients     │            └─────────┘
│ agent-3  │──SSE───────┘    │              │
│ :4096    │                 └──────────────┘
└──────────┘
```

- **Per-agent health polling** with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s cap) for reconnection on disconnect.
- Agent connections are managed by a K8s informer --- when an Agent CR is created, modified, or deleted, the multiplexer starts, updates, or tears down the SSE connection.
- 15-second heartbeat keeps connections alive through proxies and load balancers.
- Events are enveloped with agent namespace/name for client-side routing.

## Context window usage indicator

The console composer displays a real-time breakdown of context window utilization based on the pre-flight token budget:

```
┌──────────────────────────────────────────────────┐
│ Context: 67% of 200K                             │
│ ██████████████████████████████░░░░░░░░░░░░░░░░░░ │
│ System: 12K │ Tools: 8K │ Memory: 4K │ Conv: 40K │
└──────────────────────────────────────────────────┘
```

The breakdown shows system prompt, tool schemas, injected memory context, conversation history, and remaining headroom. This helps users understand when an agent is approaching its context limit and why --- whether it's tool schemas consuming too much space, a large conversation history, or heavy memory injection.
