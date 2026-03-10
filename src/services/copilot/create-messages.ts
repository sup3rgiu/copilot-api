import consola from "consola"
import { events } from "fetch-event-stream"

import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
} from "~/routes/messages/anthropic-types"
import type { SubagentMarker } from "~/routes/messages/subagent-marker"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { logOutgoingCopilotRequest } from "~/lib/outgoing-request-log"
import { state } from "~/lib/state"

export type MessagesStream = ReturnType<typeof events>
export type CreateMessagesReturn = AnthropicResponse | MessagesStream

const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14"
const allowedAnthropicBetas = new Set([
  INTERLEAVED_THINKING_BETA,
  "context-management-2025-06-27",
  "advanced-tool-use-2025-11-20",
])

const buildAnthropicBetaHeader = (
  anthropicBetaHeader: string | undefined,
  thinking: AnthropicMessagesPayload["thinking"],
): string | undefined => {
  const isAdaptiveThinking = thinking?.type === "adaptive"

  if (anthropicBetaHeader) {
    const filteredBeta = anthropicBetaHeader
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .filter((item) => allowedAnthropicBetas.has(item))
    const uniqueFilteredBetas = [...new Set(filteredBeta)]
    const finalFilteredBetas =
      isAdaptiveThinking ?
        uniqueFilteredBetas.filter((item) => item !== INTERLEAVED_THINKING_BETA)
      : uniqueFilteredBetas

    if (finalFilteredBetas.length > 0) {
      return finalFilteredBetas.join(",")
    }

    return undefined
  }

  if (thinking?.budget_tokens && !isAdaptiveThinking) {
    return INTERLEAVED_THINKING_BETA
  }

  return undefined
}

export const createMessages = async (
  payload: AnthropicMessagesPayload,
  anthropicBetaHeader: string | undefined,
  options: {
    subagentMarker?: SubagentMarker | null
    requestId: string
    sessionId?: string
  },
): Promise<CreateMessagesReturn> => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = payload.messages.some(
    (message) =>
      Array.isArray(message.content)
      && message.content.some((block) => block.type === "image"),
  )

  let isInitiateRequest = false
  const lastMessage = payload.messages.at(-1)
  if (lastMessage?.role === "user") {
    isInitiateRequest =
      Array.isArray(lastMessage.content) ?
        lastMessage.content.some((block) => block.type !== "tool_result")
      : true
  }
  const requestedInitiator: "agent" | "user" =
    !options.subagentMarker && isInitiateRequest ? "user" : "agent"
  const initiator = applyRiskyInitiator(requestedInitiator, payload)

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

  // align with vscode copilot extension anthropic-beta
  const anthropicBeta = buildAnthropicBetaHeader(
    anthropicBetaHeader,
    payload.thinking,
  )
  if (anthropicBeta) {
    headers["anthropic-beta"] = anthropicBeta
  }

  const startedAt = Date.now()
  const response = await fetch(`${copilotBaseUrl(state)}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
  logOutgoingCopilotRequest({
    method: "POST",
    path: "/v1/messages",
    initiator,
    status: response.status,
    startedAt,
  })

  if (!response.ok) {
    consola.error("Failed to create messages", response)
    throw new HTTPError("Failed to create messages", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as AnthropicResponse
}

const applyRiskyInitiator = (
  requestedInitiator: "agent" | "user",
  payload: AnthropicMessagesPayload,
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
  // if assistant messages or tool results exist, it's not the first request
  const hasHistory = payload.messages.some((message) => {
    if (message.role === "assistant") {
      return true
    }
    if (Array.isArray(message.content)) {
      return message.content.some((block) => block.type === "tool_result")
    }
    return false
  })

  state.firstRiskyRequestSent = true
  return hasHistory ? "agent" : "user"
}
