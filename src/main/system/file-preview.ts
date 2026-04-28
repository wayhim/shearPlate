import { execFile } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { extname, isAbsolute, join } from 'path'
import { fileURLToPath } from 'url'

const QUICK_LOOK_SIZE = 1024
const PREVIEW_CACHE_LIMIT = 160
const previewCache = new Map<string, Promise<string | null>>()

function rememberPreviewRequest(cacheKey: string, request: Promise<string | null>): Promise<string | null> {
  if (previewCache.has(cacheKey)) {
    previewCache.delete(cacheKey)
  }
  previewCache.set(cacheKey, request)

  if (previewCache.size <= PREVIEW_CACHE_LIMIT) {
    return request
  }

  const oldestKey = previewCache.keys().next().value
  if (oldestKey !== undefined) {
    previewCache.delete(oldestKey)
  }

  return request
}

function getCachedPreviewRequest(cacheKey: string): Promise<string | null> | undefined {
  const cached = previewCache.get(cacheKey)
  if (!cached) {
    return undefined
  }

  rememberPreviewRequest(cacheKey, cached)
  return cached
}

function expandHomePath(filePath: string): string {
  if (filePath === '~') {
    return homedir()
  }
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return `${homedir()}${filePath.slice(1)}`
  }
  return filePath
}

function normalizeFilePreviewPath(rawPath: string): string | null {
  const trimmed = rawPath.replace(/\0/g, '').trim()
  if (!trimmed) return null
  const normalizedInput = trimmed.match(/^(['"])(.*)\1$/)?.[2] ?? trimmed

  const candidates = new Set<string>()
  const pushCandidate = (candidate: string): void => {
    const next = candidate.replace(/\0/g, '').trim()
    if (next) {
      candidates.add(next)
    }
  }

  pushCandidate(normalizedInput)
  pushCandidate(expandHomePath(normalizedInput))

  if (/^file:\/\//i.test(normalizedInput)) {
    try {
      const fromUrl = fileURLToPath(normalizedInput)
      pushCandidate(fromUrl)
      pushCandidate(expandHomePath(fromUrl))
    } catch {
      // Keep probing other candidates.
    }
  }

  const encodedCandidates = Array.from(candidates).filter((candidate) => candidate.includes('%'))
  for (const candidate of encodedCandidates) {
    try {
      const decoded = decodeURIComponent(candidate)
      pushCandidate(decoded)
      pushCandidate(expandHomePath(decoded))
    } catch {
      // Keep probing other candidates.
    }
  }

  for (const candidate of candidates) {
    if (isAbsolute(candidate)) {
      return candidate
    }
  }

  return null
}

function isImageFilePath(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|heic|svg|bmp|tiff?|ico|avif)$/i.test(filePath)
}

function readImageFileAsDataUrl(filePath: string): string | null {
  if (!existsSync(filePath) || !isImageFilePath(filePath)) return null

  try {
    const ext = extname(filePath).toLowerCase()
    const mimeType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.svg'
          ? 'image/svg+xml'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.bmp'
                ? 'image/bmp'
                : ext === '.ico'
                  ? 'image/x-icon'
                  : ext === '.avif'
                    ? 'image/avif'
                    : ext === '.heic'
                      ? 'image/heic'
                      : ext === '.tif' || ext === '.tiff'
                        ? 'image/tiff'
                        : 'image/png'
    return `data:${mimeType};base64,${readFileSync(filePath).toString('base64')}`
  } catch {
    return null
  }
}

function getPreviewCacheKey(filePath: string): string {
  const stats = statSync(filePath)
  return `${filePath}:${stats.size}:${stats.mtimeMs}`
}

function runQuickLookThumbnail(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const outputDir = mkdtempSync(join(tmpdir(), 'shearplate-ql-'))

    execFile(
      'qlmanage',
      ['-t', '-s', String(QUICK_LOOK_SIZE), '-o', outputDir, filePath],
      { timeout: 8000 },
      () => {
        try {
          const thumbnailPath = readdirSync(outputDir)
            .filter((entry) => /\.(png|jpe?g)$/i.test(entry))
            .map((entry) => join(outputDir, entry))[0]

          if (!thumbnailPath || !existsSync(thumbnailPath)) {
            resolve(readImageFileAsDataUrl(filePath))
            return
          }

          const extension = extname(thumbnailPath).toLowerCase()
          const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png'
          const dataUrl = `data:${mimeType};base64,${readFileSync(thumbnailPath).toString('base64')}`
          resolve(dataUrl)
        } catch {
          resolve(readImageFileAsDataUrl(filePath))
        } finally {
          rmSync(outputDir, { recursive: true, force: true })
        }
      }
    )
  })
}

export async function getFilePreviewData(filePath: string): Promise<string | null> {
  const normalizedPath = normalizeFilePreviewPath(filePath)
  if (!normalizedPath) return null

  if (process.platform !== 'darwin') {
    return readImageFileAsDataUrl(normalizedPath)
  }
  if (!existsSync(normalizedPath)) return null

  let cacheKey: string
  try {
    cacheKey = getPreviewCacheKey(normalizedPath)
  } catch {
    return readImageFileAsDataUrl(normalizedPath)
  }

  const cached = getCachedPreviewRequest(cacheKey)
  if (cached) {
    return cached
  }

  const request = runQuickLookThumbnail(normalizedPath).then((result) => {
    if (!result) {
      previewCache.delete(cacheKey)
    }
    return result
  }).catch(() => {
    previewCache.delete(cacheKey)
    return readImageFileAsDataUrl(normalizedPath)
  })

  return rememberPreviewRequest(cacheKey, request)
}
