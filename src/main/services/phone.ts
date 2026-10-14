import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js'

/**
 * Normalise a raw phone string to E.164. US and Canada both live in the +1
 * (NANP) plan, so the country hint mostly disambiguates formatting. Returns
 * null when the number cannot be parsed into a valid phone number.
 */
export function normalizePhone(raw: string, countryHint: CountryCode = 'US'): string | null {
  if (!raw) return null
  const cleaned = String(raw).trim()
  if (!cleaned) return null

  const tryParse = (country: CountryCode | undefined): string | null => {
    try {
      const pn = parsePhoneNumberFromString(cleaned, country)
      if (pn && pn.isValid()) return pn.number
    } catch {
      /* ignore */
    }
    return null
  }

  return tryParse(countryHint) ?? tryParse('US') ?? tryParse('CA') ?? tryParse(undefined)
}

/** Human-friendly national formatting for display, falling back to the input. */
export function formatPhoneDisplay(raw: string, countryHint: CountryCode = 'US'): string {
  try {
    const pn = parsePhoneNumberFromString(String(raw).trim(), countryHint)
    if (pn) return pn.formatNational()
  } catch {
    /* ignore */
  }
  return raw
}
