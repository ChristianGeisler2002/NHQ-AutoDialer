// Shared types used by the main process, preload bridge and renderer.

export type LeadStatus = 'new' | 'called' | 'skipped' | 'do_not_call'

/** Technical call states emitted by a calling provider. */
export type CallState =
  | 'idle'
  | 'dialing'
  | 'ringing'
  | 'live'
  | 'ended'
  | 'failed'
  | 'busy'
  | 'no_answer'

export interface Lead {
  id: number
  business_name: string
  owner_name: string
  phone_original: string
  phone_e164: string | null
  website: string
  location_raw: string
  city: string
  state_province: string
  country: string
  industry: string
  estimated_revenue: string
  source_file: string
  source_sheet: string
  source_row: number
  status: LeadStatus
  dup_count: number
  dup_sources: string
  created_at: string
  updated_at: string
}

export interface CallRecord {
  id: number
  lead_id: number
  call_started_at: string | null
  call_ended_at: string | null
  duration_seconds: number
  call_provider: string
  provider_call_id: string | null
  call_status: string // sales disposition (Excel column G)
  business_name: string
  owner_name: string
  phone: string
  industry: string
  state_province: string
  decision_maker: string
  interest: string
  pain_point: string
  follow_up_date: string
  notes: string
  created_at: string
}

export interface DoNotCallEntry {
  id: number
  phone_e164: string
  business_name: string
  reason: string
  created_at: string
}

/** Payload sent from the Post-Call Log screen when saving. */
export interface CallLogInput {
  submission_id: string
  lead_id: number
  call_started_at: string | null
  call_ended_at: string | null
  duration_seconds: number
  call_provider: string
  provider_call_id: string | null
  // Column A-F (auto-filled, still editable)
  date: string
  business_name: string
  owner_name: string
  phone: string
  industry: string
  state_province: string
  // Column G-L (manual)
  status: string
  decision_maker: string
  interest: string
  pain_point: string
  follow_up_date: string
  notes: string
}

export interface SaveCallResult {
  ok: boolean
  callId?: number
  trackerPath?: string
  backupPath?: string
  appendedRow?: number
  error?: string
}

export interface ImportResultFile {
  file: string
  sheet: string
  industry: string
  country: string
  rows: number
  imported: number
  duplicates: number
}

export interface ImportResult {
  ok: boolean
  totalRows: number
  imported: number
  duplicates: number
  invalidPhones: number
  files: ImportResultFile[]
  error?: string
}

export interface LeadStats {
  total: number
  uncalled: number
  called: number
  skipped: number
  doNotCall: number
}

export interface AppSettings {
  callProvider: 'mock' | 'telnyx'
  trackerPath: string
  // Telnyx WebRTC SIP credential login
  telnyxLogin: string
  telnyxPassword: string
  telnyxCallerId: string
  // Calling-hours guardrails
  enforceCallingHours: boolean
  callStartHour: number // local hour 0-23
  callEndHour: number // local hour 0-23
}

export type SettingsMap = Record<string, string>

export interface LeadQueueFilter {
  status?: LeadStatus | 'all'
  search?: string
  industry?: string
  limit: number
  offset: number
}

export interface LeadQueuePage {
  rows: Lead[]
  total: number
}
