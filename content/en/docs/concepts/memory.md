---
title: "Memory"
linkTitle: "Memory"
weight: 2
description: "Three-layer memory model, context injection, write deduplication, and the agentops-memory service."
---

Memory is the key differentiator of the AgentOps platform. Instead of treating each agent session as stateless, AgentOps implements a **three-layer memory architecture** that gives agents persistent, searchable, relevance-ranked context across sessions and restarts.

The system is split between the **Fantasy runtime** (in-process working memory) and **agentops-memory** (persistent short-term and long-term storage). No LLM calls are involved in memory management — summarization is deterministic, retrieval is BM25-ranked full-text search.

## Three-layer model

### Layer 1: Working memory (ephemeral)

Working memory is an unbounded list of `fantasy.Message` objects held in Go runtime memory. It represents the current conversation — every user prompt, assistant response, tool call, and tool result.

**Token budget trimming.** Before each turn, the runtime calls `TrimToTokenBudget()` which removes messages from the front of the window until the estimated token count fits within the model's context window budget. Trimming respects message boundaries — it never orphans a tool result from its corresponding tool call.

**Crash recovery.** Working memory is checkpointed to the agent's PVC (for daemon agents). The checkpoint includes:
- All messages in the window
- The memory service session ID
- Tool metadata (`toolMeta` map of tool call ID to client metadata JSON)
- Delegation group state

On restart, the runtime restores from the checkpoint and reconnects to the same memory service session.

Working memory is **ephemeral by design** — it represents the active conversation, not accumulated knowledge. It is not queryable by other agents or the console.

### Layer 2: Short-term memory (session summaries)

When a session ends (daemon shutdown or task completion), the runtime calls `POST /sessions/{id}/end` on the memory service with the conversation transcript. The memory service generates a **deterministic summary** — no LLM call:

1. Count total messages (user + assistant).
2. Extract the first user message content.
3. Extract the last user message content.
4. Truncate each to 200 runes.
5. Compose a structured summary string.

Session summaries are stored in agentops-memory's SQLite database and injected on every subsequent turn. They give the agent a sense of "what happened in recent sessions" without re-reading full transcripts.

**Example injected format:**

```xml
<memory:sessions>
- Session with 14 messages. Started: "Deploy the new memory service to staging" — Ended: "Can you verify the deployment rolled out cleanly?"
- Session with 8 messages. Started: "Fix the FTS5 index on the observations table" — Ended: "Run the test suite again"
</memory:sessions>
```

### Layer 3: Long-term memory (observations)

Observations are explicit, user- or agent-created memories: decisions made, bugs fixed, discoveries, lessons learned, architectural patterns, configuration choices. They persist indefinitely and are searchable via FTS5 BM25 relevance ranking.

Observations are created in three ways:
1. **Agent-initiated** via the `mem_save` MCP tool (when `autoSave: true`).
2. **User-initiated** via the console Memory panel.
3. **Declarative** via `toolHooks.memorySaveRules` that auto-capture tool results matching a pattern.

Each observation has:

| Field | Description |
|-------|-------------|
| `type` | Category: `decision`, `discovery`, `bugfix`, `pattern`, `architecture`, `config`, `learning`, `preference` |
| `title` | Brief summary of what was learned or decided |
| `content` | Detailed content — what, why, how to apply |
| `tags` | Optional categorization tags |
| `project` | Scoped to the agent's memory project |
| `scope` | `project` (default) or `global` |
| `topic_key` | Optional dedup key for upsert behavior |

## Context injection flow

On every turn, the runtime injects memory context into the agent's prompt. Here is the exact flow:

{{< img src="images/context-injection.svg" alt="Memory Context Injection Flow" >}}

### Query truncation

The runtime truncates the user prompt to 500 characters before passing it as the `query` parameter. This captures the user's intent without sending full payloads to the search index.

### Content truncation

The memory service truncates each observation's content to 300 runes before returning it in the context response. This bounds the token cost of memory injection while preserving the most relevant information.

### Observability

Every context injection call produces OTEL spans with per-observation attributes. You can trace in Tempo exactly which memories were injected for a given turn, how they were ranked, and which retrieval method was used.

## Three-tier write deduplication

When a new observation is saved (via `mem_save`, console, or auto-capture), the memory service applies three dedup tiers in order:

### Tier 1: Topic-key upsert

If the observation includes a `topic_key` and an existing observation matches `(topic_key, project, scope)`:

- **UPDATE** the existing row in place.
- Bump `revision_count`.
- Update content, title, and timestamp.

This is the primary mechanism for evolving knowledge — the agent can save the same topic key repeatedly and the observation grows instead of duplicating.

### Tier 2: Hash deduplication

Compute SHA-256 of the normalized content (lowercased, whitespace-collapsed). If an existing observation in the same project has the same hash within a configurable time window (default: 15 minutes):

- **Do not insert**. Bump `duplicate_count` on the existing row.
- Return the existing observation ID.

This catches exact or near-exact duplicates when the agent calls `mem_save` multiple times with the same content in a short window.

### Tier 3: New insert

If neither tier 1 nor tier 2 matches, perform a standard `INSERT`. The observation is new.

{{< img src="images/write-dedup.svg" alt="Three-Tier Write Dedup" >}}

## MCP tools for agents

When `memory` is configured on an Agent, the runtime registers three MCP tools that the agent can call directly:

### `mem_save`

Save an observation to long-term memory. The agent is encouraged to call this proactively after completing meaningful work.

```json
{
  "type": "decision",
  "title": "Use WAL mode for SQLite in agentops-memory",
  "content": "Switched to WAL mode to allow concurrent reads during writes. This eliminated the SQLITE_BUSY errors under load. Key config: PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  "tags": ["sqlite", "performance", "agentops-memory"]
}
```

### `mem_search`

Full-text search across all observations using FTS5 BM25 ranking. Returns matching observations sorted by relevance with type, title, content, and rank score.

```json
{
  "query": "SQLite WAL mode configuration",
  "limit": 10
}
```

### `mem_context`

Retrieve recent memory context (session summaries + observations). This is the same data that gets auto-injected on each turn, but the agent can explicitly request it to refresh its knowledge mid-conversation.

```json
{
  "limit": 5
}
```

## Agent CRD memory configuration

```yaml
memory:
  serverRef: agentops-memory       # Service name or AgentTool CR name
  project: my-agent                # Scopes all memories; defaults to agent name
  contextLimit: 5                  # Observations injected per turn (0-50)
  windowSize: 20                   # Working memory sliding window (2-200)
  autoSummarize: true              # Session summaries on end
  autoSave: true                   # Agent can call mem_save autonomously
  autoSearch: true                 # Agent can call mem_search autonomously
```

| Field | Default | Description |
|-------|---------|-------------|
| `serverRef` | required | Memory service reference. Resolved to `http://<name>.<namespace>.svc.cluster.local:7437`. |
| `project` | agent name | Scopes all sessions and observations. Multiple agents can share a project. |
| `contextLimit` | `5` | Max observations returned by `/context`. Higher = more context, more tokens. |
| `windowSize` | `20` | Soft target for working memory messages. Actual trimming is token-budget based. |
| `autoSummarize` | `true` | Generate session summary on session end. |
| `autoSave` | `true` | Register `mem_save` tool. Set `false` to restrict memory creation to console-only. |
| `autoSearch` | `true` | Register `mem_search` tool. Set `false` to prevent autonomous memory search. |

## Declarative memory hooks

The `toolHooks` spec on the Agent CRD enables declarative memory integration without agent-side logic:

```yaml
toolHooks:
  # Auto-save tool results as observations
  memorySaveRules:
    - tool: bash
      matchOutput: "error|panic|fatal"
      type: bugfix
      scope: project
    - tool: kubectl_apply
      type: decision
      scope: project

  # Pre-execution memory queries
  contextInjectTools:
    - tool: bash
      query: from_tool_args    # use the tool's arguments as search query
      limit: 3
```

### Memory save rules

Each `memorySaveRules` entry matches a tool name and optionally filters by output regex and/or argument patterns. When a match fires, the tool result is automatically saved as an observation with the configured type and scope.

### Context inject tools

Each `contextInjectTools` entry triggers a memory search before the specified tool runs. The search results are recorded in the OTEL trace (not injected into the prompt — they serve as observability breadcrumbs for understanding agent behavior).

## agentops-memory service

The memory service is a standalone Go binary (~1300 lines of code) with the following characteristics:

| Property | Value |
|----------|-------|
| Language | Go (pure, `CGO_ENABLED=0`) |
| Database | SQLite with FTS5 extension |
| Tokenizer | Porter stemmer + unicode61 |
| Connection pools | Split read/write (WAL mode) |
| Container image | `ghcr.io/samyn92/agentops-memory` (distroless) |
| Port | 7437 |
| Cluster DNS | `agentops-memory.agents.svc.cluster.local` |

### FTS5 BM25 ranking

Full-text search uses SQLite FTS5 with BM25 relevance scoring. The FTS index covers observation `title` and `content` columns with the Porter stemmer for English-language stemming and the unicode61 tokenizer for broad character support.

When a query is provided to `/context`, observations are ranked by BM25 score. When the FTS query returns fewer results than the requested limit, the service backfills with recency-sorted observations to ensure the agent always gets useful context.

### REST API contract

The memory service exposes a REST API consumed by both the runtime and the console BFF:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sessions` | POST | Create a new session |
| `/sessions/{id}/end` | POST | End a session with transcript |
| `/observations` | POST | Save an observation |
| `/context` | GET | Fetch injected context (sessions + observations) |
| `/search` | GET | Full-text search across observations |
| `/health` | GET | Liveness probe |

The console BFF proxies this API unchanged — zero BFF code changes were needed when agentops-memory replaced the original memory system.
