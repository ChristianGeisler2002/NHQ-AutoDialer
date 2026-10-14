import type { DialerApi } from '../shared/api'

declare global {
  interface Window {
    api: DialerApi
  }
}

export {}
