import consola from "consola"

import { state } from "./state"

interface OutgoingRequestLogParams {
  method: string
  path: string
  initiator: "agent" | "user"
  status: number
  startedAt: number
}

export const logOutgoingCopilotRequest = ({
  method,
  path,
  initiator,
  status,
  startedAt,
}: OutgoingRequestLogParams): void => {
  if (!state.forceAgentInitiator) {
    return
  }

  const elapsedMs = Date.now() - startedAt
  const elapsed =
    elapsedMs < 1000 ? `${elapsedMs}ms` : `${Math.round(elapsedMs / 1000)}s`

  consola.log(
    `--> ${method.toUpperCase()} ${path} (X-Initiator: ${initiator}) ${status} ${elapsed}`,
  )
}
