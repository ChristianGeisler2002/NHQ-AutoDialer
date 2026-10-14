import type { TelnyxRTC, Call, INotification } from '@telnyx/webrtc'
import type { CallEndedListener, CallInfo, CallState, CallStatusListener, CallingProvider, ProviderSettings } from './types'

type ClientFactory = (settings: ProviderSettings) => Promise<TelnyxRTC>
const makeClient: ClientFactory = async settings => {
  const { TelnyxRTC } = await import('@telnyx/webrtc')
  return new TelnyxRTC({ login: settings.telnyxLogin, password: settings.telnyxPassword, debug: false })
}

export class TelnyxProvider implements CallingProvider {
  readonly name = 'telnyx' as const
  private statusListeners: CallStatusListener[] = []
  private endedListeners: CallEndedListener[] = []
  private client: TelnyxRTC | null = null
  private currentCall: Call | null = null
  private info: CallInfo | null = null
  private terminalFired = false
  private connected = false
  private callerId = ''
  private cancelConnection: (() => void) | null = null
  private generation = 0

  constructor(private readonly factory: ClientFactory = makeClient, private readonly timeoutMs = 20000) {}
  onCallStatusChanged(callback: CallStatusListener): void { this.statusListeners.push(callback) }
  onCallEnded(callback: CallEndedListener): void { this.endedListeners.push(callback) }

  async initializeProvider(settings: ProviderSettings): Promise<void> {
    if (!settings.telnyxLogin || !settings.telnyxPassword || !settings.callerId) {
      throw new Error('Enter the SIP username, password, and caller ID in Settings.')
    }
    const generation = ++this.generation
    this.callerId = settings.callerId
    const client = await this.factory(settings)
    if (generation !== this.generation) { void client.disconnect(); throw new Error('Connection cancelled.') }
    this.client = client
    client.on('telnyx.notification', notification => this.handleNotification(notification))
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        client.off('telnyx.ready', ready)
        client.off('telnyx.error', error)
        this.cancelConnection = null
      }
      const ready = (): void => { cleanup(); this.connected = true; resolve() }
      const error = (): void => {
        cleanup()
        this.connected = false
        void client.disconnect().catch(() => {})
        reject(new Error('Could not connect to Telnyx. Check the SIP credentials, microphone access, and network.'))
      }
      const timer = setTimeout(error, this.timeoutMs)
      this.cancelConnection = () => { cleanup(); reject(new Error('Connection cancelled.')) }
      // Telnyx exposes on/off; it does not provide EventEmitter.once.
      client.on('telnyx.ready', ready)
      client.on('telnyx.error', error)
      void client.connect().catch(error)
    })
    client.on('telnyx.error', () => { this.connected = false; this.finish('failed') })
  }

  private finish(state: CallState): void {
    if (!this.info || this.terminalFired) return
    this.terminalFired = true
    this.info = {
      ...this.info, state, endedAt: new Date().toISOString(),
      durationSeconds: this.info.startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(this.info.startedAt)) / 1000)) : 0
    }
    this.currentCall = null
    for (const callback of this.statusListeners) callback(state, this.info)
    for (const callback of this.endedListeners) callback(this.info)
  }

  private handleNotification(notification: INotification): void {
    const call = notification.call
    if (notification.type !== 'callUpdate' || !call || !this.info || this.terminalFired) return
    if (this.currentCall && call.id !== this.currentCall.id) return
    const state = String(call.state).toLowerCase()
    if (['hangup', 'destroy', 'purge'].includes(state)) {
      const cause = String(call.cause || '').toUpperCase()
      this.finish(cause === 'USER_BUSY' ? 'busy' : ['NO_ANSWER', 'NO_USER_RESPONSE', 'ALLOTTED_TIMEOUT'].includes(cause) ? 'no_answer' : ['NORMAL_CLEARING', 'ORIGINATOR_CANCEL', ''].includes(cause) ? 'ended' : 'failed')
      return
    }
    const mapped = ['active', 'held'].includes(state) ? 'live' : ['ringing', 'early'].includes(state) ? 'ringing' : 'dialing'
    this.info = { ...this.info, state: mapped, providerCallId: call.id, startedAt: mapped === 'live' ? this.info.startedAt || new Date().toISOString() : this.info.startedAt }
    for (const callback of this.statusListeners) callback(mapped, this.info)
  }

  async startCall(phoneNumber: string, leadId: number): Promise<void> {
    if (!this.client || !this.connected) throw new Error('Telnyx is disconnected. Reconnect in Settings.')
    if (this.currentCall) throw new Error('A call is already in progress.')
    this.terminalFired = false
    this.info = { leadId, phoneNumber, providerCallId: null, state: 'dialing', startedAt: null, endedAt: null, durationSeconds: 0 }
    try {
      this.currentCall = this.client.newCall({ destinationNumber: phoneNumber, callerNumber: this.callerId, remoteElement: 'remoteAudio', audio: true, video: false })
      this.info = { ...this.info, providerCallId: this.currentCall.id }
      for (const callback of this.statusListeners) callback('dialing', this.info)
    } catch {
      this.finish('failed')
      throw new Error('The call could not start. Check the microphone and provider settings.')
    }
  }
  async hangupCall(): Promise<void> { await this.currentCall?.hangup(); this.finish('ended') }
  muteCall(): void { this.currentCall?.muteAudio() }
  unmuteCall(): void { this.currentCall?.unmuteAudio() }
  isMuted(): boolean { return this.currentCall?.localStream?.getAudioTracks()?.[0]?.enabled === false }
  destroy(): void {
    this.generation++
    this.cancelConnection?.()
    this.connected = false
    void this.currentCall?.hangup().catch(() => {})
    void this.client?.disconnect().catch(() => {})
    this.client = null
    this.currentCall = null
    this.info = null
    this.statusListeners = []
    this.endedListeners = []
  }
}
