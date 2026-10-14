import { useState } from 'react'
import {
  useApp,
  STATUS_OPTIONS,
  DECISION_MAKER_OPTIONS,
  INTEREST_OPTIONS
} from '../context'
import { todayISO, formatDuration } from '../format'
import type { PostCallPayload } from '../context'
import type { CallLogInput } from '../../../shared/types'

export function PostCallLog(): JSX.Element {
  const { postCall, navigate } = useApp()

  if (!postCall) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Post-Call Log</h1>
        </header>
        <section className="card empty">
          <p className="big-muted">No recent call to log.</p>
          <button className="btn primary" onClick={() => navigate('dialer')}>
            Back to Dialer
          </button>
        </section>
      </div>
    )
  }

  return <CallLogForm key={postCall.callInfo?.providerCallId || postCall.lead.id} payload={postCall} />
}

function CallLogForm({ payload }: { payload: PostCallPayload }): JSX.Element {
  const { settings, clearPostCall, reloadStats, navigate, showToast } = useApp()
  const { lead, callInfo, suggestedStatus } = payload
  const [submissionId] = useState(() => crypto.randomUUID())

  // Columns A–F (auto-filled, editable)
  const [date, setDate] = useState(todayISO())
  const [business, setBusiness] = useState(lead.business_name)
  const [owner, setOwner] = useState(lead.owner_name)
  const [phone, setPhone] = useState(lead.phone_original || lead.phone_e164 || '')
  const [industry, setIndustry] = useState(lead.industry)
  const [stateProvince, setStateProvince] = useState(lead.state_province)
  // Columns G–L (manual)
  const [status, setStatus] = useState(suggestedStatus)
  const [decisionMaker, setDecisionMaker] = useState('')
  const [interest, setInterest] = useState('')
  const [painPoint, setPainPoint] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const buildInput = (): CallLogInput => ({
    submission_id: submissionId,
    lead_id: lead.id,
    call_started_at: callInfo?.startedAt ?? null,
    call_ended_at: callInfo?.endedAt ?? null,
    duration_seconds: callInfo?.durationSeconds ?? 0,
    call_provider: settings?.callProvider ?? 'mock',
    provider_call_id: callInfo?.providerCallId ?? null,
    date,
    business_name: business,
    owner_name: owner,
    phone,
    industry,
    state_province: stateProvince,
    status,
    decision_maker: decisionMaker,
    interest,
    pain_point: painPoint,
    follow_up_date: followUp,
    notes
  })

  const doSave = async (alsoDnc: boolean): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const res = await window.api.saveCall({ ...buildInput(), status: alsoDnc ? 'Do Not Call' : status })
      if (!res.ok) {
        setError(res.error || 'Failed to save call log')
        setSaving(false)
        return
      }
      await reloadStats()
      clearPostCall()
      showToast(`Saved to tracker (row ${res.appendedRow}). Backup created.`)
      navigate('dialer', { justLogged: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const cancel = (): void => {
    clearPostCall()
    navigate('dialer')
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Post-Call Log</h1>
        <p className="muted">
          Call outcome: <strong>{callInfo?.state ?? 'n/a'}</strong>
          {callInfo?.durationSeconds ? ` · ${formatDuration(callInfo.durationSeconds)}` : ''}
        </p>
      </header>

      <section className="card">
        <h2>Auto-filled (columns A–F)</h2>
        <div className="form-grid">
          <label>
            <span>A · Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span>B · Business Name</span>
            <input value={business} onChange={(e) => setBusiness(e.target.value)} />
          </label>
          <label>
            <span>C · Contact / Owner</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <label>
            <span>D · Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            <span>E · Industry</span>
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </label>
          <label>
            <span>F · State / Province</span>
            <input value={stateProvince} onChange={(e) => setStateProvince(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Your notes (columns G–L)</h2>
        <div className="form-grid">
          <label>
            <span>G · Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">— select —</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>H · Decision Maker?</span>
            <select value={decisionMaker} onChange={(e) => setDecisionMaker(e.target.value)}>
              <option value="">— select —</option>
              {DECISION_MAKER_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>I · Interest</span>
            <select value={interest} onChange={(e) => setInterest(e.target.value)}>
              <option value="">— select —</option>
              {INTEREST_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>K · Follow-Up Date</span>
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </label>
          <label className="span2">
            <span>J · Pain Point</span>
            <input value={painPoint} onChange={(e) => setPainPoint(e.target.value)} />
          </label>
          <label className="span2">
            <span>L · Notes</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </section>

      {error && <div className="banner warn">{error}</div>}

      <section className="dial-controls log-controls">
        <button className="btn primary" onClick={() => doSave(false)} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save Call Log'}
        </button>
        <button className="btn danger" onClick={() => doSave(true)} disabled={saving}>
          ⊘ Save &amp; Mark Do Not Call
        </button>
        <button className="btn ghost" onClick={cancel} disabled={saving}>
          Cancel / Return to Dialer
        </button>
      </section>
    </div>
  )
}
