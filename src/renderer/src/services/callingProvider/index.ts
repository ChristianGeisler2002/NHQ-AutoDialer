import type { CallingProvider } from './types'
import { MockProvider } from './mockProvider'
import { TelnyxProvider } from './telnyxProvider'

export * from './types'

/** Factory: create the configured calling provider. */
export function createProvider(name: 'mock' | 'telnyx'): CallingProvider {
  switch (name) {
    case 'telnyx':
      return new TelnyxProvider()
    case 'mock':
    default:
      return new MockProvider()
  }
}
