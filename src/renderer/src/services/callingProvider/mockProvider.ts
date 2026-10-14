import type {
  CallEndedListener,
  CallInfo,
  CallState,
  CallStatusListener,
  CallingProvider,
  ProviderSettings
} from './types'

/**
 * A fully working simulated provider. It drives the real call-state machine
 * (idle → dialing → ringing → live → ended/…) so the entire manual dialer flow
 * can be used and tested without a paid telephony account. It NEVER auto-dials
 * the next lead — ending a call simply routes to the post-call log.
 */
export class MockProvider implements CallingProvider {
  readonly name = 'mock' as const

  private statusListeners: CallStatusListener[] = []
  private endedListeners: CallEndedListener[] = []
  private timers: ReturnType<typeof setTimeout>[] = []
  private muted = false
  private info: CallInfo | null = null

  async initializeProvider(_settings: ProviderSettings): Promise<void> {
    /* nothing to initialise for the mock */
  }

  onCallStatusChanged(cb: CallStatusListener): void {
    this.statusListeners.push(cb)
  }

  onCallEnded(cb: CallEndedListener): void {
    this.endedListeners.push(cb)
  }

  private clearTimers(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers = []
  }

  private emit(state: CallState): void {
    if (!this.info) return
    this.info = { ...this.info, state }
    for (const cb of this.statusListeners) cb(state, this.info)
  }

  private finish(state: CallState): void {
    if (!this.info) return
    this.clearTimers()
    const endedAt = new Date().toISOString()
    let durationSeconds = 0
    if (this.info.startedAt) {
      durationSeconds = Math.max(0, Math.round((Date.now() - new Date(this.info.startedAt).getTime()) / 1000))
    }
    this.info = { ...this.info, state, endedAt, durationSeconds }
    for (const cb of this.statusListeners) cb(state, this.info)
    for (const cb of this.endedListeners) cb(this.info)
  }

  async startCall(phoneNumber: string, leadId: number): Promise<void> {
    this.clearTimers()
    this.muted = false
    this.info = {
      leadId,
      phoneNumber,
      providerCallId: `mock-${Date.now()}`,
      state: 'idle',
      startedAt: null,
      endedAt: null,
      durationSeconds: 0
    }
    this.emit('dialing')

    this.timers.push(
      setTimeout(() => this.emit('ringing'), 900)
    )

    // After ringing, pick a realistic outcome.
    this.timers.push(
      setTimeout(() => {
        const roll = Math.random()
        if (roll < 0.7) {
          // Connected — stays live until the user hangs up.
          if (this.info) this.info = { ...this.info, startedAt: new Date().toISOString() }
          this.emit('live')
        } else if (roll < 0.85) {
          this.finish('no_answer')
        } else if (roll < 0.95) {
          this.finish('busy')
        } else {
          this.finish('failed')
        }
      }, 2600)
    )
  }

  async hangupCall(): Promise<void> {
    if (!this.info) return
    if (this.info.state === 'live' || this.info.state === 'dialing' || this.info.state === 'ringing') {
      this.finish('ended')
    }
  }

  muteCall(): void {
    this.muted = true
  }

  unmuteCall(): void {
    this.muted = false
  }

  isMuted(): boolean {
    return this.muted
  }

  destroy(): void {
    this.clearTimers()
    this.statusListeners = []
    this.endedListeners = []
    this.info = null
  }
}
