import { test, expect, mock } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

// Mock state
state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"
state.forceAgentInitiator = false

// Helper to mock fetch
const fetchMock = mock(
  (_url: string, opts: { headers: Record<string, string> }) => {
    return {
      ok: true,
      json: () => ({ id: "123", object: "chat.completion", choices: [] }),
      headers: opts.headers,
    }
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

const getLastHeaders = (): Record<string, string> => {
  const call = fetchMock.mock.calls.at(-1)
  return (call?.[1] as { headers: Record<string, string> }).headers
}

test("sets X-Initiator to agent if tool/assistant present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = getLastHeaders()
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = getLastHeaders()
  expect(headers["X-Initiator"]).toBe("user")
})

test("risky mode keeps first session request as user", async () => {
  state.forceAgentInitiator = true
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "first turn" }],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  const headers = getLastHeaders()
  expect(headers["X-Initiator"]).toBe("user")
  state.forceAgentInitiator = false
})

test("risky mode forces agent after history exists", async () => {
  state.forceAgentInitiator = true
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "first turn" },
      { role: "assistant", content: "response" },
      { role: "user", content: "follow up" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  const headers = getLastHeaders()
  expect(headers["X-Initiator"]).toBe("agent")
  state.forceAgentInitiator = false
})

test("risky mode keeps explicit agent override for subagent flows", async () => {
  state.forceAgentInitiator = true
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "subagent first turn" }],
    model: "gpt-test",
  }
  await createChatCompletions(payload, { initiator: "agent" })
  const headers = getLastHeaders()
  expect(headers["X-Initiator"]).toBe("agent")
  state.forceAgentInitiator = false
})
