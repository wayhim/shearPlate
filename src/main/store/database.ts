import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { open, rename, unlink } from 'fs/promises'

let db: SqlJsDatabase
let dbPath: string
let saveTimer: ReturnType<typeof setTimeout> | null = null
let isDirty = false
let isSaving = false
let pendingSave = false
let activeSavePromise: Promise<void> | null = null

const SAVE_DEBOUNCE_MS = 160
const SAVE_CHUNK_SIZE_BYTES = 512 * 1024

function resolveSqlWasmPath(): string {
  const candidates = [
    join(process.resourcesPath, 'resources', 'sql-wasm.wasm'),
    join(process.resourcesPath, 'sql-wasm.wasm'),
    join(app.getAppPath(), 'resources', 'sql-wasm.wasm'),
    join(__dirname, '../../resources/sql-wasm.wasm')
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return join(__dirname, '../../resources/sql-wasm.wasm')
}

function hasColumn(table: string, column: string): boolean {
  const result = db.exec(`PRAGMA table_info(${table})`)
  if (!result.length) return false
  return result[0].values.some((row) => row[1] === column)
}

function migrateClipboardTable(): void {
  if (!hasColumn('clipboard_items', 'image_data')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN image_data TEXT`)
  }
  if (!hasColumn('clipboard_items', 'image_preview_data')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN image_preview_data TEXT`)
  }
  if (!hasColumn('clipboard_items', 'image_path')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN image_path TEXT`)
  }
  if (!hasColumn('clipboard_items', 'image_preview_path')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN image_preview_path TEXT`)
  }
  if (!hasColumn('clipboard_items', 'image_width')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN image_width INTEGER`)
  }
  if (!hasColumn('clipboard_items', 'image_height')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN image_height INTEGER`)
  }
  if (!hasColumn('clipboard_items', 'source_app')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN source_app TEXT DEFAULT 'Unknown'`)
  }
  if (!hasColumn('clipboard_items', 'content_hash')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN content_hash TEXT DEFAULT ''`)
  }
  if (!hasColumn('clipboard_items', 'is_snippet')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN is_snippet INTEGER DEFAULT 0`)
  }
  if (!hasColumn('clipboard_items', 'snippet_keyword')) {
    db.run(`ALTER TABLE clipboard_items ADD COLUMN snippet_keyword TEXT`)
  }
  db.run(`UPDATE clipboard_items SET source_app = 'Unknown' WHERE source_app IS NULL OR source_app = ''`)
  if (hasColumn('clipboard_items', 'source_app_icon')) {
    db.run(`UPDATE clipboard_items SET source_app_icon = NULL`)
  }
  db.run(`UPDATE clipboard_items SET image_width = NULL WHERE image_width = 0`)
  db.run(`UPDATE clipboard_items SET image_height = NULL WHERE image_height = 0`)
  db.run(`UPDATE clipboard_items SET content_hash = '' WHERE content_hash IS NULL`)
  db.run(`UPDATE clipboard_items SET is_snippet = 0 WHERE is_snippet IS NULL`)
}

export async function initDatabase(): Promise<void> {
  const wasmPath = resolveSqlWasmPath()
  const SQL = await initSqlJs({
    locateFile: () => wasmPath
  })
  dbPath = join(app.getPath('userData'), 'shearplate.db')

  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath)
    db = new SQL.Database(buf)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS clipboard_items (
      id            TEXT PRIMARY KEY,
      content_type  TEXT NOT NULL,
      text_content  TEXT,
      image_data    TEXT,
      image_preview_data TEXT,
      image_path    TEXT,
      image_preview_path TEXT,
      image_width   INTEGER,
      image_height  INTEGER,
      file_path     TEXT,
      file_size     INTEGER,
      source_device TEXT NOT NULL,
      source_app    TEXT NOT NULL DEFAULT 'Unknown',
      content_hash  TEXT NOT NULL DEFAULT '',
      is_starred    INTEGER DEFAULT 0,
      is_snippet    INTEGER DEFAULT 0,
      snippet_keyword TEXT,
      created_at    INTEGER NOT NULL
    )
  `)
  migrateClipboardTable()
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_created ON clipboard_items(created_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_type ON clipboard_items(content_type)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_starred ON clipboard_items(is_starred)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_snippet ON clipboard_items(is_snippet)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_snippet_keyword ON clipboard_items(snippet_keyword)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_hash ON clipboard_items(content_hash)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id            TEXT PRIMARY KEY,
      hostname      TEXT NOT NULL,
      ip_address    TEXT NOT NULL,
      port          INTEGER NOT NULL,
      paired_at     INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  await saveDbNow(true)
}

export function getDb(): SqlJsDatabase {
  return db
}

async function writeDbChunked(data: Uint8Array): Promise<void> {
  const tmpPath = `${dbPath}.tmp`
  const handle = await open(tmpPath, 'w')

  try {
    for (let offset = 0; offset < data.length; offset += SAVE_CHUNK_SIZE_BYTES) {
      const chunk = data.subarray(offset, Math.min(data.length, offset + SAVE_CHUNK_SIZE_BYTES))
      await handle.write(chunk, 0, chunk.length, offset)
    }
    await handle.sync()
  } finally {
    await handle.close()
  }

  await rename(tmpPath, dbPath)
}

function flushDb(force = false): Promise<void> {
  if (!db || !dbPath || (!isDirty && !force)) {
    return Promise.resolve()
  }

  if (isSaving) {
    pendingSave = pendingSave || force || isDirty
    return activeSavePromise ?? Promise.resolve()
  }

  isSaving = true
  pendingSave = pendingSave || force || isDirty
  activeSavePromise = (async () => {
    while (pendingSave || force || isDirty) {
      pendingSave = false
      force = false
      if (!isDirty) {
        continue
      }

      isDirty = false
      const data = db.export()
      try {
        await writeDbChunked(data)
      } catch (error) {
        isDirty = true
        try {
          await unlink(`${dbPath}.tmp`)
        } catch {
          // Ignore temp file cleanup failures.
        }
        throw error
      }
    }
  })()
    .catch((error) => {
      console.error('[ShearPlate] Failed to persist database:', error)
      throw error
    })
    .finally(() => {
      isSaving = false
      activeSavePromise = null

      if (pendingSave || isDirty) {
        void flushDb().catch(() => undefined)
      }
    })

  return activeSavePromise
}

export function saveDb(): void {
  if (!db || !dbPath) return

  isDirty = true
  if (saveTimer) return

  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushDb().catch(() => undefined)
  }, SAVE_DEBOUNCE_MS)
}

export async function saveDbNow(force = false): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  if (force) {
    isDirty = true
  }

  await flushDb(force)
}
