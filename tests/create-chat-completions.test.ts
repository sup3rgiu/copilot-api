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

test("sets x-initiator to agent if tool/assistant present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload, { requestId: "1" })
  expect(fetchMock).toHaveBeenCalled()
  const headers = getLastHeaders()
  expect(headers["x-initiator"]).toBe("agent")
})

test("sets x-initiator to user if only user present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload, { requestId: "1" })
  expect(fetchMock).toHaveBeenCalled()
  const headers = getLastHeaders()
  expect(headers["x-initiator"]).toBe("user")
})

test("risky mode keeps first session request as user", async () => {
  state.forceAgentInitiator = true
  state.firstRiskyRequestSent = false
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "first turn" }],
    model: "gpt-test",
  }
  await createChatCompletions(payload, { requestId: "test" })
  const headers = getLastHeaders()
  expect(headers["x-initiator"]).toBe("user")
  state.forceAgentInitiator = false
})

test("risky mode forces agent after history exists", async () => {
  state.forceAgentInitiator = true
  state.firstRiskyRequestSent = false
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "first turn" },
      { role: "assistant", content: "response" },
      { role: "user", content: "follow up" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload, { requestId: "test" })
  const headers = getLastHeaders()
  expect(headers["x-initiator"]).toBe("agent")
  state.forceAgentInitiator = false
})

test("risky mode keeps explicit agent override for subagent flows", async () => {
  state.forceAgentInitiator = true
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "subagent first turn" }],
    model: "gpt-test",
  }
  await createChatCompletions(payload, {
    requestId: "test",
    subagentMarker: { session_id: "s1", agent_id: "a1", agent_type: "test" },
  })
  const headers = getLastHeaders()
  expect(headers["x-initiator"]).toBe("agent")
  state.forceAgentInitiator = false
})

test("risky-user-interval sends user every Nth forced request", async () => {
  state.forceAgentInitiator = true
  state.firstRiskyRequestSent = true
  state.riskyUserInterval = 3
  state.riskyForcedCount = 0

  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "first turn" },
      { role: "assistant", content: "response" },
      { role: "user", content: "follow up" },
    ],
    model: "gpt-test",
  }

  // Request 1: forcedCount goes 0→1, should be agent
  await createChatCompletions(payload, { requestId: "t1" })
  expect(getLastHeaders()["x-initiator"]).toBe("agent")

  // Request 2: forcedCount goes 1→2, should be agent
  await createChatCompletions(payload, { requestId: "t2" })
  expect(getLastHeaders()["x-initiator"]).toBe("agent")

  // Request 3: forcedCount goes 2→3, hits interval → user, counter resets
  await createChatCompletions(payload, { requestId: "t3" })
  expect(getLastHeaders()["x-initiator"]).toBe("user")
  expect(state.riskyForcedCount).toBe(0)

  // Request 4: forcedCount goes 0→1 again, should be agent
  await createChatCompletions(payload, { requestId: "t4" })
  expect(getLastHeaders()["x-initiator"]).toBe("agent")

  Object.assign(state, {
    forceAgentInitiator: false,
    riskyUserInterval: undefined,
    riskyForcedCount: 0,
  })
})

test("risky mode without interval unchanged behavior", async () => {
  state.forceAgentInitiator = true
  state.firstRiskyRequestSent = true
  state.riskyUserInterval = undefined
  state.riskyForcedCount = 0

  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "first turn" },
      { role: "assistant", content: "response" },
      { role: "user", content: "follow up" },
    ],
    model: "gpt-test",
  }

  // All should be agent without interval set
  await createChatCompletions(payload, { requestId: "t1" })
  expect(getLastHeaders()["x-initiator"]).toBe("agent")
  await createChatCompletions(payload, { requestId: "t2" })
  expect(getLastHeaders()["x-initiator"]).toBe("agent")
  await createChatCompletions(payload, { requestId: "t3" })
  expect(getLastHeaders()["x-initiator"]).toBe("agent")

  state.forceAgentInitiator = false
})

test("risky-user-interval does not count agent-initiated requests", async () => {
  state.forceAgentInitiator = true
  state.firstRiskyRequestSent = true
  state.riskyUserInterval = 2
  state.riskyForcedCount = 0

  const userPayload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "first turn" },
      { role: "assistant", content: "response" },
      { role: "user", content: "follow up" },
    ],
    model: "gpt-test",
  }

  // Agent-initiated request should not affect counter
  await createChatCompletions(userPayload, {
    requestId: "t1",
    subagentMarker: { session_id: "s1", agent_id: "a1", agent_type: "test" },
  })
  expect(getLastHeaders()["x-initiator"]).toBe("agent")
  expect(state.riskyForcedCount).toBe(0) // counter untouched

  // User request 1: forcedCount 0→1, agent
  await createChatCompletions(userPayload, { requestId: "t2" })
  expect(getLastHeaders()["x-initiator"]).toBe("agent")

  // User request 2: forcedCount 1→2, hits interval → user
  await createChatCompletions(userPayload, { requestId: "t3" })
  expect(getLastHeaders()["x-initiator"]).toBe("user")

  Object.assign(state, {
    forceAgentInitiator: false,
    riskyUserInterval: undefined,
    riskyForcedCount: 0,
  })
})
