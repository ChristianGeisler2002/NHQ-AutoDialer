import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render(): ReactNode {
    if (this.state.failed) return <main className="page"><h1>The screen could not load</h1><p>Your local records are still saved. Restart the app and try again.</p><button className="btn" onClick={() => window.location.reload()}>Reload</button></main>
    return this.props.children
  }
}
