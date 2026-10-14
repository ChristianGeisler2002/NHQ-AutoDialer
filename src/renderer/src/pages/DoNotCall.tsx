import { useEffect, useState, useCallback } from 'react'
import { useApp } from '../context'
import type { DoNotCallEntry } from '../../../shared/types'

export function DoNotCall(): JSX.Element {
  const { reloadStats, showToast } = useApp()
  const [rows, setRows] = useState<DoNotCallEntry[]>([])
  const [phone, setPhone] = useState('')
  const [business, setBusiness] = useState('')
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setRows(await window.api.dncList())
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async (): Promise<void> => {
    if (!phone.trim()) return
    await window.api.dncAdd({ phone: phone.trim(), business: business.trim(), reason: reason.trim() })
    setPhone('')
    setBusiness('')
    setReason('')
    await reloadStats()
    showToast('Added to the permanent Do Not Call list.')
    load()
  }

  const remove = async (id: number): Promise<void> => {
    await window.api.dncRemove(id)
    await reloadStats()
    load()
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Do Not Call List</h1>
        <p className="muted">
          Numbers here are <strong>never dialed</strong>. This list is permanent and stored locally.
        </p>
      </header>

      <section className="card">
        <h2>Add a number manually</h2>
        <div className="form-grid">
          <label>
            <span>Phone number (E.164)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" />
          </label>
          <label>
            <span>Business (optional)</span>
            <input value={business} onChange={(e) => setBusiness(e.target.value)} />
          </label>
          <label className="span2">
            <span>Reason (optional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <button className="btn primary" onClick={add} disabled={!phone.trim()}>
          Add to Do Not Call
        </button>
      </section>

      <section className="card table-card">
        <h2>{rows.length} number(s) on the list</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Phone</th>
                <th>Business</th>
                <th>Reason</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.phone_e164}</td>
                  <td>{r.business_name}</td>
                  <td>{r.reason}</td>
                  <td>{r.created_at ? r.created_at.slice(0, 10) : ''}</td>
                  <td className="actions">
                    <button className="btn xs" onClick={() => remove(r.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    No numbers on the Do Not Call list yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
