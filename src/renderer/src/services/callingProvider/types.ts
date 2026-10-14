import type { CallState } from '../../../../shared/types'

export type { CallState }

export interface ProviderSettings {
  provider: 'mock' | 'telnyx'
  telnyxLogin?: string
  telnyxPassword?: string
  callerId?: string
}

export interface CallInfo {
  leadId: number
  phoneNumber: string
  providerCallId: string | null
  state: CallState
  startedAt: string | null // when the call connected (became live)
  endedAt: string | null
  durationSeconds: number
}

export type CallStatusListener = (state: CallState, info: CallInfo) => void
export type CallEndedListener = (info: CallInfo) => void

/**
 * Provider adapter interface. Swap implementations (Mock / Telnyx / Twilio…)
 * without touching the dialer UI. Matches the required interface:
 * initializeProvider, startCall, hangupCall, muteCall, unmuteCall,
 * onCallStatusChanged, onCallEnded.
 */
export interface CallingProvider {
  readonly name: 'mock' | 'telnyx'
  initializeProvider(settings: ProviderSettings): Promise<void>
  startCall(phoneNumber: string, leadId: number): Promise<void>
  hangupCall(): Promise<void>
  muteCall(): void
  unmuteCall(): void
  isMuted(): boolean
  onCallStatusChanged(cb: CallStatusListener): void
  onCallEnded(cb: CallEndedListener): void
  destroy(): void
}

/** Terminal states that route to the post-call log. */
export const TERMINAL_STATES: CallState[] = ['ended', 'failed', 'busy', 'no_answer']
