import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import ExcelJS from 'exceljs'
import AdmZip from 'adm-zip'
import { initDatabase, all, run, getDbPath, persistNow } from '../src/main/db'
import * as store from '../src/main/store'
import { appendCallRow, ensureWorkingTracker, validateOrMigrateTracker } from '../src/main/services/excel'
import { importZips } from '../src/main/services/importer'
import { precheckCall } from '../src/main/ipc'
import { MockProvider } from '../src/renderer/src/services/callingProvider/mockProvider'
import { TelnyxProvider } from '../src/renderer/src/services/callingProvider/telnyxProvider'
import type { CallLogInput } from '../src/shared/types'
import type { TelnyxRTC } from '@telnyx/webrtc'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nhq-tests-'))
app.setPath('userData', temporary)
let passed = 0
async function check(name: string, action: () => unknown): Promise<void> {
  await action(); passed++; console.log(`PASS ${name}`)
}

async function main(): Promise<void> {
  await app.whenReady()
  await initDatabase()
  await check('fresh workspace has no contacts or credentials', () => {
    assert.equal(store.leadStats().total, 0)
    assert.equal(store.getSettings().callProvider, 'mock')
    assert.equal(store.getSettings().telnyxPassword, '')
  })
  await check('credentials encrypt on disk and migrate from old settings', () => {
    const placeholder = 'fictional-test-password'
    store.setSettings({ telnyxPassword: placeholder })
    assert.equal(store.getSettings().telnyxPassword, placeholder)
    assert.ok(!fs.readFileSync(getDbPath()).includes(Buffer.from(placeholder)))
    run("UPDATE settings SET value = 'legacy-test-placeholder' WHERE key = 'telnyxPassword'")
    store.migratePrivateSettings()
    assert.equal(store.getSettings().telnyxPassword, 'legacy-test-placeholder')
    assert.ok(!fs.readFileSync(getDbPath()).includes(Buffer.from('legacy-test-placeholder')))
    store.setSettings({ telnyxPassword: '' })
  })
  await check('invalid settings do not partially save', () => {
    assert.throws(() => store.setSettings({ callStartHour: 22, callEndHour: 8 }))
    assert.equal(store.getSettings().callStartHour, 8)
    assert.throws(() => store.setSettings({ unknown: 'x' }))
  })

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Leads')
  sheet.addRow(['Business', 'Owner', 'Phone', 'Website', 'Location', 'Revenue'])
  // Reserved fictional numbers; no personal or customer records are used.
  sheet.addRow(['Example business', 'Sample contact', '+12025550101', 'https://example.com', 'Washington, DC', ''])
  sheet.addRow(['Duplicate sample', '', '(202) 555-0101', '', 'Washington, DC', ''])
  sheet.addRow(['Invalid sample', '', 'invalid', '', '', ''])
  const archive = new AdmZip()
  archive.addFile('example_us_leads.xlsx', Buffer.from(await workbook.xlsx.writeBuffer()))
  const archivePath = path.join(temporary, 'sample.zip')
  archive.writeZip(archivePath)
  await check('ZIP import normalizes phones and deduplicates reimports', async () => {
    const first = await importZips([archivePath])
    assert.equal(first.ok, true)
    assert.equal(first.imported, 2)
    assert.equal(first.duplicates, 1)
    assert.equal(first.invalidPhones, 1)
    const second = await importZips([archivePath])
    assert.equal(second.duplicates, 2)
  })
  const lead = store.listLeads({ limit: 25, offset: 0 }).rows.find(row => row.phone_e164)!
  await check('failed imports roll back the whole batch', async () => {
    const before = store.leadStats().total
    const sample = new ExcelJS.Workbook()
    const rows = sample.addWorksheet('Leads')
    rows.addRow(['Business', 'Owner', 'Phone'])
    rows.addRow(['Another example', 'Sample contact', '+12025550102'])
    const broken = new AdmZip()
    broken.addFile('first.xlsx', Buffer.from(await sample.xlsx.writeBuffer()))
    broken.addFile('broken.xlsx', Buffer.from('not a workbook'))
    const target = path.join(temporary, 'broken.zip')
    broken.writeZip(target)
    assert.equal((await importZips([target])).ok, false)
    assert.equal(store.leadStats().total, before)
  })
  await check('archives without spreadsheets return a useful error', async () => {
    const empty = new AdmZip()
    empty.addFile('readme.txt', Buffer.from('Sample archive'))
    const target = path.join(temporary, 'empty.zip')
    empty.writeZip(target)
    const result = await importZips([target])
    assert.equal(result.ok, false)
    assert.match(result.error!, /No .xlsx/)
  })
  await check('formatted Do Not Call numbers block calls and queue access', () => {
    store.dncAdd('(202) 555-0101', 'Example business', 'Test')
    assert.equal(precheckCall(lead.id).allowed, false)
    assert.notEqual(store.nextUncalledLead()?.id, lead.id)
    assert.throws(() => store.updateLeadStatus(lead.id, 'new'))
    store.dncRemove(store.dncList()[0].id)
    assert.equal(store.getLeadById(lead.id)?.status, 'new')
    assert.equal(precheckCall(lead.id).allowed, true)
  })
  await check('calling hours apply before dialing', () => {
    store.setSettings({ enforceCallingHours: true, callStartHour: 0, callEndHour: 1 })
    const result = precheckCall(lead.id)
    assert.equal(result.allowed, result.localHour === 0)
    store.setSettings({ enforceCallingHours: false })
  })
  const input: CallLogInput = {
    submission_id: 'sample-submission-1', lead_id: lead.id, call_started_at: null, call_ended_at: null,
    duration_seconds: 0, call_provider: 'mock', provider_call_id: 'sample-call-1', date: '2026-01-01',
    business_name: 'Example business', owner_name: 'Sample contact', phone: '+12025550101', industry: 'Example',
    state_province: 'DC', status: 'Connected', decision_maker: '', interest: '', pain_point: '', follow_up_date: '', notes: 'Fictional test record'
  }
  await check('call retries create one SQLite record', () => {
    const id = store.saveCall(input)
    assert.equal(store.saveCall(input), id)
    assert.equal(all('SELECT id FROM calls').length, 1)
    store.saveCall({ ...input, notes: 'Updated fictional note' })
    assert.equal(all<{ notes: string }>('SELECT notes FROM calls')[0].notes, 'Updated fictional note')
  })
  await check('tracker creation, append, backup and export retries preserve data', async () => {
    const tracker = ensureWorkingTracker('')
    assert.ok(fs.existsSync(tracker))
    const first = await appendCallRow(tracker, input)
    assert.equal(first.appendedRow, 4)
    assert.ok(fs.existsSync(first.backupPath))
    assert.equal((await appendCallRow(tracker, input)).appendedRow, 4)
    const read = new ExcelJS.Workbook()
    await read.xlsx.readFile(tracker)
    assert.equal(read.getWorksheet('Call Log')!.getCell('F4').value, 'DC')
    assert.ok(read.getWorksheet('Dashboard'))
  })
  await check('unknown tracker layouts are refused without modification', async () => {
    const target = path.join(temporary, 'unknown.xlsx')
    const unknown = new ExcelJS.Workbook()
    unknown.addWorksheet('Call Log').getCell('A2').value = 'Other layout'
    await unknown.xlsx.writeFile(target)
    const before = fs.readFileSync(target)
    assert.equal((await validateOrMigrateTracker(target)).ok, false)
    assert.deepEqual(fs.readFileSync(target), before)
  })
  await check('mock call can end once without dialing another lead', async () => {
    const provider = new MockProvider()
    let ended = 0
    provider.onCallEnded(() => ended++)
    await provider.initializeProvider({ provider: 'mock' })
    await provider.startCall('+12025550101', lead.id)
    await provider.hangupCall()
    await provider.hangupCall()
    assert.equal(ended, 1)
    provider.destroy()
  })
  await check('Telnyx uses on/off events and sends audio to the renderer', async () => {
    const events = new Map<string, Function>()
    let options: Record<string, unknown> = {}
    const call = { id: 'sample-provider-call', hangup: async () => {}, muteAudio() {}, unmuteAudio() {} }
    const fake = {
      on: (name: string, listener: Function) => events.set(name, listener),
      off: (name: string) => events.delete(name),
      connect: async () => { events.get('telnyx.ready')?.() }, disconnect: async () => {},
      newCall: (value: Record<string, unknown>) => { options = value; return call }
    }
    const provider = new TelnyxProvider(async () => fake as unknown as TelnyxRTC, 100)
    await provider.initializeProvider({ provider: 'telnyx', telnyxLogin: 'sample-login', telnyxPassword: 'placeholder', callerId: '+12025550100' })
    await provider.startCall('+12025550101', lead.id)
    assert.equal(options.remoteElement, 'remoteAudio')
    assert.equal(options.video, false)
    await provider.hangupCall()
    provider.destroy()
  })
  await check('Telnyx connection timeout fails cleanly without credentials in errors', async () => {
    const fake = { on() {}, off() {}, connect: async () => {}, disconnect: async () => {} }
    const provider = new TelnyxProvider(async () => fake as unknown as TelnyxRTC, 20)
    await assert.rejects(provider.initializeProvider({ provider: 'telnyx', telnyxLogin: 'sample-login', telnyxPassword: 'placeholder', callerId: '+12025550100' }), /Could not connect/)
    provider.destroy()
  })
  persistNow()
  console.log(`${passed} integration checks passed.`)
}

main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
