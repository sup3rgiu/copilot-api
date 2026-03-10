import type { ModelsResponse } from "~/services/copilot/get-models"

export interface State {
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  macMachineId?: string
  vsCodeSessionId?: string

  manualApprove: boolean
  forceAgentInitiator: boolean
  firstRiskyRequestSent: boolean
  riskyUserInterval?: number
  riskyForcedCount: number
  rateLimitWait: boolean
  showToken: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number
  verbose: boolean
}

export const state: State = {
  accountType: "individual",
  manualApprove: false,
  forceAgentInitiator: false,
  firstRiskyRequestSent: false,
  riskyForcedCount: 0,
  rateLimitWait: false,
  showToken: false,
  verbose: false,
}
