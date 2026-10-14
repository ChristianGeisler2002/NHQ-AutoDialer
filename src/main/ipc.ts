import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import path from 'node:path'
import { importZips } from './services/importer'
import { appendCallRow, ensureWorkingTracker, validateOrMigrateTracker } from './services/excel'
import { tzForRegion } from './services/location'
import * as store from './store'
import * as database from './db'
import { insert, persistNow } from './db'
import type { CallLogInput, LeadQueueFilter, SaveCallResult } from '../shared/types'

function localHourInTz(tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
    const h = Number(fmt.format(new Date()))
    return Number.isFinite(h) ? h % 24 : new Date().getHours()
  } catch {
    return new Date().getHours()
  }
}

interface PrecheckResult {
  allowed: boolean
  reason?: string
  localHour?: number
  timezone?: string
}

export function precheckCall(leadId: number): PrecheckResult {
  const lead = store.getLeadById(leadId)
  if (!lead) return { allowed: false, reason: 'Lead not found' }
  if (!lead.phone_e164) return { allowed: false, reason: 'This lead has no valid phone number' }
  if (store.isDoNotCall(lead.phone_e164))
    return { allowed: false, reason: 'This number is on the Do Not Call list' }

  const settings = store.getSettings()
  if (settings.callProvider === 'telnyx' && lead.source_file === 'Built-in sample') return { allowed: false, reason: 'Sample leads work in Mock mode only.' }
  const tz = tzForRegion(lead.state_province, lead.country)
  if (settings.enforceCallingHours) {
    const hour = tz ? localHourInTz(tz) : new Date().getHours()
    if (hour < settings.callStartHour || hour >= settings.callEndHour) {
      return {
        allowed: false,
        reason:
          `Outside allowed calling hours. Local time is ~${hour}:00` +
          (tz ? ` (${tz})` : '') +
          `. Window is ${settings.callStartHour}:00–${settings.callEndHour}:00.`,
        localHour: hour,
        timezone: tz
      }
    }
    return { allowed: true, localHour: hour, timezone: tz }
  }
  return { allowed: true, timezone: tz }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  let pending = Promise.resolve()
  const handle = (channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      const window = getWindow()
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted application request.')
      const task = pending.then(() => handler(event, ...args))
      pending = task.then(() => undefined, () => undefined)
      return task
    })
  }

  handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData')
  }))

  handle('leads:sample', () => {
    if (store.leadStats().total) throw new Error('Sample leads are available only in an empty workspace.')
    for (let index = 1; index <= 3; index++) {
      const phone = '+1202555010' + index
      insert(`INSERT INTO leads (business_name, owner_name, phone_original, phone_e164, city, state_province, country, industry, source_file)
        VALUES (:business, 'Sample contact', :phone, :phone, 'Washington', 'DC', 'US', 'Example services', 'Built-in sample')`,
        { ':business': 'Example business ' + index, ':phone': phone })
    }
    persistNow()
    return 3
  })
  // ---- Leads ----
  handle('leads:import', (_e, zipPaths: string[]) => importZips(zipPaths))
  handle('leads:next', () => store.nextUncalledLead() ?? null)
  handle('leads:getById', (_e, id: number) => store.getLeadById(id) ?? null)
  handle('leads:list', (_e, filter: LeadQueueFilter) => store.listLeads(filter))
  handle('leads:industries', () => store.listIndustries())
  handle('leads:stats', () => store.leadStats())
  handle('leads:updateStatus', (_e, id: number, status) => {
    store.updateLeadStatus(id, status)
    return true
  })
  handle('leads:skip', (_e, id: number) => {
    store.updateLeadStatus(id, 'skipped')
    return true
  })
  handle('leads:markDnc', (_e, id: number, reason: string) => {
    store.markLeadDoNotCall(id, reason)
    return true
  })
  handle('leads:precheck', (_e, id: number) => precheckCall(id))

  // ---- Calls ----
  let savingCall = false
  handle('calls:save', async (_e, input: CallLogInput): Promise<SaveCallResult> => {
    if (savingCall) return { ok: false, error: 'A call is already being saved. Please wait.' }
    savingCall = true
    try {
      if (!input.submission_id || !store.getLeadById(input.lead_id)) throw new Error('The call or lead is missing. Reopen the call log.')
      const existing = database
      const logged = existing.get<{ id: number; exported_row: number }>('SELECT id, exported_row FROM calls WHERE submission_id = :submission', { ':submission': input.submission_id })
      const callId = store.saveCall(input)
      const settings = store.getSettings()
      if (logged?.exported_row) return { ok: true, callId, trackerPath: settings.trackerPath, appendedRow: logged.exported_row }
      const trackerPath = ensureWorkingTracker(settings.trackerPath)
      if (trackerPath !== settings.trackerPath) store.setSetting('trackerPath', trackerPath)
      const { appendedRow, backupPath } = await appendCallRow(trackerPath, input)
      existing.run('UPDATE calls SET exported_row = :row WHERE id = :id', { ':row': appendedRow, ':id': callId })
      existing.persistNow()
      return { ok: true, callId, trackerPath, backupPath, appendedRow }
    } catch (err) {
      return { ok: false, error: 'Could not finish saving the tracker. Close it in Excel and retry. ' + (err instanceof Error ? err.message : String(err)) }
    } finally { savingCall = false }
  })

  // ---- Do Not Call ----
  handle('dnc:list', () => store.dncList())
  handle('dnc:add', (_e, p: { phone: string; business: string; reason: string }) => {
    store.dncAdd(p.phone, p.business, p.reason)
    return true
  })
  handle('dnc:remove', (_e, id: number) => {
    store.dncRemove(id)
    return true
  })
  handle('dnc:check', (_e, phone: string) => store.isDoNotCall(phone))

  // ---- Settings ----
  handle('settings:get', () => store.getSettings())
  handle('settings:set', (_e, partial: Record<string, string | number | boolean>) => {
    store.setSettings(partial)
    return store.getSettings()
  })

  // ---- Files / dialogs ----
  handle('dialog:chooseZips', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select lead ZIP files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Lead archives', extensions: ['zip'] }]
    })
    return res.canceled ? [] : res.filePaths
  })

  handle('tracker:choose', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select your Call Tracker workbook',
      properties: ['openFile'],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const trackerPath = res.filePaths[0]
    const result = await validateOrMigrateTracker(trackerPath)
    if (result.ok) store.setSetting('trackerPath', trackerPath)
    return { canceled: false, trackerPath, ...result }
  })

  handle('tracker:ensure', () => {
    const settings = store.getSettings()
    const trackerPath = ensureWorkingTracker(settings.trackerPath)
    if (trackerPath !== settings.trackerPath) store.setSetting('trackerPath', trackerPath)
    return trackerPath
  })

  handle('tracker:reveal', () => {
    const settings = store.getSettings()
    if (settings.trackerPath) shell.showItemInFolder(settings.trackerPath)
    return true
  })

  handle('tracker:open', () => {
    const settings = store.getSettings()
    if (settings.trackerPath) shell.openPath(settings.trackerPath)
    return true
  })

  handle('backups:open', () => {
    shell.openPath(path.join(app.getPath('userData'), 'backups'))
    return true
  })
}
