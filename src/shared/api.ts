import type {
  AppSettings,
  CallLogInput,
  DoNotCallEntry,
  ImportResult,
  Lead,
  LeadQueueFilter,
  LeadQueuePage,
  LeadStats,
  LeadStatus,
  SaveCallResult
} from './types'

export interface PrecheckResult {
  allowed: boolean
  reason?: string
  localHour?: number
  timezone?: string
}

export interface TrackerChooseResult {
  canceled: boolean
  trackerPath?: string
  ok?: boolean
  migrated?: boolean
  backupPath?: string
  error?: string
}

export interface AppInfo {
  version: string
  userData: string
}

/** The contract exposed to the renderer on `window.api`. */
export interface DialerApi {
  appInfo(): Promise<AppInfo>

  importLeads(zipPaths: string[]): Promise<ImportResult>
  loadSampleLeads(): Promise<number>
  nextLead(): Promise<Lead | null>
  getLead(id: number): Promise<Lead | null>
  listLeads(filter: LeadQueueFilter): Promise<LeadQueuePage>
  industries(): Promise<string[]>
  leadStats(): Promise<LeadStats>
  updateLeadStatus(id: number, status: LeadStatus): Promise<boolean>
  skipLead(id: number): Promise<boolean>
  markDnc(id: number, reason: string): Promise<boolean>
  precheck(id: number): Promise<PrecheckResult>

  saveCall(input: CallLogInput): Promise<SaveCallResult>

  dncList(): Promise<DoNotCallEntry[]>
  dncAdd(p: { phone: string; business: string; reason: string }): Promise<boolean>
  dncRemove(id: number): Promise<boolean>
  dncCheck(phone: string): Promise<boolean>

  getSettings(): Promise<AppSettings>
  setSettings(partial: Partial<Record<keyof AppSettings, string | number | boolean>>): Promise<AppSettings>

  chooseZips(): Promise<string[]>
  chooseTracker(): Promise<TrackerChooseResult>
  ensureTracker(): Promise<string>
  revealTracker(): Promise<boolean>
  openTracker(): Promise<boolean>
  openBackups(): Promise<boolean>
}
