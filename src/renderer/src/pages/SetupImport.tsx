import { useState } from 'react'
import { useApp } from '../context'
import type { ImportResult } from '../../../shared/types'

export function SetupImport(): JSX.Element {
  const { settings, reloadSettings, reloadStats, navigate, loadNextLead, showToast } = useApp()
  const [zips, setZips] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [trackerMsg, setTrackerMsg] = useState('')

  const chooseZips = async (): Promise<void> => {
    const paths = await window.api.chooseZips()
    if (paths.length) setZips(paths)
  }

  const runImport = async (): Promise<void> => {
    if (!zips.length) return
    setImporting(true)
    setResult(null)
    try {
      const res = await window.api.importLeads(zips)
      setResult(res)
      await reloadStats()
      if (res.ok) showToast(`Imported ${res.imported} leads (${res.duplicates} duplicates skipped)`)
      else showToast(`Import failed: ${res.error}`)
    } catch (error) { showToast(error instanceof Error ? error.message : 'Import failed.') } finally {
      setImporting(false)
    }
  }

  const useDefaultTracker = async (): Promise<void> => {
    await window.api.ensureTracker()
    await reloadSettings()
    setTrackerMsg('Using the bundled NfinityHQ tracker (new A–L layout).')
  }

  const chooseTracker = async (): Promise<void> => {
    const res = await window.api.chooseTracker()
    if (res.canceled) return
    await reloadSettings()
    if (res.ok && res.migrated) {
      setTrackerMsg(`Tracker migrated to the new A–L layout. Backup saved at: ${res.backupPath}`)
    } else if (res.ok) {
      setTrackerMsg('Tracker selected (already in the new A–L layout).')
    } else {
      setTrackerMsg(`Could not use that file: ${res.error}`)
    }
  }

  const startDialing = async (): Promise<void> => {
    await loadNextLead()
    navigate('dialer')
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Setup &amp; Import</h1>
        <p className="muted">Import your lead spreadsheets and connect your call tracker.</p>
      </header>

      <section className="card">
        <h2>1 · Import leads</h2>
        <p className="muted">
          Select one or more lead ZIP files. Leads are normalized, deduplicated by phone number, and
          stored locally. Industry and country are inferred from each file name.
        </p>
        <div className="row">
          <button className="btn" onClick={chooseZips} disabled={importing}>
            Choose ZIP files…
          </button>
          <button className="btn primary" onClick={runImport} disabled={!zips.length || importing}>
            {importing ? 'Importing…' : 'Import leads'}
          </button>
        </div>
        <p className="hint">Trying the app? Sample leads use fictional numbers and work in Mock mode only.</p>
        <button className="btn ghost" disabled={importing} onClick={async () => {
          try { const count = await window.api.loadSampleLeads(); await reloadStats(); showToast(`Loaded ${count} sample leads.`) }
          catch (error) { showToast(error instanceof Error ? error.message : 'Could not load sample leads.') }
        }}>Load sample leads</button>
        {zips.length > 0 && (
          <ul className="filelist">
            {zips.map((z) => (
              <li key={z}>{z.split(/[\\/]/).pop()}</li>
            ))}
          </ul>
        )}

        {result && (
          <div className="import-result">
            <div className="result-totals">
              <span>
                Rows read: <strong>{result.totalRows}</strong>
              </span>
              <span>
                Imported: <strong>{result.imported}</strong>
              </span>
              <span>
                Duplicates: <strong>{result.duplicates}</strong>
              </span>
              <span>
                Invalid phones: <strong>{result.invalidPhones}</strong>
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Industry</th>
                    <th>Country</th>
                    <th>Rows</th>
                    <th>Imported</th>
                    <th>Dupes</th>
                  </tr>
                </thead>
                <tbody>
                  {result.files.map((f, i) => (
                    <tr key={i}>
                      <td title={f.file}>{f.file}</td>
                      <td>{f.industry}</td>
                      <td>{f.country}</td>
                      <td>{f.rows}</td>
                      <td>{f.imported}</td>
                      <td>{f.duplicates}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>2 · Call tracker</h2>
        <p className="muted">
          Completed calls are appended to the <code>Call Log</code> sheet. A backup is saved before
          every write, and the dashboard is preserved.
        </p>
        <div className="kv">
          <span>Current tracker:</span>
          <code>{settings?.trackerPath || '—'}</code>
        </div>
        <div className="row">
          <button className="btn" onClick={useDefaultTracker}>
            Use bundled tracker
          </button>
          <button className="btn" onClick={chooseTracker}>
            Choose tracker file…
          </button>
          <button className="btn ghost" onClick={() => window.api.openTracker()}>
            Open tracker
          </button>
        </div>
        {trackerMsg && <p className="hint">{trackerMsg}</p>}
      </section>

      <section className="card">
        <h2>3 · Start calling</h2>
        <p className="muted">
          When you’re ready, open the dialer. The app loads one lead at a time — it never auto-dials.
        </p>
        <button className="btn primary lg" onClick={startDialing}>
          Go to Dialer →
        </button>
      </section>
    </div>
  )
}
