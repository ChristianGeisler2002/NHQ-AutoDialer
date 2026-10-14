import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import ExcelJS from 'exceljs'
import type { CallLogInput } from '../../shared/types'

const SHEET = 'Call Log'
const LAST_ROW = 1003

const NEW_HEADERS = [
  'Date', 'Business Name', 'Contact / Owner Name', 'Phone', 'Industry',
  'State/Province', 'Status', 'Decision Maker?', 'Interest', 'Pain Point',
  'Follow-Up Date', 'Notes'
]

const STATUS_OPTS =
  'Connected,No Answer,Left Voicemail,Busy,Bad Number,Not Interested,Interested,' +
  'Follow-Up Booked,Demo Booked,Proposal Sent,Closed Won,Do Not Call'
const DM_OPTS = 'Yes,No,Unsure'
const INTEREST_OPTS = 'Hot,Warm,Cold,Not Interested'

function listValidation(opts: string): ExcelJS.DataValidation {
  return { type: 'list', allowBlank: true, formulae: [`"${opts}"`] }
}

// ExcelJS supports worksheet.dataValidations.add(range, dv) at runtime, but it
// is missing from the bundled type definitions — narrow it locally.
interface RangeDataValidations {
  add(range: string, value: ExcelJS.DataValidation): void
}
function dv(ws: ExcelJS.Worksheet): RangeDataValidations {
  return (ws as unknown as { dataValidations: RangeDataValidations }).dataValidations
}

/** Path to the bundled new-layout tracker template (dev + packaged). */
export function resolveTemplatePath(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'tracker_template.xlsx'),
    path.join(app.getAppPath(), 'resources', 'tracker_template.xlsx'),
    path.join(process.cwd(), 'resources', 'tracker_template.xlsx')
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return candidates[candidates.length - 1]
}

function backupsDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Copy a tracker file into the app backup folder; returns the backup path. */
export function backupTracker(trackerPath: string): string {
  if (!fs.existsSync(trackerPath)) return ''
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = path.basename(trackerPath, path.extname(trackerPath))
  const dest = path.join(backupsDir(), `${base}_${stamp}.xlsx`)
  fs.copyFileSync(trackerPath, dest)
  pruneBackups(base)
  return dest
}

/** Keep only the 50 most recent backups per tracker to bound disk usage. */
function pruneBackups(base: string): void {
  try {
    const dir = backupsDir()
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}_`) && f.endsWith('.xlsx'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const old of files.slice(50)) fs.unlinkSync(path.join(dir, old.f))
  } catch {
    /* non-fatal */
  }
}

function headerText(ws: ExcelJS.Worksheet, col: number): string {
  const v = ws.getCell(2, col).value
  return v === null || v === undefined ? '' : String(v).trim()
}

function isNewLayout(ws: ExcelJS.Worksheet): boolean {
  return headerText(ws, 6).toLowerCase() === 'state/province'
}

function isOldLayout(ws: ExcelJS.Worksheet): boolean {
  return headerText(ws, 6).toLowerCase() === 'status'
}

/** Apply the new-layout dropdown validations to the manual columns. */
function applyValidations(ws: ExcelJS.Worksheet): void {
  dv(ws).add(`G4:G${LAST_ROW}`, listValidation(STATUS_OPTS))
  dv(ws).add(`H4:H${LAST_ROW}`, listValidation(DM_OPTS))
  dv(ws).add(`I4:I${LAST_ROW}`, listValidation(INTEREST_OPTS))
}

/**
 * Migrate an OLD-layout Call Log (Status at F) to the NEW layout
 * (State/Province at F, manual section shifted right). Best-effort; the caller
 * always takes a backup first.
 */
function migrateOldLayout(wb: ExcelJS.Workbook): void {
  const ws = wb.getWorksheet(SHEET)
  if (!ws) return

  // Shift every data row's manual columns right by one and clear stale rules.
  const maxRow = Math.max(ws.rowCount, LAST_ROW)
  for (let r = 3; r <= maxRow; r++) {
    const get = (c: number): unknown => {
      const v = ws.getCell(r, c).value
      return v === null || v === undefined ? '' : v
    }
    const oldF = get(6) // Status
    const oldG = get(7) // Decision Maker
    const oldH = get(8) // Interest
    const oldI = get(9) // Pain Point
    const oldJ = get(10) // Follow-Up Date
    const oldK = get(11) // Follow-Up Via (dropped -> folded into notes)
    const oldL = get(12) // Notes
    const hasData = [oldF, oldG, oldH, oldI, oldJ, oldK, oldL].some((v) => String(v).trim() !== '')
    if (r > 3 && !hasData) continue

    ws.getCell(r, 7).value = oldF as ExcelJS.CellValue
    ws.getCell(r, 8).value = oldG as ExcelJS.CellValue
    ws.getCell(r, 9).value = oldH as ExcelJS.CellValue
    ws.getCell(r, 10).value = oldI as ExcelJS.CellValue
    ws.getCell(r, 11).value = oldJ as ExcelJS.CellValue
    let notes = String(oldL || '')
    if (String(oldK).trim()) notes = `${notes} | Follow-Up Via: ${oldK}`.replace(/^ \| /, '')
    ws.getCell(r, 12).value = notes
    ws.getCell(r, 6).value = '' // State/Province (unknown for history)
    // Clear any stale per-cell validations on the shifted columns.
    for (let c = 6; c <= 12; c++) ws.getCell(r, c).dataValidation = null as never
  }

  // New headers + validations.
  NEW_HEADERS.forEach((h, i) => {
    ws.getCell(2, i + 1).value = h
  })
  applyValidations(ws)

  // Fix Dashboard formula references (Status F->G, Interest H->I; extend range).
  const dash = wb.getWorksheet('Dashboard')
  if (dash) {
    dash.eachRow((row) => {
      row.eachCell((cell) => {
        const f = (cell.value as ExcelJS.CellFormulaValue)?.formula
        if (typeof f === 'string' && f.includes("'Call Log'!")) {
          const nf = f
            .replace(/'Call Log'!F4:F103/g, `'Call Log'!G4:G${LAST_ROW}`)
            .replace(/'Call Log'!H4:H103/g, `'Call Log'!I4:I${LAST_ROW}`)
            .replace(/'Call Log'!A4:A103/g, `'Call Log'!A4:A${LAST_ROW}`)
          cell.value = { formula: nf } as ExcelJS.CellFormulaValue
        }
      })
    })
    dash.getCell('B6').value = { formula: `COUNTA('Call Log'!A4:A${LAST_ROW})` } as ExcelJS.CellFormulaValue
  }
}

/** Find the next empty data row (data starts at row 4; row 3 is the example). */
function nextDataRow(ws: ExcelJS.Worksheet): number {
  let last = 3
  ws.getColumn(1).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber >= 4 && cell.value !== null && String(cell.value).trim() !== '') {
      if (rowNumber > last) last = rowNumber
    }
  })
  return last + 1
}

function copyRowStyle(ws: ExcelJS.Worksheet, fromRow: number, toRow: number): void {
  for (let c = 1; c <= 12; c++) {
    const src = ws.getCell(fromRow, c)
    const dst = ws.getCell(toRow, c)
    if (src.style) dst.style = JSON.parse(JSON.stringify(src.style))
  }
}

export interface AppendResult {
  appendedRow: number
  backupPath: string
}

/**
 * Append a completed call as a new row on the Call Log sheet, preserving the
 * workbook (dashboard, formulas, formatting). Always backs up first.
 */
export async function appendCallRow(trackerPath: string, input: CallLogInput): Promise<AppendResult> {
  const backupPath = backupTracker(trackerPath)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(trackerPath)
  let ws = wb.getWorksheet(SHEET)
  if (!ws) ws = wb.addWorksheet(SHEET)

  if (isOldLayout(ws)) {
    migrateOldLayout(wb)
    ws = wb.getWorksheet(SHEET) as ExcelJS.Worksheet
  } else if (!isNewLayout(ws)) {
    // Unknown/empty — establish the new header + validations without data loss.
    NEW_HEADERS.forEach((h, i) => {
      ws!.getCell(2, i + 1).value = h
    })
    applyValidations(ws)
  }

  let previousRow = 0
  ws.getColumn(13).eachCell((cell, number) => { if (cell.value === input.submission_id) previousRow = number })
  if (previousRow) return { appendedRow: previousRow, backupPath }
  const row = nextDataRow(ws)
  ws.getColumn(13).hidden = true
  ws.getCell(row, 13).value = input.submission_id
  copyRowStyle(ws, 3, row)

  const values: Record<number, ExcelJS.CellValue> = {
    1: input.date,
    2: input.business_name,
    3: input.owner_name,
    4: input.phone,
    5: input.industry,
    6: input.state_province,
    7: input.status,
    8: input.decision_maker,
    9: input.interest,
    10: input.pain_point,
    11: input.follow_up_date,
    12: input.notes
  }
  for (const [c, v] of Object.entries(values)) ws.getCell(row, Number(c)).value = v ?? ''

  // Guarantee the dropdowns reach this row even past the template's range.
  if (row > LAST_ROW) {
    ws.getCell(row, 7).dataValidation = listValidation(STATUS_OPTS)
    ws.getCell(row, 8).dataValidation = listValidation(DM_OPTS)
    ws.getCell(row, 9).dataValidation = listValidation(INTEREST_OPTS)
  }

  const temp = `${trackerPath}.tmp.xlsx`
  try {
    await wb.xlsx.writeFile(temp)
    fs.renameSync(temp, trackerPath)
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
  return { appendedRow: row, backupPath }
}

/**
 * Ensure there is a usable working tracker. If none is configured (or the file
 * is missing), copy the bundled new-layout template into userData.
 */
export function ensureWorkingTracker(currentPath: string): string {
  if (currentPath && fs.existsSync(currentPath)) return currentPath
  const template = resolveTemplatePath()
  const dest = path.join(app.getPath('userData'), 'NfinityHQ_Call_Tracker.xlsx')
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(template, dest)
  }
  return dest
}

/**
 * Validate a user-selected tracker; migrate an old-layout file in place
 * (after backup) so appends always use the new layout.
 */
export async function validateOrMigrateTracker(
  trackerPath: string
): Promise<{ ok: boolean; migrated: boolean; backupPath: string; error?: string }> {
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(trackerPath)
    const ws = wb.getWorksheet(SHEET)
    if (!ws) return { ok: false, migrated: false, backupPath: '', error: `No "${SHEET}" sheet found` }
    if (isNewLayout(ws)) return { ok: true, migrated: false, backupPath: '' }
    if (!isOldLayout(ws)) return { ok: false, migrated: false, backupPath: '', error: 'Unrecognized Call Log headers. Select the bundled tracker or a supported workbook.' }
    const backupPath = backupTracker(trackerPath)
    migrateOldLayout(wb)
    await wb.xlsx.writeFile(trackerPath)
    return { ok: true, migrated: true, backupPath }
  } catch (err) {
    return { ok: false, migrated: false, backupPath: '', error: err instanceof Error ? err.message : String(err) }
  }
}
