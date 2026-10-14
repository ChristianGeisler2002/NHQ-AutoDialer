import { useEffect, useState } from 'react'
import { useApp } from '../context'
import { formatDuration, stateLabel, countryLabel } from '../format'

export function Dialer(): JSX.Element {
  const {
    currentLead,
    callState,
    callInfo,
    muted,
    providerReady,
    providerError,
    settings,
    startCall,
    hangUp,
    toggleMute,
    loadNextLead,
    reloadStats,
    navigate,
    params,
    showToast
  } = useApp()

  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const justLogged = Boolean(params.justLogged)

  const inCall = callState === 'dialing' || callState === 'ringing' || callState === 'live'

  useEffect(() => {
    if (callState !== 'live' || !callInfo?.startedAt) {
      setElapsed(0)
      return
    }
    const start = new Date(callInfo.startedAt).getTime()
    const tick = (): void => setElapsed((Date.now() - start) / 1000)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [callState, callInfo?.startedAt])

  useEffect(() => {
    setMsg('')
  }, [currentLead?.id])

  const onCall = async (): Promise<void> => {
    setMsg('')
    setBusy(true)
    try {
      const res = await startCall()
      if (!res.ok) setMsg(res.reason || 'Unable to start call')
    } finally { setBusy(false) }
  }

  const onSkip = async (): Promise<void> => {
    if (!currentLead) return
    setBusy(true)
    setMsg('')
    try {
      await window.api.skipLead(currentLead.id)
      await reloadStats()
      await loadNextLead()
    } catch (error) { setMsg(error instanceof Error ? error.message : 'Could not update the lead.') }
    finally { setBusy(false) }
  }

  const onMarkDnc = async (): Promise<void> => {
    if (!currentLead) return
    setBusy(true)
    setMsg('')
    try {
      await window.api.markDnc(currentLead.id, 'Marked Do Not Call from dialer')
      await reloadStats()
      showToast('Lead marked Do Not Call.')
      await loadNextLead()
    } catch (error) { setMsg(error instanceof Error ? error.message : 'Could not update the lead.') }
    finally { setBusy(false) }
  }

  const onNextCall = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      await reloadStats()
      const lead = await loadNextLead()
      navigate('dialer', {})
      if (!lead) showToast('No more uncalled leads in the queue.')
    } catch (error) { setMsg(error instanceof Error ? error.message : 'Could not update the lead.') }
    finally { setBusy(false) }
  }

  const openWebsite = (): void => {
    if (!currentLead?.website) return
    const url = /^https?:\/\//i.test(currentLead.website)
      ? currentLead.website
      : `https://${currentLead.website}`
    window.open(url, '_blank')
  }

  if (!currentLead) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Dialer</h1>
        </header>
        <section className="card empty">
          <p className="big-muted">No uncalled leads in the queue.</p>
          <div className="row">
            <button className="btn" onClick={() => navigate('queue')}>
              Open Lead Queue
            </button>
            <button className="btn" onClick={() => navigate('setup')}>
              Import more leads
            </button>
            <button className="btn primary" onClick={onNextCall} disabled={busy}>
              Check for next lead
            </button>
          </div>
        </section>
      </div>
    )
  }

  const canCall = !inCall && !busy && !justLogged && providerReady && currentLead.status !== 'do_not_call' && Boolean(currentLead.phone_e164)

  return (
    <div className="page">
      <header className="page-head dialer-head">
        <h1>Dialer</h1>
        <div className={`provider-pill ${providerReady ? 'ok' : 'warn'}`}>
          {settings?.callProvider === 'telnyx' ? 'Telnyx' : 'Mock'} ·{' '}
          {providerReady ? 'ready' : 'not ready'}
        </div>
      </header>

      {justLogged && (
        <div className="banner success">
          ✓ Call logged to your tracker. Click <strong>Next Call</strong> when you’re ready for the
          next lead.
        </div>
      )}
      {!providerReady && providerError && (
        <div className="banner warn">Calling provider error: {providerError}</div>
      )}

      <section className="card lead-card">
        <div className="lead-main">
          <div className="lead-phone">{currentLead.phone_original || currentLead.phone_e164}</div>
          <div className="lead-business">{currentLead.business_name || '—'}</div>
          <div className="lead-owner">{currentLead.owner_name || '—'}</div>
          <div className="lead-tags">
            <span className="tag">{currentLead.industry || '—'}</span>
            <span className="tag">
              {currentLead.state_province || '—'} · {countryLabel(currentLead.country)}
            </span>
            {currentLead.estimated_revenue && (
              <span className="tag muted-tag">Rev: {currentLead.estimated_revenue}</span>
            )}
          </div>
        </div>

        <div className={`call-status state-${callState}`}>
          <div className="cs-label">{stateLabel(callState)}</div>
          {callState === 'live' && <div className="cs-timer">{formatDuration(elapsed)}</div>}
          {muted && callState === 'live' && <div className="cs-muted">MUTED</div>}
        </div>
      </section>

      <section className="card details-card">
        <div className="detail">
          <span>State / Province</span>
          <strong>{currentLead.state_province || '—'}</strong>
        </div>
        <div className="detail">
          <span>Location</span>
          <strong>{currentLead.location_raw || '—'}</strong>
        </div>
        <div className="detail">
          <span>Website</span>
          {currentLead.website ? (
            <button className="linklike" onClick={openWebsite}>
              {currentLead.website}
            </button>
          ) : (
            <strong>—</strong>
          )}
        </div>
        <div className="detail">
          <span>E.164</span>
          <strong>{currentLead.phone_e164 || '— (uncallable)'}</strong>
        </div>
      </section>

      {msg && <div className="banner warn">{msg}</div>}

      <section className="dial-controls">
        <button className="btn call" onClick={onCall} disabled={!canCall}>
          ☎ Call
        </button>
        <button
          className={`btn ${muted ? 'unmute' : 'mute'}`}
          onClick={toggleMute}
          disabled={callState !== 'live'}
        >
          {muted ? '🔊 Unmute' : '🔇 Mute'}
        </button>
        <button className="btn hangup" onClick={hangUp} disabled={!inCall}>
          ✕ Hang Up
        </button>
        <button className="btn" onClick={onSkip} disabled={inCall || busy}>
          ⏭ Skip
        </button>
        <button className="btn danger" onClick={onMarkDnc} disabled={inCall || busy}>
          ⊘ Mark Do Not Call
        </button>
        <button className="btn primary next" onClick={onNextCall} disabled={inCall || busy}>
          Next Call →
        </button>
      </section>

      <p className="fineprint">
        Manual dialer · The app never auto-dials the next lead. Ending a call takes you to the
        post-call log.
      </p>
    </div>
  )
}
