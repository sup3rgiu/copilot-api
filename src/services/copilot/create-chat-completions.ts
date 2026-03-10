import consola from "consola"
import { events } from "fetch-event-stream"

import type { SubagentMarker } from "~/routes/messages/subagent-marker"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { logOutgoingCopilotRequest } from "~/lib/outgoing-request-log"
import { state } from "~/lib/state"

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
  options: {
    subagentMarker?: SubagentMarker | null
    requestId: string
    sessionId?: string
  },
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = payload.messages.some(
    (x) =>
      typeof x.content !== "string"
      && x.content?.some((x) => x.type === "image_url"),
  )

  // Agent/user check for x-initiator header
  // Determine if any message is from an agent ("assistant" or "tool")
  // Refactor `isAgentCall` logic to check only the last message in the history rather than any message. This prevents valid user messages from being incorrectly flagged as agent calls due to previous assistant history, ensuring proper credit consumption for multi-turn conversations.
  let isAgentCall = false
  if (payload.messages.length > 0) {
    const lastMessage = payload.messages.at(-1)
    if (lastMessage) {
      isAgentCall = ["assistant", "tool"].includes(lastMessage.role)
    }
  }
  const requestedInitiator: "agent" | "user" =
    options.subagentMarker || isAgentCall ? "agent" : "user"
  const initiator = applyRiskyInitiator(requestedInitiator, payload)

  // Build headers and add x-initiator
  const headers: Record<string, string> = {
    ...copilotHeaders(state, options.requestId, enableVision),
    "x-initiator": initiator,
  }

  if (options.subagentMarker) {
    headers["x-interaction-type"] = "conversation-subagent"
  }

  if (options.sessionId) {
    headers["x-interaction-id"] = options.sessionId
  }

  const startedAt = Date.now()
  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
  logOutgoingCopilotRequest({
    method: "POST",
    path: "/chat/completions",
    initiator,
    status: response.status,
    startedAt,
  })

  if (!response.ok) {
    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

const applyRiskyInitiator = (
  requestedInitiator: "agent" | "user",
  payload: ChatCompletionsPayload,
) => {
  if (!state.forceAgentInitiator) {
    return requestedInitiator
  }

  if (requestedInitiator === "agent") {
    if (!state.firstRiskyRequestSent) {
      state.firstRiskyRequestSent = true
    }
    return "agent"
  }

  if (state.firstRiskyRequestSent) {
    if (state.riskyUserInterval && state.riskyUserInterval > 0) {
      state.riskyForcedCount++
      if (state.riskyForcedCount >= state.riskyUserInterval) {
        state.riskyForcedCount = 0
        return "user"
      }
    }
    return "agent"
  }

  // Check payload history to detect server restart mid-session:
  // if assistant/tool messages exist, it's not the first request
  const hasHistory = payload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )

  state.firstRiskyRequestSent = true
  return hasHistory ? "agent" : "user"
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

export interface Delta {
  content?: string | null
  role?: "user" | "assistant" | "system" | "tool"
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
  reasoning_text?: string | null
  reasoning_opaque?: string | null
}

export interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  reasoning_text?: string | null
  reasoning_opaque?: string | null
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  user?: string | null
  thinking_budget?: number
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null

  name?: string
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
  reasoning_text?: string | null
  reasoning_opaque?: string | null
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
