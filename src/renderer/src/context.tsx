import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import type { AppSettings, Lead, LeadStats } from '../../shared/types'
import type { PrecheckResult } from '../../shared/api'
import {
  createProvider,
  type CallInfo,
  type CallState,
  type CallingProvider
} from './services/callingProvider'
import { suggestStatus } from './format'

export type Route = 'setup' | 'dialer' | 'postcall' | 'queue' | 'dnc' | 'settings'

export const STATUS_OPTIONS = [
  'Connected', 'No Answer', 'Left Voicemail', 'Busy', 'Bad Number', 'Not Interested',
  'Interested', 'Follow-Up Booked', 'Demo Booked', 'Proposal Sent', 'Closed Won', 'Do Not Call'
]
export const DECISION_MAKER_OPTIONS = ['Yes', 'No', 'Unsure']
export const INTEREST_OPTIONS = ['Hot', 'Warm', 'Cold', 'Not Interested']

export interface PostCallPayload {
  lead: Lead
  callInfo: CallInfo | null
  suggestedStatus: string
}

interface AppContextValue {
  route: Route
  params: Record<string, unknown>
  navigate: (route: Route, params?: Record<string, unknown>) => void

  settings: AppSettings | null
  reloadSettings: () => Promise<AppSettings>
  updateSettings: (partial: Partial<Record<keyof AppSettings, string | number | boolean>>) => Promise<void>

  stats: LeadStats | null
  reloadStats: () => Promise<void>

  currentLead: Lead | null
  setCurrentLead: (lead: Lead | null) => void
  loadNextLead: () => Promise<Lead | null>

  callState: CallState
  callInfo: CallInfo | null
  muted: boolean
  providerReady: boolean
  providerError: string

  startCall: () => Promise<{ ok: boolean; reason?: string }>
  hangUp: () => Promise<void>
  toggleMute: () => void

  postCall: PostCallPayload | null
  clearPostCall: () => void

  toast: string
  showToast: (msg: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export function AppProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [route, setRoute] = useState<Route>('setup')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [stats, setStats] = useState<LeadStats | null>(null)
  const [currentLead, setCurrentLeadState] = useState<Lead | null>(null)
  const [callState, setCallState] = useState<CallState>('idle')
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null)
  const [muted, setMuted] = useState(false)
  const [providerReady, setProviderReady] = useState(false)
  const [providerError, setProviderError] = useState('')
  const [postCall, setPostCall] = useState<PostCallPayload | null>(null)
  const [toast, setToast] = useState('')

  const providerRef = useRef<CallingProvider | null>(null)
  const currentLeadRef = useRef<Lead | null>(null)
  const navigateRef = useRef<(r: Route, p?: Record<string, unknown>) => void>(() => {})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const callBusy = useRef(false)
  const activeCall = useRef(false)
  const pendingLog = useRef(false)
  const generation = useRef(0)
  const navigate = useCallback((r: Route, p: Record<string, unknown> = {}) => {
    if ((activeCall.current && r !== 'dialer' && r !== 'postcall') || (pendingLog.current && r !== 'postcall')) {
      setToast('Finish the current call and call log before leaving.')
      return
    }
    setParams(p)
    setRoute(r)
  }, [])
  navigateRef.current = navigate

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3500)
  }, [])

  const setCurrentLead = useCallback((lead: Lead | null) => {
    currentLeadRef.current = lead
    setCurrentLeadState(lead)
  }, [])

  const reloadSettings = useCallback(async () => {
    const s = await window.api.getSettings()
    setSettings(s)
    return s
  }, [])

  const reloadStats = useCallback(async () => {
    setStats(await window.api.leadStats())
  }, [])

  const loadNextLead = useCallback(async () => {
    const lead = await window.api.nextLead()
    setCurrentLead(lead)
    setCallState('idle')
    setCallInfo(null)
    setMuted(false)
    return lead
  }, [setCurrentLead])

  const reinitProvider = useCallback(async (s: AppSettings) => {
    const request = ++generation.current
    setProviderReady(false)
    setProviderError('')
    if (providerRef.current) {
      try {
        providerRef.current.destroy()
      } catch {
        /* ignore */
      }
    }
    const provider = createProvider(s.callProvider)
    providerRef.current = provider

    provider.onCallStatusChanged((state, info) => {
      if (request !== generation.current) return
      activeCall.current = ['dialing', 'ringing', 'live'].includes(state)
      setCallState(state)
      setCallInfo(info)
    })
    provider.onCallEnded((info) => {
      if (request !== generation.current) return
      activeCall.current = false
      const lead = currentLeadRef.current
      if (lead) {
        pendingLog.current = true
        setPostCall({
          lead,
          callInfo: info,
          suggestedStatus: suggestStatus(info.state, Boolean(info.startedAt))
        })
        navigateRef.current('postcall')
      }
    })

    try {
      await provider.initializeProvider({
        provider: s.callProvider,
        telnyxLogin: s.telnyxLogin,
        telnyxPassword: s.telnyxPassword,
        callerId: s.telnyxCallerId
      })
      if (request === generation.current) setProviderReady(true)
    } catch (err) {
      if (request !== generation.current) return
      setProviderReady(false)
      setProviderError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const updateSettings = useCallback(
    async (partial: Partial<Record<keyof AppSettings, string | number | boolean>>) => {
      const updated = await window.api.setSettings(partial)
      setSettings(updated)
      if ('callProvider' in partial || 'telnyxLogin' in partial || 'telnyxPassword' in partial || 'telnyxCallerId' in partial) {
        await reinitProvider(updated)
      }
    },
    [reinitProvider]
  )

  const startCall = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    const lead = currentLeadRef.current
    if (!lead) return { ok: false, reason: 'No lead selected' }
    if (!lead.phone_e164) return { ok: false, reason: 'This lead has no valid phone number' }
    const provider = providerRef.current
    if (!provider) return { ok: false, reason: 'Calling provider not ready' }
    if (!providerReady) return { ok: false, reason: providerError || 'Calling provider not ready' }

    if (callBusy.current || activeCall.current || pendingLog.current) return { ok: false, reason: 'Finish the current call log first.' }
    callBusy.current = true
    setMuted(false)
    try {
      const pre: PrecheckResult = await window.api.precheck(lead.id)
      if (!pre.allowed) return { ok: false, reason: pre.reason || 'Call not allowed' }
      await provider.startCall(lead.phone_e164, lead.id)
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    } finally { callBusy.current = false }
  }, [providerReady, providerError])

  const hangUp = useCallback(async () => {
    await providerRef.current?.hangupCall()
  }, [])

  const toggleMute = useCallback(() => {
    const provider = providerRef.current
    if (!provider) return
    setMuted((m) => {
      if (m) provider.unmuteCall()
      else provider.muteCall()
      return !m
    })
  }, [])

  const clearPostCall = useCallback(() => { pendingLog.current = false; setPostCall(null) }, [])

  useEffect(() => {
    const onError = (event: PromiseRejectionEvent): void => {
      event.preventDefault()
      showToast(event.reason instanceof Error ? event.reason.message : 'That action could not finish. Please try again.')
    }
    window.addEventListener('unhandledrejection', onError)
    return () => window.removeEventListener('unhandledrejection', onError)
  }, [showToast])

  // Boot sequence.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await reloadSettings()
      await window.api.ensureTracker()
      if (cancelled) return
      await reloadSettings()
      await reloadStats()
      const st = await window.api.leadStats()
      if (cancelled) return
      await reinitProvider(s)
      if (cancelled) return
      if (st.total === 0) {
        setRoute('setup')
      } else {
        setRoute('dialer')
        const lead = await window.api.nextLead()
        setCurrentLead(lead)
      }
    })().catch(error => { if (!cancelled) showToast(error instanceof Error ? error.message : 'Could not load the app. Restart and try again.') })
    return () => {
      cancelled = true
      generation.current++
      providerRef.current?.destroy()
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value: AppContextValue = {
    route,
    params,
    navigate,
    settings,
    reloadSettings,
    updateSettings,
    stats,
    reloadStats,
    currentLead,
    setCurrentLead,
    loadNextLead,
    callState,
    callInfo,
    muted,
    providerReady,
    providerError,
    startCall,
    hangUp,
    toggleMute,
    postCall,
    clearPostCall,
    toast,
    showToast
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
