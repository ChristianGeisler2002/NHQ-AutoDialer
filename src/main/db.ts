import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import initSqlJs, { Database, SqlJsStatic } from 'sql.js'

/**
 * Lightweight SQLite layer backed by sql.js (SQLite compiled to WebAssembly).
 *
 * We use sql.js instead of a native module (better-sqlite3) so the packaged
 * app needs no native compilation / node-gyp / MSVC toolchain — this makes the
 * Windows .exe build reliable. The whole database lives in memory and is
 * flushed to a real `.sqlite` file on disk after every logical write.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  phone_original TEXT NOT NULL DEFAULT '',
  phone_e164 TEXT,
  website TEXT NOT NULL DEFAULT '',
  location_raw TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state_province TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  estimated_revenue TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  source_sheet TEXT NOT NULL DEFAULT '',
  source_row INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  dup_count INTEGER NOT NULL DEFAULT 0,
  dup_sources TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  call_started_at TEXT,
  call_ended_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  call_provider TEXT NOT NULL DEFAULT '',
  provider_call_id TEXT,
  call_status TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  state_province TEXT NOT NULL DEFAULT '',
  decision_maker TEXT NOT NULL DEFAULT '',
  interest TEXT NOT NULL DEFAULT '',
  pain_point TEXT NOT NULL DEFAULT '',
  follow_up_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls(lead_id);

CREATE TABLE IF NOT EXISTS do_not_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_e164 TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dnc_phone ON do_not_call(phone_e164);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let dbPath = ''
let persistTimer: NodeJS.Timeout | null = null

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** Locate the sql.js wasm binary in dev and in the packaged app. */
function resolveWasmBinary(): ArrayBuffer {
  const candidates = [
    path.join(process.resourcesPath || '', 'sql-wasm.wasm'),
    path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ]
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return toArrayBuffer(fs.readFileSync(c))
    } catch {
      /* keep looking */
    }
  }
  // Last resort: let the bundler resolve it relative to sql.js.
  const resolved = require.resolve('sql.js/dist/sql-wasm.wasm')
  return toArrayBuffer(fs.readFileSync(resolved))
}

export async function initDatabase(): Promise<void> {
  if (db) return
  const wasmBinary = resolveWasmBinary()
  SQL = await initSqlJs({ wasmBinary })

  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  dbPath = path.join(userData, 'nhq-autodialer.sqlite')

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }
  db.run(SCHEMA)
  const columns = all<{ name: string }>('PRAGMA table_info(calls)')
  if (!columns.some(column => column.name === 'submission_id')) db.run('ALTER TABLE calls ADD COLUMN submission_id TEXT')
  if (!columns.some(column => column.name === 'exported_row')) db.run('ALTER TABLE calls ADD COLUMN exported_row INTEGER')
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS calls_submission ON calls(submission_id) WHERE submission_id IS NOT NULL')
  persistNow()
}

function requireDb(): Database {
  if (!db) throw new Error('Database not initialised')
  return db
}

/** Flush the in-memory database to disk atomically. */
export function persistNow(): void {
  if (!db) return
  const data = db.export()
  const tmp = `${dbPath}.tmp`
  fs.writeFileSync(tmp, Buffer.from(data))
  fs.renameSync(tmp, dbPath)
}

/** Debounced persistence for hot paths (bulk imports flush once at the end). */
export function persistSoon(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistNow()
  }, 250)
}

type Params = Record<string, unknown> | unknown[] | undefined

/** Run a statement that does not return rows. */
export function run(sql: string, params?: Params): void {
  requireDb().run(sql, params as never)
}

/** Return all rows as plain objects. */
export function all<T = Record<string, unknown>>(sql: string, params?: Params): T[] {
  const stmt = requireDb().prepare(sql)
  try {
    if (params) stmt.bind(params as never)
    const out: T[] = []
    while (stmt.step()) out.push(stmt.getAsObject() as T)
    return out
  } finally {
    stmt.free()
  }
}

/** Return the first row, or undefined. */
export function get<T = Record<string, unknown>>(sql: string, params?: Params): T | undefined {
  const rows = all<T>(sql, params)
  return rows[0]
}

/** Insert helper returning the new rowid. */
export function insert(sql: string, params?: Params): number {
  run(sql, params)
  const row = get<{ id: number }>('SELECT last_insert_rowid() AS id')
  return row ? Number(row.id) : 0
}

export function getDbPath(): string {
  return dbPath
}
