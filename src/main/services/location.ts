// Parse "City, ST" (US) and "City, Province Name" (Canada) location strings into
// a normalised city / state-or-province code / country, plus a representative
// IANA timezone used by the calling-hours guardrail.

export interface ParsedLocation {
  city: string
  stateProvince: string // 2-letter code where possible (e.g. MS, AB)
  country: string // 'US' | 'CA' | ''
  timezone: string // IANA tz, '' if unknown
}

const US_TZ: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
  AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York',
  LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver',
  NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York', SD: 'America/Chicago',
  TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver'
}

const CA_TZ: Record<string, string> = {
  AB: 'America/Edmonton', BC: 'America/Vancouver', MB: 'America/Winnipeg',
  NB: 'America/Moncton', NL: 'America/St_Johns', NS: 'America/Halifax',
  NT: 'America/Yellowknife', NU: 'America/Iqaluit', ON: 'America/Toronto',
  PE: 'America/Halifax', QC: 'America/Toronto', SK: 'America/Regina',
  YT: 'America/Whitehorse'
}

const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC'
}

const CA_PROV_NAMES: Record<string, string> = {
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  'newfoundland and labrador': 'NL', newfoundland: 'NL', 'nova scotia': 'NS',
  'northwest territories': 'NT', nunavut: 'NU', ontario: 'ON',
  'prince edward island': 'PE', quebec: 'QC', 'québec': 'QC', saskatchewan: 'SK',
  yukon: 'YT'
}

export function tzForRegion(stateProvince: string, country: string): string {
  const code = stateProvince.toUpperCase()
  if (country === 'CA') return CA_TZ[code] ?? ''
  if (country === 'US') return US_TZ[code] ?? ''
  return US_TZ[code] ?? CA_TZ[code] ?? ''
}

export function parseLocation(raw: string, countryHint?: 'US' | 'CA'): ParsedLocation {
  const text = String(raw ?? '').trim()
  if (!text) {
    return { city: '', stateProvince: '', country: countryHint ?? '', timezone: '' }
  }

  const commaIdx = text.lastIndexOf(',')
  let city = text
  let region = ''
  if (commaIdx >= 0) {
    city = text.slice(0, commaIdx).trim()
    region = text.slice(commaIdx + 1).trim()
  }

  let stateProvince = ''
  let country = countryHint ?? ''

  if (region) {
    const upper = region.toUpperCase()
    const lower = region.toLowerCase()
    if (US_TZ[upper]) {
      stateProvince = upper
      country = 'US'
    } else if (CA_TZ[upper]) {
      stateProvince = upper
      country = 'CA'
    } else if (US_STATE_NAMES[lower]) {
      stateProvince = US_STATE_NAMES[lower]
      country = 'US'
    } else if (CA_PROV_NAMES[lower]) {
      stateProvince = CA_PROV_NAMES[lower]
      country = 'CA'
    } else {
      stateProvince = region // keep whatever was provided
    }
  }

  const timezone = tzForRegion(stateProvince, country)
  return { city, stateProvince, country, timezone }
}
