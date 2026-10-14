import { useEffect, useState, useCallback } from 'react'
import { useApp } from '../context'
import type { Lead, LeadQueuePage, LeadStatus } from '../../../shared/types'
import { countryLabel } from '../format'

const PAGE_SIZE = 25
const STATUS_FILTERS: Array<{ value: LeadStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'Uncalled' },
  { value: 'called', label: 'Called' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'do_not_call', label: 'Do Not Call' }
]

export function LeadQueue(): JSX.Element {
  const { setCurrentLead, navigate, reloadStats, showToast } = useApp()
  const [status, setStatus] = useState<LeadStatus | 'all'>('all')
  const [industry, setIndustry] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<LeadQueuePage>({ rows: [], total: 0 })
  const [industries, setIndustries] = useState<string[]>([])

  useEffect(() => {
    window.api.industries().then(setIndustries)
  }, [])

  const load = useCallback(async () => {
    const res = await window.api.listLeads({
      status,
      industry,
      search,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE
    })
    setData(res)
  }, [status, industry, search, page])

  useEffect(() => {
    load()
  }, [load])

  const dial = (lead: Lead): void => {
    setCurrentLead(lead)
    navigate('dialer', {})
  }

  const markDnc = async (lead: Lead): Promise<void> => {
    await window.api.markDnc(lead.id, 'Marked Do Not Call from queue')
    await reloadStats()
    showToast(`${lead.business_name || lead.phone_e164} marked Do Not Call.`)
    load()
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))

  return (
    <div className="page">
      <header className="page-head">
        <h1>Lead Queue</h1>
        <p className="muted">{data.total.toLocaleString()} leads match your filters.</p>
      </header>

      <section className="card filters">
        <div className="filter-row">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`chip ${status === f.value ? 'active' : ''}`}
              onClick={() => {
                setStatus(f.value)
                setPage(0)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <select
            value={industry}
            onChange={(e) => {
              setIndustry(e.target.value)
              setPage(0)
            }}
          >
            <option value="all">All industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <input
            className="search"
            placeholder="Search name, phone, city…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </div>
      </section>

      <section className="card table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Owner</th>
                <th>Phone</th>
                <th>State</th>
                <th>Industry</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((lead) => (
                <tr key={lead.id}>
                  <td>{lead.business_name}</td>
                  <td>{lead.owner_name}</td>
                  <td>{lead.phone_original || lead.phone_e164}</td>
                  <td title={countryLabel(lead.country)}>{lead.state_province}</td>
                  <td>{lead.industry}</td>
                  <td>
                    <span className={`pill status-${lead.status}`}>{lead.status}</span>
                  </td>
                  <td className="actions">
                    <button className="btn xs" onClick={() => dial(lead)}>
                      Open
                    </button>
                    {lead.status !== 'do_not_call' && (
                      <button className="btn xs danger" onClick={() => markDnc(lead)}>
                        DNC
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No leads match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <button className="btn xs" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            ← Prev
          </button>
          <span>
            Page {page + 1} / {totalPages}
          </span>
          <button
            className="btn xs"
            onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
            disabled={page + 1 >= totalPages}
          >
            Next →
          </button>
        </div>
      </section>
    </div>
  )
}
