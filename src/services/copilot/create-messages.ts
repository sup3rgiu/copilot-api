import consola from "consola"
import { events } from "fetch-event-stream"

import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
} from "~/routes/messages/anthropic-types"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { logOutgoingCopilotRequest } from "~/lib/outgoing-request-log"
import { state } from "~/lib/state"

export type MessagesStream = ReturnType<typeof events>
export type CreateMessagesReturn = AnthropicResponse | MessagesStream

export const createMessages = async (
  payload: AnthropicMessagesPayload,
  anthropicBetaHeader?: string,
  options?: {
    initiator?: "agent" | "user"
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
  const requestedInitiator =
    options?.initiator ?? (isInitiateRequest ? "user" : "agent")
  const initiator = applyRiskyInitiator(requestedInitiator, payload)

  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": initiator,
  }

  if (anthropicBetaHeader) {
    // align with vscode copilot extension anthropic-beta
    const filteredBeta = anthropicBetaHeader
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "claude-code-20250219")
      .join(",")
    if (filteredBeta) {
      headers["anthropic-beta"] = filteredBeta
    }
  } else if (payload.thinking?.budget_tokens) {
    headers["anthropic-beta"] = "interleaved-thinking-2025-05-14"
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
    return "agent"
  }

  // Check payload history to detect server restart mid-session:
  // if assistant messages or tool results exist, it's not the first request
  const hasHistory = payload.messages.some((message) => {
    if (message.role === "assistant") {
      return true
    }
    if (message.role === "user" && Array.isArray(message.content)) {
      return message.content.some((block) => block.type === "tool_result")
    }
    return false
  })

  state.firstRiskyRequestSent = true
  return hasHistory ? "agent" : "user"
}
