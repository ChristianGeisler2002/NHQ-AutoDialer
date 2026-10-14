import { all, get, insert, persistNow, run } from './db'
import { safeStorage } from 'electron'
import { normalizePhone } from './services/phone'
import type {
  AppSettings,
  CallLogInput,
  DoNotCallEntry,
  Lead,
  LeadQueueFilter,
  LeadQueuePage,
  LeadStats,
  LeadStatus,
  SettingsMap
} from '../shared/types'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTINGS_DEFAULTS: AppSettings = {
  callProvider: 'mock',
  trackerPath: '',
  telnyxLogin: '',
  telnyxPassword: '',
  telnyxCallerId: '',
  enforceCallingHours: false,
  callStartHour: 8,
  callEndHour: 21
}

const PRIVATE_SETTINGS = new Set(['telnyxLogin', 'telnyxPassword', 'telnyxCallerId'])
const ENCRYPTED_PREFIX = 'protected:v1:'

function protectSetting(key: string, value: string): string {
  if (!PRIVATE_SETTINGS.has(key) || !value) return value
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('Secure credential storage is unavailable. Keep Mock mode enabled.')
  }
  return ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64')
}

export function migratePrivateSettings(): void {
  for (const row of all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    if (PRIVATE_SETTINGS.has(row.key) && row.value && !row.value.startsWith(ENCRYPTED_PREFIX)) {
      setSetting(row.key, row.value)
    }
  }
  run('VACUUM')
  persistNow()
}

export function getSettingsMap(): SettingsMap {
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings')
  const map: SettingsMap = {}
  for (const r of rows) {
    if (PRIVATE_SETTINGS.has(r.key) && r.value.startsWith(ENCRYPTED_PREFIX)) {
      try { map[r.key] = safeStorage.decryptString(Buffer.from(r.value.slice(ENCRYPTED_PREFIX.length), 'base64')) }
      catch { throw new Error('Stored calling credentials could not be unlocked. Restore access to this OS account before reconnecting.') }
    } else map[r.key] = r.value
  }
  return map
}

export function getSettings(): AppSettings {
  const m = getSettingsMap()
  const num = (k: keyof AppSettings, d: number): number => {
    const v = m[k]
    const n = v === undefined ? NaN : Number(v)
    return Number.isFinite(n) ? n : d
  }
  return {
    callProvider: (m.callProvider as AppSettings['callProvider']) || SETTINGS_DEFAULTS.callProvider,
    trackerPath: m.trackerPath ?? SETTINGS_DEFAULTS.trackerPath,
    telnyxLogin: m.telnyxLogin ?? '',
    telnyxPassword: m.telnyxPassword ?? '',
    telnyxCallerId: m.telnyxCallerId ?? '',
    enforceCallingHours: m.enforceCallingHours === 'true',
    callStartHour: num('callStartHour', SETTINGS_DEFAULTS.callStartHour),
    callEndHour: num('callEndHour', SETTINGS_DEFAULTS.callEndHour)
  }
}

export function setSetting(key: string, value: string): void {
  run(
    'INSERT INTO settings (key, value) VALUES (:k, :v) ' +
      'ON CONFLICT(key) DO UPDATE SET value = :v',
    { ':k': key, ':v': protectSetting(key, value) }
  )
  persistNow()
}

export function setSettings(partial: Record<string, string | number | boolean>): void {
  const current = { ...getSettings(), ...partial }
  if (!['mock', 'telnyx'].includes(String(current.callProvider))) throw new Error('Choose a valid calling provider.')
  for (const hour of [current.callStartHour, current.callEndHour]) {
    if (!Number.isInteger(hour) || Number(hour) < 0 || Number(hour) > 23) throw new Error('Calling hours must be between 0 and 23.')
  }
  if (Number(current.callStartHour) >= Number(current.callEndHour)) throw new Error('The end hour must be later than the start hour.')
  if (current.telnyxCallerId && !normalizePhone(String(current.telnyxCallerId), 'US')) throw new Error('Enter a valid caller ID in E.164 format.')
  const entries = Object.entries(partial).map(([key, value]) => {
    if (!(key in SETTINGS_DEFAULTS)) throw new Error('Unknown setting.')
    return [key, protectSetting(key, String(value))]
  })
  for (const [k, v] of entries) {
    run(
      'INSERT INTO settings (key, value) VALUES (:k, :v) ' +
        'ON CONFLICT(key) DO UPDATE SET value = :v',
      { ':k': k, ':v': v }
    )
  }
  persistNow()
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export function leadStats(): LeadStats {
  const row = get<{ total: number; uncalled: number; called: number; skipped: number; dnc: number }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS uncalled,
       SUM(CASE WHEN status = 'called' THEN 1 ELSE 0 END) AS called,
       SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN status = 'do_not_call' THEN 1 ELSE 0 END) AS dnc
     FROM leads`
  )
  return {
    total: Number(row?.total ?? 0),
    uncalled: Number(row?.uncalled ?? 0),
    called: Number(row?.called ?? 0),
    skipped: Number(row?.skipped ?? 0),
    doNotCall: Number(row?.dnc ?? 0)
  }
}

/** Next lead that has never been actioned, never the next DNC number. */
export function nextUncalledLead(): Lead | undefined {
  return get<Lead>(
    `SELECT * FROM leads
       WHERE status = 'new'
         AND (phone_e164 IS NULL
              OR phone_e164 NOT IN (SELECT phone_e164 FROM do_not_call))
       ORDER BY id ASC
       LIMIT 1`
  )
}

export function getLeadById(id: number): Lead | undefined {
  return get<Lead>('SELECT * FROM leads WHERE id = :id', { ':id': id })
}

export function updateLeadStatus(id: number, status: LeadStatus): void {
  if (!['new', 'called', 'skipped', 'do_not_call'].includes(status)) throw new Error('Invalid lead status.')
  const lead = getLeadById(id)
  if (!lead) throw new Error('Lead not found.')
  if (status !== 'do_not_call' && isDoNotCall(lead.phone_e164)) throw new Error('Remove this number from Do Not Call before changing its status.')
  run('UPDATE leads SET status = :s, updated_at = :u WHERE id = :id', {
    ':s': status,
    ':u': new Date().toISOString(),
    ':id': id
  })
  persistNow()
}

export function listLeads(filter: LeadQueueFilter): LeadQueuePage {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.status && filter.status !== 'all') {
    where.push('status = :status')
    params[':status'] = filter.status
  }
  if (filter.industry && filter.industry !== 'all') {
    where.push('industry = :industry')
    params[':industry'] = filter.industry
  }
  if (filter.search && filter.search.trim()) {
    where.push(
      '(business_name LIKE :q OR owner_name LIKE :q OR phone_original LIKE :q OR ' +
        'phone_e164 LIKE :q OR city LIKE :q OR state_province LIKE :q)'
    )
    params[':q'] = `%${filter.search.trim()}%`
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const totalRow = get<{ n: number }>(`SELECT COUNT(*) AS n FROM leads ${whereSql}`, params)
  const rows = all<Lead>(
    `SELECT * FROM leads ${whereSql} ORDER BY id ASC LIMIT :limit OFFSET :offset`,
    { ...params, ':limit': filter.limit, ':offset': filter.offset }
  )
  return { rows, total: Number(totalRow?.n ?? 0) }
}

export function listIndustries(): string[] {
  const rows = all<{ industry: string }>(
    "SELECT DISTINCT industry FROM leads WHERE industry <> '' ORDER BY industry"
  )
  return rows.map((r) => r.industry)
}

// ---------------------------------------------------------------------------
// Do Not Call
// ---------------------------------------------------------------------------

export function isDoNotCall(phoneE164: string | null): boolean {
  if (!phoneE164) return false
  phoneE164 = normalizePhone(phoneE164, 'US')
  if (!phoneE164) return false
  const row = get<{ n: number }>('SELECT COUNT(*) AS n FROM do_not_call WHERE phone_e164 = :p', {
    ':p': phoneE164
  })
  return Number(row?.n ?? 0) > 0
}

export function dncList(): DoNotCallEntry[] {
  return all<DoNotCallEntry>('SELECT * FROM do_not_call ORDER BY created_at DESC, id DESC')
}

export function dncAdd(phoneE164: string, businessName: string, reason: string): void {
  const normalized = normalizePhone(phoneE164, 'US')
  if (!normalized) throw new Error('Enter a valid phone number.')
  phoneE164 = normalized
  run(
    `INSERT INTO do_not_call (phone_e164, business_name, reason, created_at)
       VALUES (:p, :b, :r, :c)
       ON CONFLICT(phone_e164) DO UPDATE SET
         business_name = CASE WHEN do_not_call.business_name = '' THEN :b ELSE do_not_call.business_name END,
         reason = CASE WHEN :r <> '' THEN :r ELSE do_not_call.reason END`,
    { ':p': phoneE164, ':b': businessName, ':r': reason, ':c': new Date().toISOString() }
  )
  run("UPDATE leads SET status = 'do_not_call' WHERE phone_e164 = :phone", { ':phone': phoneE164 })
  persistNow()
}

export function dncRemove(id: number): void {
  const entry = get<{ phone_e164: string }>('SELECT phone_e164 FROM do_not_call WHERE id = :id', { ':id': id })
  run('DELETE FROM do_not_call WHERE id = :id', { ':id': id })
  if (entry) run("UPDATE leads SET status = 'new' WHERE phone_e164 = :phone AND status = 'do_not_call'", { ':phone': entry.phone_e164 })
  persistNow()
}

/** Mark a lead (and its phone) Do Not Call. */
export function markLeadDoNotCall(id: number, reason: string): void {
  const lead = getLeadById(id)
  if (!lead) return
  if (lead.phone_e164) dncAdd(lead.phone_e164, lead.business_name, reason || 'Marked Do Not Call')
  updateLeadStatus(id, 'do_not_call')
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** Persist a completed call to SQLite. Returns the new call id. */
export function saveCall(input: CallLogInput): number {
  const previous = get<{ id: number; lead_id: number; exported_row: number }>('SELECT id, lead_id, exported_row FROM calls WHERE submission_id = :submission', { ':submission': input.submission_id })
  if (previous) {
    if (previous.lead_id !== input.lead_id) throw new Error('This submission belongs to a different lead.')
    if (previous.exported_row) return Number(previous.id)
    const fields = { call_status: input.status, business_name: input.business_name, owner_name: input.owner_name,
      phone: input.phone, industry: input.industry, state_province: input.state_province, decision_maker: input.decision_maker,
      interest: input.interest, pain_point: input.pain_point, follow_up_date: input.follow_up_date, notes: input.notes }
    if (input.status !== 'Do Not Call' && isDoNotCall(getLeadById(input.lead_id)?.phone_e164 ?? null)) throw new Error('This number is on the Do Not Call list.')
    for (const [column, value] of Object.entries(fields)) run(`UPDATE calls SET ${column} = :value WHERE id = :id`, { ':value': value, ':id': previous.id })
    if (input.status === 'Do Not Call') markLeadDoNotCall(input.lead_id, 'Disposition: Do Not Call')
    persistNow()
    return Number(previous.id)
  }
  const now = new Date().toISOString()
  const id = insert(
    `INSERT INTO calls (
       submission_id, lead_id, call_started_at, call_ended_at, duration_seconds, call_provider,
       provider_call_id, call_status, business_name, owner_name, phone, industry,
       state_province, decision_maker, interest, pain_point, follow_up_date, notes, created_at
     ) VALUES (
       :submission, :lead_id, :started, :ended, :duration, :provider,
       :provider_call_id, :status, :business, :owner, :phone, :industry,
       :state, :dm, :interest, :pain, :followup, :notes, :created
     )`,
    {
      ':submission': input.submission_id,
      ':lead_id': input.lead_id,
      ':started': input.call_started_at,
      ':ended': input.call_ended_at,
      ':duration': Math.max(0, Math.round(input.duration_seconds || 0)),
      ':provider': input.call_provider,
      ':provider_call_id': input.provider_call_id,
      ':status': input.status,
      ':business': input.business_name,
      ':owner': input.owner_name,
      ':phone': input.phone,
      ':industry': input.industry,
      ':state': input.state_province,
      ':dm': input.decision_maker,
      ':interest': input.interest,
      ':pain': input.pain_point,
      ':followup': input.follow_up_date,
      ':notes': input.notes,
      ':created': now
    }
  )

  // Update the lead lifecycle. A "Do Not Call" disposition is permanent.
  if (input.status === 'Do Not Call') {
    const lead = getLeadById(input.lead_id)
    if (lead?.phone_e164) dncAdd(lead.phone_e164, lead.business_name, 'Disposition: Do Not Call')
    updateLeadStatus(input.lead_id, 'do_not_call')
  } else {
    updateLeadStatus(input.lead_id, 'called')
  }
  persistNow()
  return id
}
