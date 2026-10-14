import { useApp, type Route } from './context'
import { SetupImport } from './pages/SetupImport'
import { Dialer } from './pages/Dialer'
import { PostCallLog } from './pages/PostCallLog'
import { LeadQueue } from './pages/LeadQueue'
import { DoNotCall } from './pages/DoNotCall'
import { Settings } from './pages/Settings'

interface NavItem {
  route: Route
  label: string
  icon: string
}

const NAV: NavItem[] = [
  { route: 'setup', label: 'Setup / Import', icon: '⬇' },
  { route: 'dialer', label: 'Dialer', icon: '☎' },
  { route: 'queue', label: 'Lead Queue', icon: '☰' },
  { route: 'dnc', label: 'Do Not Call', icon: '⊘' },
  { route: 'settings', label: 'Settings', icon: '⚙' }
]

export function App(): JSX.Element {
  const { route, navigate, stats, toast } = useApp()

  return (
    <div className="app">
      <audio id="remoteAudio" autoPlay aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot">●</span>
          <div>
            <div className="brand-title">NfinityHQ</div>
            <div className="brand-sub">AutoDialer</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.route}
              className={`nav-item ${route === item.route ? 'active' : ''}`}
              aria-current={route === item.route ? 'page' : undefined}
              onClick={() => navigate(item.route)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        {stats && (
          <div className="sidebar-stats">
            <div className="ss-row">
              <span>Uncalled</span>
              <strong>{stats.uncalled}</strong>
            </div>
            <div className="ss-row">
              <span>Called</span>
              <strong>{stats.called}</strong>
            </div>
            <div className="ss-row">
              <span>Do Not Call</span>
              <strong>{stats.doNotCall}</strong>
            </div>
            <div className="ss-row total">
              <span>Total leads</span>
              <strong>{stats.total}</strong>
            </div>
          </div>
        )}
        <div className="sidebar-foot">Manual click-to-call dialer</div>
      </aside>

      <main className="content">
        {route === 'setup' && <SetupImport />}
        {route === 'dialer' && <Dialer />}
        {route === 'postcall' && <PostCallLog />}
        {route === 'queue' && <LeadQueue />}
        {route === 'dnc' && <DoNotCall />}
        {route === 'settings' && <Settings />}
      </main>

      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
