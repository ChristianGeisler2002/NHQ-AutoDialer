import { useEffect, useState } from 'react'
import { useApp } from '../context'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function Settings(): JSX.Element {
  const { settings, updateSettings, reloadSettings, providerReady, providerError, showToast } = useApp()

  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [callerId, setCallerId] = useState('')
  const [info, setInfo] = useState<{ version: string; userData: string } | null>(null)

  useEffect(() => {
    if (settings) {
      setLogin(settings.telnyxLogin)
      setPassword(settings.telnyxPassword)
      setCallerId(settings.telnyxCallerId)
    }
  }, [settings])

  useEffect(() => {
    window.api.appInfo().then(setInfo)
  }, [])

  if (!settings) return <div className="page">Loading…</div>

  const saveTelnyx = async (): Promise<void> => {
    try {
      await updateSettings({ telnyxLogin: login, telnyxPassword: password, telnyxCallerId: callerId })
      showToast('Settings saved. Check the provider status above.')
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save credentials.') }
  }

  const chooseTracker = async (): Promise<void> => {
    const res = await window.api.chooseTracker()
    if (res.canceled) return
    await reloadSettings()
    if (res.migrated) showToast(`Tracker migrated to new layout. Backup: ${res.backupPath}`)
    else if (res.ok) showToast('Tracker selected.')
    else showToast(`Error: ${res.error}`)
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="card">
        <h2>Calling provider</h2>
        <div className="radio-row">
          <label className={`radio ${settings.callProvider === 'mock' ? 'sel' : ''}`}>
            <input
              type="radio"
              name="prov"
              checked={settings.callProvider === 'mock'}
              onChange={() => updateSettings({ callProvider: 'mock' })}
            />
            <div>
              <strong>Mock (built-in)</strong>
              <p className="muted">Simulates calls. Use to test the full flow without an account.</p>
            </div>
          </label>
          <label className={`radio ${settings.callProvider === 'telnyx' ? 'sel' : ''}`}>
            <input
              type="radio"
              name="prov"
              checked={settings.callProvider === 'telnyx'}
              onChange={() => updateSettings({ callProvider: 'telnyx' })}
            />
            <div>
              <strong>Telnyx WebRTC</strong>
              <p className="muted">Real calls using a Telnyx SIP Connection credential.</p>
            </div>
          </label>
        </div>
        <div className={`provider-pill ${providerReady ? 'ok' : 'warn'} inline`}>
          {providerReady ? 'Provider ready' : `Not ready${providerError ? ` — ${providerError}` : ''}`}
        </div>

        {settings.callProvider === 'telnyx' && (
          <div className="form-grid telnyx">
            <label>
              <span>SIP Connection username</span>
              <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
            </label>
            <label>
              <span>SIP Connection password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Caller ID number (E.164)</span>
              <input value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="+1…" />
            </label>
            <div className="span2">
              <button className="btn primary" onClick={saveTelnyx}>
                Save &amp; connect
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Call tracker</h2>
        <div className="kv">
          <span>Path:</span>
          <code>{settings.trackerPath || '—'}</code>
        </div>
        <div className="row">
          <button className="btn" onClick={chooseTracker}>
            Choose tracker file…
          </button>
          <button className="btn ghost" onClick={() => window.api.openTracker()}>
            Open tracker
          </button>
          <button className="btn ghost" onClick={() => window.api.revealTracker()}>
            Show in folder
          </button>
          <button className="btn ghost" onClick={() => window.api.openBackups()}>
            Open backups folder
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Calling-hours guardrail</h2>
        <p className="muted">
          When enabled, the Call button is blocked outside the window in the lead’s local time
          (based on its state/province timezone). Helps you stay compliant.
        </p>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enforceCallingHours}
            onChange={(e) => updateSettings({ enforceCallingHours: e.target.checked })}
          />
          <span>Enforce calling hours</span>
        </label>
        <div className="row">
          <label className="inline-field">
            <span>From</span>
            <select
              value={settings.callStartHour}
              onChange={(e) => updateSettings({ callStartHour: Number(e.target.value) })}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>To</span>
            <select
              value={settings.callEndHour}
              onChange={(e) => updateSettings({ callEndHour: Number(e.target.value) })}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Compliance</h2>
        <ul className="compliance">
          <li>✓ Manual click-to-call only — never auto-dials the next lead</li>
          <li>✓ No predictive / parallel dialing, no prerecorded or AI voice</li>
          <li>✓ Permanent Do Not Call list — those numbers are never dialed</li>
          <li>✓ No auto-redial</li>
          <li>✓ Backup of the tracker is created before every write</li>
        </ul>
        {info && (
          <p className="fineprint">
            Version {info.version} · Data: <code>{info.userData}</code>
          </p>
        )}
      </section>
    </div>
  )
}
