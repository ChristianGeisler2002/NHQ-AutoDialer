/** Shared formatting helpers for the renderer. */

export function todayISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

const STATE_LABEL: Record<string, string> = {
  idle: 'Ready',
  dialing: 'Dialing…',
  ringing: 'Ringing…',
  live: 'Connected',
  ended: 'Call ended',
  failed: 'Call failed',
  busy: 'Busy',
  no_answer: 'No answer'
}

export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state
}

/** Suggest a sales disposition (column G) from the technical call outcome. */
export function suggestStatus(state: string, wasLive: boolean): string {
  switch (state) {
    case 'ended':
      return wasLive ? 'Connected' : 'No Answer'
    case 'no_answer':
      return 'No Answer'
    case 'busy':
      return 'Busy'
    case 'failed':
      return 'Bad Number'
    case 'live':
      return 'Connected'
    default:
      return ''
  }
}

export function countryLabel(code: string): string {
  if (code === 'US') return 'United States'
  if (code === 'CA') return 'Canada'
  return code || '—'
}
