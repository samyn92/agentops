// Fantasy Event Protocol (FEP) — Go types
// Shared between Fantasy runtime and console backend.
//
// Wire format: Go-natural snake_case for all field names and event types.
// Event types use underscore format: agent_start, text_delta, tool_call, etc.
package fep

import "encoding/json"

// ---- Usage ----

type Usage struct {
	InputTokens         int64 `json:"input_tokens"`
	OutputTokens        int64 `json:"output_tokens"`
	TotalTokens         int64 `json:"total_tokens"`
	ReasoningTokens     int64 `json:"reasoning_tokens"`
	CacheCreationTokens int64 `json:"cache_creation_tokens"`
	CacheReadTokens     int64 `json:"cache_read_tokens"`
}

type FinishReason string

const (
	FinishReasonStop          FinishReason = "stop"
	FinishReasonLength        FinishReason = "length"
	FinishReasonContentFilter FinishReason = "content-filter"
	FinishReasonToolCalls     FinishReason = "tool-calls"
	FinishReasonError         FinishReason = "error"
	FinishReasonOther         FinishReason = "other"
	FinishReasonUnknown       FinishReason = "unknown"
)

// ---- Events ----

// Event is the top-level FEP envelope. The Type field is the discriminator.
type Event struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp,omitempty"` // RFC3339 UTC — set by the runtime on every event

	// Agent lifecycle
	SessionID string `json:"session_id,omitempty"`
	Prompt    string `json:"prompt,omitempty"`

	// Step lifecycle
	StepNumber    int   `json:"step_number,omitempty"`
	ToolCallCount int   `json:"tool_call_count,omitempty"`
	StepCount     int   `json:"step_count,omitempty"`
	TotalUsage    Usage `json:"total_usage,omitempty"`

	// Text / Reasoning / Tool input streaming
	ID    string `json:"id,omitempty"`
	Delta string `json:"delta,omitempty"`

	// Tool execution
	ToolName         string          `json:"tool_name,omitempty"`
	Input            string          `json:"input,omitempty"`
	Output           string          `json:"output,omitempty"`
	IsError          bool            `json:"is_error,omitempty"`
	Metadata         json.RawMessage `json:"metadata,omitempty"`
	MediaType        string          `json:"media_type,omitempty"`
	Data             string          `json:"data,omitempty"` // base64
	ProviderExecuted bool            `json:"provider_executed,omitempty"`

	// Source
	SourceType string `json:"source_type,omitempty"`
	URL        string `json:"url,omitempty"`
	Title      string `json:"title,omitempty"`

	// Warnings
	Warnings []Warning `json:"warnings,omitempty"`

	// Stream finish
	Usage        Usage        `json:"usage,omitempty"`
	FinishReason FinishReason `json:"finish_reason,omitempty"`

	// Error
	Error     string `json:"error,omitempty"`
	Retryable bool   `json:"retryable,omitempty"`

	// Bidirectional: permission
	Description string `json:"description,omitempty"`
	Response    string `json:"response,omitempty"` // "once" | "always" | "deny"

	// Bidirectional: question
	Questions []Question `json:"questions,omitempty"`
	Answers   [][]string `json:"answers,omitempty"`

	// Session status
	Status string `json:"status,omitempty"` // "idle" | "busy" | "waiting"

	// Model info (on complete/finish)
	Model string `json:"model,omitempty"`
}

type Warning struct {
	Message string `json:"message"`
}

type Question struct {
	Header   string           `json:"header"`
	Question string           `json:"question"`
	Options  []QuestionOption `json:"options,omitempty"`
	Multiple bool             `json:"multiple,omitempty"`
}

type QuestionOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

// ---- Event Type Constants ----

const (
	// Agent lifecycle
	EventAgentStart  = "agent_start"
	EventAgentFinish = "agent_finish"
	EventAgentError  = "agent_error"

	// Step lifecycle
	EventStepStart  = "step_start"
	EventStepFinish = "step_finish"

	// Text streaming
	EventTextStart = "text_start"
	EventTextDelta = "text_delta"
	EventTextEnd   = "text_end"

	// Reasoning streaming
	EventReasoningStart = "reasoning_start"
	EventReasoningDelta = "reasoning_delta"
	EventReasoningEnd   = "reasoning_end"

	// Tool input streaming
	EventToolInputStart = "tool_input_start"
	EventToolInputDelta = "tool_input_delta"
	EventToolInputEnd   = "tool_input_end"

	// Tool execution
	EventToolCall   = "tool_call"
	EventToolResult = "tool_result"

	// Source
	EventSource = "source"

	// Warnings
	EventWarnings = "warnings"

	// Stream finish (per-step)
	EventStreamFinish = "stream_finish"

	// Bidirectional control
	EventPermissionAsked   = "permission_asked"
	EventPermissionReplied = "permission_replied"
	EventQuestionAsked     = "question_asked"
	EventQuestionReplied   = "question_replied"
	EventSessionIdle       = "session_idle"
	EventSessionStatus     = "session_status"

	// Delegation (parallel fan-out)
	EventDelegationFanOut       = "delegation.fan_out"
	EventDelegationRunCompleted = "delegation.run_completed"
	EventDelegationAllCompleted = "delegation.all_completed"
	EventDelegationTimeout      = "delegation.timeout"
)
