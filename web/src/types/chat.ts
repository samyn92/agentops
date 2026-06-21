// Chat types — UI-side message representations

import type { Usage, ToolMetadata } from "./fep"
import type { AgentRunOutcome } from "./api"

// ---- Message Parts ----

export interface TextPart {
  type: "text"
  id: string
  content: string
}

export interface ReasoningPart {
  type: "reasoning"
  id: string
  content: string
}

export type ToolStatus = "composing" | "pending" | "running" | "completed" | "error"

export interface ToolPart {
  type: "tool"
  id: string
  toolName: string
  input: string // JSON string of args
  output: string
  isError: boolean
  status: ToolStatus
  metadata?: ToolMetadata
  mediaType?: string
  data?: string // base64
  duration?: number
}

export interface StepFinishPart {
  type: "step-finish"
  stepNumber: number
  usage: Usage
  finishReason: string
  toolCallCount: number
}

export interface SourcePart {
  type: "source"
  id: string
  sourceType: "url" | "document"
  url: string
  title: string
}

export interface ErrorPart {
  type: "error"
  error: string
  retryable?: boolean
}

/** Runtime warning surfaced via the FEP `warnings` event. */
export interface WarningPart {
  type: "warning"
  message: string
}

/** Structured delegation result — rendered as a rich card in the chat. */
export interface DelegationResultPart {
  type: "delegation-result"
  groupId: string
  single: boolean
  timedOut: boolean
  totalDuration: string
  succeeded: number
  failed: number
  runs: Record<string, {
    agentName: string
    phase: string
    output: string
    toolCalls: number
    model: string
    traceID?: string
    duration: string
    /** Structured run outcome (intent + artifacts + summary). Replaces
     *  legacy pullRequestURL/commits/branch flat fields. */
    outcome?: AgentRunOutcome
    failureReason?: string
  }>
}

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolPart
  | StepFinishPart
  | SourcePart
  | ErrorPart
  | WarningPart
  | DelegationResultPart

// ---- Messages ----

export interface ChatMessage {
  role: "user" | "assistant"
  content?: string // plain text for user messages
  parts?: MessagePart[] // assembled parts for assistant messages
  timestamp: number
  /** Marks an assistant message as originating from an internal/synthetic
   *  prompt (e.g. a delegation callback). The UI renders a "processing
   *  results" indicator instead of a user bubble echoing the synthetic prompt. */
  internal?: boolean
  /** Optional origin tag (e.g. "delegation_callback") for internal messages. */
  source?: string
}


