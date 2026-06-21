---
title: "Memory API"
linkTitle: "Memory API"
weight: 2
description: "REST API reference for the agentops-memory service."
---

The agentops-memory service provides a REST API for managing sessions, observations, search, and context injection. It runs as a standalone Go binary backed by SQLite with FTS5 for BM25 relevance-ranked full-text search.

**Image:** `ghcr.io/samyn92/agentops-memory`
**Default port:** `7437`
**In-cluster DNS:** `agentops-memory.agents.svc.cluster.local:7437`

## Input validation

All endpoints enforce the following limits:

| Constraint | Limit |
|-----------|-------|
| Request body size | 1 MiB |
| Title length | 500 characters |
| Content length | 50,000 characters |
| Topic key length | 200 characters |
| Scope length | 50 characters |
| Type length | 50 characters |
| Tag length | 100 characters per tag |
| Tag count | 20 tags per observation |
| Project length | 200 characters |
| Query result limit | 1,000 rows maximum |

---

## Health

### GET /health

Health check endpoint.

**Response:**

```json
{"status": "ok"}
```

---

## Sessions

Sessions group agent interactions. The runtime creates a session at the start of each conversation and ends it when the session concludes. Ending a session triggers deterministic summary extraction (no LLM call).

### POST /sessions

Create a new session.

**Request body:**

```json
{
  "id": "session-uuid-here",
  "project": "my-agent"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique session identifier. |
| `project` | string | Yes | Project name for scoping. |

**Response:** `201 Created`

```json
{
  "id": "session-uuid-here",
  "project": "my-agent",
  "started_at": "2026-04-12T10:00:00Z",
  "message_count": 0
}
```

### POST /sessions/{id}/end

End a session. Provide the conversation messages for deterministic summary generation.

**Request body:**

```json
{
  "messages": [
    {"role": "user", "content": "Fix the deployment timeout"},
    {"role": "assistant", "content": "I found the issue..."}
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | []SessionMessage | Yes | Conversation messages for summary extraction. |
| `messages[].role` | string | Yes | Message role (`user` or `assistant`). |
| `messages[].content` | string | Yes | Message content. |

**Response:** `200 OK`

```json
{
  "session_id": "session-uuid-here",
  "summary": "Fixed deployment timeout by adjusting...",
  "message_count": 2
}
```

### GET /sessions/recent

List recent sessions.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `project` | string | -- | Filter by project. |
| `limit` | int | 5 | Maximum number of sessions to return. |

**Response:** `200 OK`

```json
[
  {
    "id": "session-uuid",
    "project": "my-agent",
    "started_at": "2026-04-12T10:00:00Z",
    "ended_at": "2026-04-12T10:15:00Z",
    "summary": "Fixed deployment timeout...",
    "message_count": 12
  }
]
```

---

## Observations

Observations are the core memory units -- decisions, bugfixes, discoveries, lessons learned. They support three-tier write dedup: topic_key upsert, hash dedup within a 15-minute window, and new insert.

### POST /observations

Create an observation. The response indicates whether the observation was created, updated (via topic_key), or deduplicated (via content hash).

**Request body:**

```json
{
  "session_id": "session-uuid",
  "type": "decision",
  "title": "Use SQLite for memory storage",
  "content": "Chose SQLite with FTS5 over PostgreSQL because...",
  "tags": ["architecture", "database"],
  "project": "my-agent",
  "scope": "project",
  "topic_key": "memory-storage-choice"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | string | Yes | Session that produced this observation. |
| `type` | string | Yes | Observation type (e.g. `decision`, `bugfix`, `discovery`, `lesson`). |
| `title` | string | Yes | Short title (max 500 chars). |
| `content` | string | Yes | Full content (max 50K chars). |
| `project` | string | Yes | Project name for scoping. |
| `tags` | []string | No | Tags for categorization (max 20). |
| `scope` | string | No | Scope: `project` or `global`. |
| `topic_key` | string | No | Unique topic key for upsert behavior (max 200 chars). |

**Response:** `201 Created`

```json
{
  "id": 42,
  "action": "created",
  "revision_count": 1,
  "duplicate_count": 0
}
```

The `action` field indicates what happened:

| Action | Description |
|--------|-------------|
| `created` | New observation inserted. |
| `updated` | Existing observation with the same `topic_key` was updated. |
| `deduplicated` | Content hash matched an observation within the 15-minute dedup window. |

### GET /observations/recent

List recent observations.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `project` | string | -- | Filter by project. |
| `type` | string | -- | Filter by observation type. |
| `scope` | string | -- | Filter by scope. |
| `limit` | int | 20 | Maximum number of observations to return. |

**Response:** `200 OK` -- array of Observation objects.

### GET /observations/{id}

Get a single observation by ID.

**Response:** `200 OK`

```json
{
  "id": 42,
  "session_id": "session-uuid",
  "type": "decision",
  "title": "Use SQLite for memory storage",
  "content": "Chose SQLite with FTS5 over PostgreSQL because...",
  "tags": ["architecture", "database"],
  "project": "my-agent",
  "scope": "project",
  "topic_key": "memory-storage-choice",
  "normalized_hash": "a1b2c3...",
  "revision_count": 1,
  "duplicate_count": 0,
  "last_seen_at": "2026-04-12T10:05:00Z",
  "created_at": "2026-04-12T10:05:00Z",
  "updated_at": "2026-04-12T10:05:00Z"
}
```

### PATCH /observations/{id}

Update an observation's fields. Only provided fields are updated.

**Request body:**

```json
{
  "type": "lesson",
  "title": "Updated title",
  "content": "Updated content...",
  "tags": ["new-tag"]
}
```

All fields are optional. Only provided fields are updated.

**Response:** `200 OK` -- the updated Observation object.

### DELETE /observations/{id}

Delete an observation. Soft delete by default, pass `?hard=true` for permanent deletion.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `hard` | bool | `false` | `true` for permanent deletion. |

**Response:** `204 No Content`

---

## Search

### GET /search

Full-text search across observations using FTS5 BM25 relevance ranking.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | -- | Search query. |
| `project` | string | -- | Filter by project. |
| `type` | string | -- | Filter by observation type. |
| `scope` | string | -- | Filter by scope. |
| `limit` | int | 10 | Maximum results. |

**Response:** `200 OK`

```json
[
  {
    "id": 42,
    "type": "decision",
    "title": "Use SQLite for memory storage",
    "content": "Chose SQLite with FTS5...",
    "rank": -2.345,
    "topic_key": "memory-storage-choice"
  }
]
```

The `rank` field is the BM25 score from SQLite FTS5. Lower (more negative) values indicate higher relevance.

---

## Context

### GET /context

The critical endpoint for context injection. Returns session summaries and relevant observations for injection into the agent's context window. When a `query` parameter is provided, observations are ranked by BM25 relevance. Without a query, observations are ranked by recency.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `project` | string | -- | Filter by project. |
| `scope` | string | -- | Filter by scope. |
| `query` | string | -- | Search query for relevance ranking. When provided, uses FTS5 BM25. |
| `limit` | int | 5 | Maximum observations to return. |

**Response:** `200 OK`

```json
{
  "recent_sessions": [
    {"summary": "Fixed deployment timeout by adjusting probe settings."}
  ],
  "recent_observations": [
    {
      "type": "decision",
      "title": "Use SQLite for memory storage",
      "content": "Chose SQLite with FTS5..."
    }
  ]
}
```

Each injected observation is recorded as an OTEL span event (`context.injected`) with the observation ID, type, title, rank, and method (`fts5_bm25` or `recency`). This creates a full audit trail of what context the agent received.

---

## Timeline

### GET /timeline

Get a timeline of observations around a specific observation. Useful for understanding the sequence of events.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `observation_id` | int64 | -- | **Required.** The observation to center on. |
| `before` | int | 3 | Number of observations before the target. |
| `after` | int | 3 | Number of observations after the target. |

**Response:** `200 OK`

```json
[
  {
    "id": 40,
    "type": "discovery",
    "title": "Found memory leak in worker pool",
    "content": "...",
    "created_at": "2026-04-12T09:50:00Z"
  },
  {
    "id": 42,
    "type": "bugfix",
    "title": "Fixed memory leak",
    "content": "...",
    "created_at": "2026-04-12T10:05:00Z"
  }
]
```

---

## Statistics

### GET /stats

Get aggregate statistics.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `project` | string | -- | Filter by project. |

**Response:** `200 OK`

```json
{
  "total_sessions": 47,
  "total_observations": 312,
  "projects": ["agent-alpha", "agent-beta"]
}
```

---

## Export / Import

### GET /export

Export all data (sessions and observations).

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `project` | string | -- | Filter by project. |

**Response:** `200 OK`

```json
{
  "exported_at": "2026-04-12T12:00:00Z",
  "sessions": [...],
  "observations": [...]
}
```

### POST /import

Import previously exported data.

**Request body:** ExportData object (same format as the export response).

**Response:** `200 OK`

```json
{
  "imported_sessions": 47,
  "imported_observations": 312
}
```

---

## Three-tier write dedup

When creating observations, the memory service applies three levels of deduplication:

1. **Topic key upsert** -- if `topic_key` is set and an observation with the same `topic_key` exists in the same project, the existing observation is updated in place. The `revision_count` is incremented. Response action: `updated`.

2. **Hash dedup** -- if no topic key match, the content is normalized and hashed. If an observation with the same hash exists within the 15-minute dedup window, the write is deduplicated. The `duplicate_count` is incremented and `last_seen_at` is updated. Response action: `deduplicated`.

3. **New insert** -- if neither topic key nor hash matches, a new observation is created. Response action: `created`.
