import path from 'node:path'
import fs from 'node:fs'
import AdmZip from 'adm-zip'
import ExcelJS from 'exceljs'
import { all, insert, persistNow, run } from '../db'
import { normalizePhone } from './phone'
import { parseLocation } from './location'
import type { ImportResult, ImportResultFile } from '../../shared/types'

/** Infer the industry from a lead workbook's file name. */
export function industryFromFileName(file: string): string {
  const n = file.toLowerCase()
  if (n.includes('trucking') || n.includes('logistic')) return 'Trucking / Logistics'
  if (n.includes('hvac')) return 'HVAC'
  if (n.includes('auto_repair') || n.includes('auto repair') || n.includes('autorepair'))
    return 'Auto Repair'
  if (n.includes('construction') || n.includes('landscap')) return 'Construction / Landscaping'
  return 'Other'
}

/** Infer country (US/CA) from a lead workbook's file name. */
export function countryFromFileName(file: string): 'US' | 'CA' {
  const n = file.toLowerCase()
  if (n.includes('ca_leads') || n.includes('_ca_') || n.includes('canada')) return 'CA'
  return 'US'
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return ''
  const v = cell.value as unknown
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
    if (typeof o.result !== 'undefined') return String(o.result)
    if (typeof o.hyperlink === 'string') return o.hyperlink
    if (typeof o.richText !== 'undefined' && Array.isArray(o.richText))
      return (o.richText as Array<{ text: string }>).map((r) => r.text).join('')
    return String(v)
  }
  return String(v).trim()
}

interface ColMap {
  business: number
  owner: number
  phone: number
  website: number
  location: number
  revenue: number
}

function mapColumns(headerRow: ExcelJS.Row): ColMap {
  const map: ColMap = { business: 1, owner: 2, phone: 3, website: 4, location: 5, revenue: 6 }
  let found = false
  headerRow.eachCell((cell, col) => {
    const h = cellText(cell).toLowerCase().trim()
    if (!h) return
    found = true
    if (h.includes('business')) map.business = col
    else if (h.includes('owner') || h.includes('contact')) map.owner = col
    else if (h.includes('phone')) map.phone = col
    else if (h.includes('website') || h.includes('site') || h.includes('url')) map.website = col
    else if (h.includes('location') || h.includes('city')) map.location = col
    else if (h.includes('revenue')) map.revenue = col
  })
  // If row 1 had no headers, fall back to the fixed positional layout.
  if (!found) return { business: 1, owner: 2, phone: 3, website: 4, location: 5, revenue: 6 }
  return map
}

type SeenMap = Map<string, number>
const MAX_BYTES = 64 * 1024 * 1024
const MAX_ROWS = 100000

async function processWorkbook(
  buffer: Buffer,
  fileName: string,
  seen: SeenMap,
  result: ImportResult
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const expanded = new AdmZip(buffer).getEntries().reduce((size, entry) => size + entry.header.size, 0)
  if (expanded > MAX_BYTES) throw new Error('A workbook is too large. Split it into smaller files.')
  // ExcelJS's bundled d.ts merges a conflicting global `Buffer` type; the value
  // is a real Node Buffer at runtime.
  await wb.xlsx.load(buffer as never)
  const industry = industryFromFileName(fileName)
  const country = countryFromFileName(fileName)
  const now = new Date().toISOString()

  for (const ws of wb.worksheets) {
    if (ws.rowCount > MAX_ROWS) throw new Error('A worksheet has too many rows. Split it into smaller files.')
    const fileStat: ImportResultFile = {
      file: fileName,
      sheet: ws.name,
      industry,
      country,
      rows: 0,
      imported: 0,
      duplicates: 0
    }
    if (ws.rowCount < 2) {
      result.files.push(fileStat)
      continue
    }
    const cols = mapColumns(ws.getRow(1))

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const business = cellText(row.getCell(cols.business))
      const owner = cellText(row.getCell(cols.owner))
      const phoneRaw = cellText(row.getCell(cols.phone))
      const website = cellText(row.getCell(cols.website))
      const location = cellText(row.getCell(cols.location))
      const revenue = cellText(row.getCell(cols.revenue))

      // Skip fully empty rows.
      if (!business && !owner && !phoneRaw && !location) continue
      fileStat.rows++
      result.totalRows++

      const e164 = normalizePhone(phoneRaw, country)
      if (!e164) result.invalidPhones++

      const loc = parseLocation(location, country)
      const sourceTag = `${fileName}#${ws.name}:${r}`

      if (e164 && seen.has(e164)) {
        // Duplicate phone — keep the first, record the duplicate source.
        const keepId = seen.get(e164) as number
        run(
          'UPDATE leads SET dup_count = dup_count + 1, ' +
            "dup_sources = CASE WHEN dup_sources = '' THEN :src ELSE dup_sources || ' | ' || :src END " +
            'WHERE id = :id',
          { ':src': sourceTag, ':id': keepId }
        )
        fileStat.duplicates++
        result.duplicates++
        continue
      }

      const id = insert(
        `INSERT INTO leads (
          business_name, owner_name, phone_original, phone_e164, website,
          location_raw, city, state_province, country, industry, estimated_revenue,
          source_file, source_sheet, source_row, status, dup_count, dup_sources,
          created_at, updated_at
        ) VALUES (
          :business, :owner, :phone_original, :phone_e164, :website,
          :location_raw, :city, :state_province, :country, :industry, :revenue,
          :source_file, :source_sheet, :source_row, 'new', 0, '',
          :created_at, :updated_at
        )`,
        {
          ':business': business,
          ':owner': owner,
          ':phone_original': phoneRaw,
          ':phone_e164': e164,
          ':website': website,
          ':location_raw': location,
          ':city': loc.city,
          ':state_province': loc.stateProvince,
          ':country': loc.country || country,
          ':industry': industry,
          ':revenue': revenue,
          ':source_file': fileName,
          ':source_sheet': ws.name,
          ':source_row': r,
          ':created_at': now,
          ':updated_at': now
        }
      )
      if (e164) seen.set(e164, id)
      fileStat.imported++
      result.imported++
    }
    result.files.push(fileStat)
  }
}

function walkZip(zip: AdmZip, depth: number, out: Array<{ name: string; buf: Buffer }>, budget = { bytes: 0, entries: 0 }): void {
  if (depth > 4) throw new Error('Lead archives are nested too deeply.')
  for (const entry of zip.getEntries()) {
    if (++budget.entries > 2000) throw new Error('Too many files in the archive.')
    if (entry.isDirectory) continue
    budget.bytes += entry.header.size
    if (budget.bytes > MAX_BYTES) throw new Error('The archive is too large. Import smaller batches.')
    const name = entry.entryName
    const lower = name.toLowerCase()
    if (lower.endsWith('.xlsx')) {
      out.push({ name: path.basename(name), buf: entry.getData() as Buffer })
    } else if (lower.endsWith('.zip')) {
      walkZip(new AdmZip(entry.getData()), depth + 1, out, budget)
    }
  }
}

/** Import one or more lead ZIP files into the leads table (dedup by phone). */
export async function importZips(zipPaths: string[]): Promise<ImportResult> {
  let inTransaction = false
  const result: ImportResult = {
    ok: false,
    totalRows: 0,
    imported: 0,
    duplicates: 0,
    invalidPhones: 0,
    files: []
  }
  try {
    if (!Array.isArray(zipPaths) || zipPaths.length === 0 || zipPaths.length > 20) throw new Error('Select between 1 and 20 lead archives.')
    // Pre-load already-imported phones so re-imports stay deduplicated.
    const seen: SeenMap = new Map()
    const existing = all<{ id: number; phone_e164: string }>(
      'SELECT id, phone_e164 FROM leads WHERE phone_e164 IS NOT NULL'
    )
    for (const row of existing) seen.set(row.phone_e164, Number(row.id))

    // Flatten every workbook contained in the selected ZIPs (incl. nested zips).
    const workbooks: Array<{ name: string; buf: Buffer }> = []
    const budget = { bytes: 0, entries: 0 }
    for (const zp of zipPaths) {
      if (fs.statSync(zp).size > MAX_BYTES) throw new Error('An archive is too large. Split it into smaller files.')
      walkZip(new AdmZip(zp), 0, workbooks, budget)
    }
    if (!workbooks.length) throw new Error('No .xlsx workbooks were found in the selected archives.')
    run('BEGIN')
    inTransaction = true
    for (const wbk of workbooks) {
      await processWorkbook(wbk.buf, wbk.name, seen, result)
    }

    run('COMMIT')
    inTransaction = false
    persistNow()
    result.ok = true
    return result
  } catch (err) {
    if (inTransaction) run('ROLLBACK')
    result.imported = 0
    result.duplicates = 0
    result.files = []
    result.error = err instanceof Error ? err.message : String(err)
    return result
  }
}
