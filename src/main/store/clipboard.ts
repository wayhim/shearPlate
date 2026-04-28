import { randomUUID } from 'crypto'
import { getDb, saveDb } from './database'
import type { ClipboardItem, ContentType } from '../../shared/types'
import { getAppSettings } from './settings'

interface InsertInput {
  contentType: ContentType
  textContent: string | null
  imageData: string | null
  imagePreviewData: string | null
  imagePath: string | null
  imagePreviewPath: string | null
  imageWidth: number | null
  imageHeight: number | null
  filePath: string | null
  fileSize: number | null
  sourceDevice: string
  sourceApp: string
  contentHash: string
}

const SELECT_COLUMNS = `
  id,
  content_type,
  text_content,
  image_data,
  image_preview_data,
  image_path,
  image_preview_path,
  image_width,
  image_height,
  file_path,
  file_size,
  source_device,
  source_app,
  content_hash,
  is_starred,
  is_snippet,
  snippet_keyword,
  created_at
`

const LIST_SELECT_COLUMNS = `
  id,
  content_type,
  text_content,
  NULL AS image_data,
  NULL AS image_preview_data,
  image_path,
  image_preview_path,
  image_width,
  image_height,
  file_path,
  file_size,
  source_device,
  source_app,
  content_hash,
  is_starred,
  is_snippet,
  snippet_keyword,
  created_at
`

function rowToItem(row: any[]): ClipboardItem {
  return {
    id: row[0] as string,
    contentType: row[1] as ContentType,
    textContent: row[2] as string | null,
    imageData: row[3] as string | null,
    imagePreviewData: row[4] as string | null,
    imagePath: row[5] as string | null,
    imagePreviewPath: row[6] as string | null,
    imageWidth: row[7] as number | null,
    imageHeight: row[8] as number | null,
    filePath: row[9] as string | null,
    fileSize: row[10] as number | null,
    sourceDevice: row[11] as string,
    sourceApp: (row[12] as string) || 'Unknown',
    contentHash: (row[13] as string) || '',
    isStarred: (row[14] as number) === 1,
    isSnippet: (row[15] as number) === 1,
    snippetKeyword: (row[16] as string | null) || null,
    createdAt: row[17] as number
  }
}

export function stripClipboardItemPayload(item: ClipboardItem): ClipboardItem {
  if (item.contentType !== 'image') {
    return item
  }

  return {
    ...item,
    imageData: null,
    imagePreviewData: null
  }
}

export function insertClipboardItem(input: InsertInput): ClipboardItem {
  const now = Date.now()
  const existing = getDb().exec(
    `SELECT ${SELECT_COLUMNS} FROM clipboard_items WHERE content_hash = ? ORDER BY created_at DESC LIMIT 1`,
    [input.contentHash]
  )

  if (existing.length && existing[0].values.length) {
    const existingItem = rowToItem(existing[0].values[0])
    getDb().run(
      `UPDATE clipboard_items
       SET content_type = ?, text_content = ?, image_data = ?, image_preview_data = ?, image_path = ?, image_preview_path = ?, image_width = ?, image_height = ?, file_path = ?, file_size = ?, source_device = ?, source_app = ?, content_hash = ?, created_at = ?
       WHERE id = ?`,
      [
        input.contentType,
        input.textContent,
        input.imageData,
        input.imagePreviewData,
        input.imagePath,
        input.imagePreviewPath,
        input.imageWidth,
        input.imageHeight,
        input.filePath,
        input.fileSize,
        input.sourceDevice,
        input.sourceApp,
        input.contentHash,
        now,
        existingItem.id
      ]
    )
    saveDb()
    applyClipboardRetentionPolicy()

    return {
      ...existingItem,
      contentType: input.contentType,
      textContent: input.textContent,
      imageData: input.imageData,
      imagePreviewData: input.imagePreviewData,
      imagePath: input.imagePath,
      imagePreviewPath: input.imagePreviewPath,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
      filePath: input.filePath,
      fileSize: input.fileSize,
      sourceDevice: input.sourceDevice,
      sourceApp: input.sourceApp,
      contentHash: input.contentHash,
      createdAt: now
    }
  }

  const id = randomUUID()
  getDb().run(
    `INSERT INTO clipboard_items (
      id, content_type, text_content, image_data, image_preview_data, image_path, image_preview_path, image_width, image_height, file_path, file_size, source_device, source_app, content_hash, is_starred, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      input.contentType,
      input.textContent,
      input.imageData,
      input.imagePreviewData,
      input.imagePath,
      input.imagePreviewPath,
      input.imageWidth,
      input.imageHeight,
      input.filePath,
      input.fileSize,
      input.sourceDevice,
      input.sourceApp,
      input.contentHash,
      now
    ]
  )
  saveDb()
  applyClipboardRetentionPolicy()

  return {
    id,
    contentType: input.contentType,
    textContent: input.textContent,
    imageData: input.imageData,
    imagePreviewData: input.imagePreviewData,
    imagePath: input.imagePath,
    imagePreviewPath: input.imagePreviewPath,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    filePath: input.filePath,
    fileSize: input.fileSize,
    sourceDevice: input.sourceDevice,
    sourceApp: input.sourceApp,
    contentHash: input.contentHash,
    isStarred: false,
    isSnippet: false,
    snippetKeyword: null,
    createdAt: now
  }
}

export function applyClipboardRetentionPolicy(): void {
  const settings = getAppSettings()
  const maxHistory = Math.max(1, Math.floor(settings.maxHistory || 1))
  const retentionDays = Math.max(1, Math.floor(settings.historyRetentionDays || 1))
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000

  getDb().run(`DELETE FROM clipboard_items WHERE is_snippet = 0 AND created_at < ?`, [cutoff])
  let hasChanges = getDb().getRowsModified() > 0

  getDb().run(
    `DELETE FROM clipboard_items
     WHERE id IN (
       SELECT id FROM clipboard_items
       WHERE is_snippet = 0
       ORDER BY created_at DESC
       LIMIT -1 OFFSET ?
    )`,
    [maxHistory]
  )
  hasChanges = getDb().getRowsModified() > 0 || hasChanges

  if (hasChanges) {
    saveDb()
  }
}

export function getClipboardItems(limit = 100, offset = 0): ClipboardItem[] {
  const results = getDb().exec(
    `SELECT ${LIST_SELECT_COLUMNS} FROM clipboard_items ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  )
  if (!results.length) return []
  return results[0].values.map(rowToItem)
}

export function searchClipboardItems(query: string, limit = 50): ClipboardItem[] {
  const exactQuery = query.trim().toLowerCase()
  const fuzzyQuery = `%${query}%`
  const results = getDb().exec(
    `SELECT ${LIST_SELECT_COLUMNS}
     FROM clipboard_items
     WHERE text_content LIKE ? OR source_app LIKE ? OR COALESCE(snippet_keyword, '') LIKE ?
     ORDER BY
       CASE
         WHEN is_snippet = 1 AND LOWER(COALESCE(snippet_keyword, '')) = ? THEN 0
         WHEN is_snippet = 1 AND LOWER(COALESCE(snippet_keyword, '')) LIKE ? THEN 1
         WHEN is_snippet = 1 AND LOWER(COALESCE(snippet_keyword, '')) LIKE ? THEN 2
         WHEN is_snippet = 1 THEN 3
         ELSE 4
       END ASC,
       created_at DESC
     LIMIT ?`,
    [fuzzyQuery, fuzzyQuery, fuzzyQuery, exactQuery, `${exactQuery}%`, `%${exactQuery}%`, limit]
  )
  if (!results.length) return []
  return results[0].values.map(rowToItem)
}

export function getClipboardItem(id: string): ClipboardItem | null {
  const results = getDb().exec(
    `SELECT ${SELECT_COLUMNS} FROM clipboard_items WHERE id = ? LIMIT 1`,
    [id]
  )

  if (!results.length || !results[0].values.length) return null
  return rowToItem(results[0].values[0])
}

export function updateClipboardImageStorage(
  id: string,
  input: {
    imagePath: string | null
    imagePreviewPath: string | null
    imageWidth: number | null
    imageHeight: number | null
    fileSize: number | null
    contentHash: string
  }
): void {
  getDb().run(
    `UPDATE clipboard_items
     SET image_path = ?,
         image_preview_path = ?,
         image_data = NULL,
         image_preview_data = NULL,
         image_width = ?,
         image_height = ?,
         file_size = ?,
         content_hash = ?
     WHERE id = ?`,
    [
      input.imagePath,
      input.imagePreviewPath,
      input.imageWidth,
      input.imageHeight,
      input.fileSize,
      input.contentHash,
      id
    ]
  )
  if (getDb().getRowsModified() > 0) {
    saveDb()
  }
}

export function updateSnippet(id: string, nextSnippetState: boolean, keyword: string | null): ClipboardItem | null {
  const existingResults = getDb().exec(
    `SELECT ${SELECT_COLUMNS} FROM clipboard_items WHERE id = ? LIMIT 1`,
    [id]
  )

  if (!existingResults.length || !existingResults[0].values.length) return null

  const existingItem = rowToItem(existingResults[0].values[0])
  const normalizedKeyword = nextSnippetState ? keyword?.trim() || null : null
  const nextCreatedAt = nextSnippetState && !existingItem.isSnippet ? Date.now() : existingItem.createdAt
  getDb().run(
    `UPDATE clipboard_items SET is_snippet = ?, snippet_keyword = ?, created_at = ? WHERE id = ?`,
    [nextSnippetState ? 1 : 0, normalizedKeyword, nextCreatedAt, id]
  )

  if (nextSnippetState) {
    saveDb()
  } else {
    applyClipboardRetentionPolicy()
  }

  const results = getDb().exec(
    `SELECT ${SELECT_COLUMNS} FROM clipboard_items WHERE id = ? LIMIT 1`,
    [id]
  )

  if (!results.length || !results[0].values.length) return null
  return rowToItem(results[0].values[0])
}

export function createCustomSnippet(keyword: string, content: string): ClipboardItem | null {
  const normalizedKeyword = keyword.trim()
  const normalizedContent = content.replace(/\r\n/g, '\n')

  if (!normalizedKeyword || !normalizedContent.trim()) {
    return null
  }

  const now = Date.now()
  const id = randomUUID()
  const contentHash = `snippet:${id}`

  getDb().run(
    `INSERT INTO clipboard_items (
      id,
      content_type,
      text_content,
      image_data,
      image_preview_data,
      image_path,
      image_preview_path,
      image_width,
      image_height,
      file_path,
      file_size,
      source_device,
      source_app,
      content_hash,
      is_starred,
      is_snippet,
      snippet_keyword,
      created_at
    ) VALUES (?, 'text', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 0, 1, ?, ?)`,
    [
      id,
      normalizedContent,
      'local',
      'Snippet',
      contentHash,
      normalizedKeyword,
      now
    ]
  )

  saveDb()

  return {
    id,
    contentType: 'text',
    textContent: normalizedContent,
    imageData: null,
    imagePreviewData: null,
    imagePath: null,
    imagePreviewPath: null,
    imageWidth: null,
    imageHeight: null,
    filePath: null,
    fileSize: null,
    sourceDevice: 'local',
    sourceApp: 'Snippet',
    contentHash,
    isStarred: false,
    isSnippet: true,
    snippetKeyword: normalizedKeyword,
    createdAt: now
  }
}

export function getSnippetItems(): ClipboardItem[] {
  const results = getDb().exec(
    `SELECT ${LIST_SELECT_COLUMNS}
     FROM clipboard_items
     WHERE is_snippet = 1
     ORDER BY created_at DESC`
  )
  if (!results.length) return []
  return results[0].values.map(rowToItem)
}

export function updateStarState(id: string): ClipboardItem | null {
  getDb().run(
    `UPDATE clipboard_items SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?`,
    [id]
  )

  const results = getDb().exec(
    `SELECT ${SELECT_COLUMNS} FROM clipboard_items WHERE id = ? LIMIT 1`,
    [id]
  )
  saveDb()

  if (!results.length || !results[0].values.length) return null
  return rowToItem(results[0].values[0])
}

export function toggleStar(id: string): boolean {
  return Boolean(updateStarState(id))
}

export function touchClipboardItem(id: string): ClipboardItem | null {
  const results = getDb().exec(
    `SELECT ${SELECT_COLUMNS} FROM clipboard_items WHERE id = ? LIMIT 1`,
    [id]
  )
  if (!results.length || !results[0].values.length) return null

  const item = rowToItem(results[0].values[0])
  if (item.isSnippet) {
    return null
  }

  const now = Date.now()
  getDb().run(`UPDATE clipboard_items SET created_at = ? WHERE id = ?`, [now, id])
  saveDb()

  return {
    ...item,
    createdAt: now
  }
}

export function deleteClipboardItem(id: string): boolean {
  getDb().run(`DELETE FROM clipboard_items WHERE id = ?`, [id])
  saveDb()
  return true
}

export function getStarredItems(): ClipboardItem[] {
  const results = getDb().exec(
    `SELECT ${LIST_SELECT_COLUMNS} FROM clipboard_items WHERE is_starred = 1 ORDER BY created_at DESC`
  )
  if (!results.length) return []
  return results[0].values.map(rowToItem)
}

export function dedupeClipboardItems(): number {
  const results = getDb().exec(
    `SELECT id, content_hash, is_snippet, created_at
     FROM clipboard_items
     WHERE content_hash IS NOT NULL AND content_hash != ''
     ORDER BY content_hash ASC, is_snippet DESC, created_at DESC`
  )

  if (!results.length || !results[0].values.length) return 0

  const seen = new Set<string>()
  const toDelete: string[] = []

  for (const row of results[0].values) {
    const id = row[0] as string
    const hash = row[1] as string
    if (!hash) continue

    if (seen.has(hash)) {
      toDelete.push(id)
    } else {
      seen.add(hash)
    }
  }

  for (const id of toDelete) {
    getDb().run(`DELETE FROM clipboard_items WHERE id = ?`, [id])
  }

  if (toDelete.length > 0) {
    saveDb()
  }

  return toDelete.length
}
