import { app, nativeImage, protocol, type NativeImage } from 'electron'
import { createHash } from 'crypto'
import { constants as fsConstants } from 'fs'
import { access, mkdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ClipboardItem } from '../../shared/types'

const IMAGE_STORE_DIR = 'clipboard-images'
const ORIGINAL_DIR = 'original'
const PREVIEW_DIR = 'preview'
const PREVIEW_MAX_DIMENSION = 560
const IMAGE_PREVIEW_URL_CACHE_LIMIT = 120
const IMAGE_PROTOCOL_SCHEME = 'shearplate-image'
const IMAGE_FILE_PATH_PATTERN = /\.(png|jpe?g|gif|webp|heic|svg|bmp|tiff?|ico|avif)$/i

protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

let ensureDirsPromise: Promise<void> | null = null
let imageProtocolRegistered = false
const imagePreviewUrlCache = new Map<string, string | null>()

export type StoredClipboardImage = {
  contentHash: string
  imagePath: string
  imagePreviewPath: string
  width: number
  height: number
  fileSize: number
}

function getImageStorePaths(): { rootDir: string; originalDir: string; previewDir: string } {
  const rootDir = join(app.getPath('userData'), IMAGE_STORE_DIR)
  return {
    rootDir,
    originalDir: join(rootDir, ORIGINAL_DIR),
    previewDir: join(rootDir, PREVIEW_DIR)
  }
}

function normalizeProtocolPathname(pathname: string): string {
  const raw = pathname.startsWith('/') ? pathname.slice(1) : pathname
  return decodeURIComponent(raw)
}

function isPathWithinImageStore(filePath: string): boolean {
  const { rootDir } = getImageStorePaths()
  const normalizedRoot = `${rootDir}/`
  return filePath.startsWith(normalizedRoot)
}

function buildProtocolImageUrl(filePath: string, mtimeToken: number): string {
  const encodedPath = encodeURIComponent(filePath)
  return `${IMAGE_PROTOCOL_SCHEME}://local/${encodedPath}?v=${mtimeToken}`
}

export function registerClipboardImageProtocol(): void {
  if (imageProtocolRegistered) {
    return
  }

  protocol.registerFileProtocol(IMAGE_PROTOCOL_SCHEME, (request, callback) => {
    try {
      const requestUrl = new URL(request.url)
      const decodedPath = normalizeProtocolPathname(requestUrl.pathname)
      if (!decodedPath || !isPathWithinImageStore(decodedPath) || !IMAGE_FILE_PATH_PATTERN.test(decodedPath)) {
        callback({ error: -6 })
        return
      }

      callback(decodedPath)
    } catch {
      callback({ error: -2 })
    }
  })

  imageProtocolRegistered = true
}

export function ensureClipboardImageStoreDirs(): Promise<void> {
  if (ensureDirsPromise) {
    return ensureDirsPromise
  }

  const { originalDir, previewDir } = getImageStorePaths()
  ensureDirsPromise = Promise.all([
    mkdir(originalDir, { recursive: true }),
    mkdir(previewDir, { recursive: true })
  ])
    .then(() => undefined)
    .catch((error) => {
      ensureDirsPromise = null
      throw error
    })

  return ensureDirsPromise
}

function rememberImagePreviewUrl(cacheKey: string, value: string | null): void {
  if (imagePreviewUrlCache.has(cacheKey)) {
    imagePreviewUrlCache.delete(cacheKey)
  }
  imagePreviewUrlCache.set(cacheKey, value)

  if (imagePreviewUrlCache.size <= IMAGE_PREVIEW_URL_CACHE_LIMIT) return
  const oldestKey = imagePreviewUrlCache.keys().next().value
  if (oldestKey) {
    imagePreviewUrlCache.delete(oldestKey)
  }
}

function hashImageBuffer(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex')
}

async function writeFileIfMissing(targetPath: string, buffer: Buffer): Promise<void> {
  try {
    await access(targetPath, fsConstants.F_OK)
    return
  } catch {
    // Continue and write the file when it does not exist.
  }

  await writeFile(targetPath, buffer)
}

function resizeForPreview(image: NativeImage): NativeImage {
  const { width, height } = image.getSize()
  if (width <= PREVIEW_MAX_DIMENSION && height <= PREVIEW_MAX_DIMENSION) {
    return image
  }

  const scale = Math.min(PREVIEW_MAX_DIMENSION / width, PREVIEW_MAX_DIMENSION / height)
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  })
}

export async function persistClipboardImage(image: NativeImage): Promise<StoredClipboardImage | null> {
  if (image.isEmpty()) {
    return null
  }

  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) {
    return null
  }

  const originalBuffer = image.toPNG()
  if (!originalBuffer.length) {
    return null
  }

  const contentHash = hashImageBuffer(originalBuffer)
  await ensureClipboardImageStoreDirs()
  const { originalDir, previewDir } = getImageStorePaths()
  const imagePath = join(originalDir, `${contentHash}.png`)
  const imagePreviewPath = join(previewDir, `${contentHash}.png`)
  const previewBuffer = resizeForPreview(image).toPNG()

  await Promise.all([
    writeFileIfMissing(imagePath, originalBuffer),
    writeFileIfMissing(imagePreviewPath, previewBuffer)
  ])

  return {
    contentHash,
    imagePath,
    imagePreviewPath,
    width,
    height,
    fileSize: originalBuffer.length
  }
}

export async function resolveImagePreviewUrlFromPath(imagePath: string | null, mode: 'fast' | 'full'): Promise<string | null> {
  if (!imagePath) {
    return null
  }

  let fileSignature: string
  let mtimeToken = 0
  try {
    const meta = await stat(imagePath)
    if (!meta.isFile() || meta.size <= 0) {
      return null
    }
    fileSignature = `${meta.size}:${meta.mtimeMs}`
    mtimeToken = Math.max(0, Math.trunc(meta.mtimeMs))
  } catch {
    return null
  }

  const cacheKey = `${mode}:${imagePath}:${fileSignature}`
  const cached = imagePreviewUrlCache.get(cacheKey)
  if (cached !== undefined) {
    rememberImagePreviewUrl(cacheKey, cached)
    return cached
  }

  const previewUrl = buildProtocolImageUrl(imagePath, mtimeToken)
  rememberImagePreviewUrl(cacheKey, previewUrl)
  return previewUrl
}

export async function getStoredClipboardImagePreview(
  item: ClipboardItem,
  mode: 'fast' | 'full' = 'fast'
): Promise<string | null> {
  if (item.contentType !== 'image') {
    return null
  }

  const imagePath = mode === 'full'
    ? item.imagePath ?? item.imagePreviewPath
    : item.imagePreviewPath ?? item.imagePath

  return resolveImagePreviewUrlFromPath(imagePath, mode)
}

export function getStoredClipboardNativeImage(item: ClipboardItem): NativeImage | null {
  if (item.contentType !== 'image') {
    return null
  }

  const candidates = [item.imagePath, item.imagePreviewPath]
  for (const imagePath of candidates) {
    if (!imagePath) continue
    try {
      const image = nativeImage.createFromPath(imagePath)
      if (!image.isEmpty()) {
        return image
      }
    } catch {
      // Continue probing.
    }
  }

  return null
}

function decodeImageFromDataUrl(dataUrl: string): NativeImage | null {
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) {
      return null
    }
    return image
  } catch {
    return null
  }
}

export async function materializeClipboardImagePaths(item: ClipboardItem): Promise<StoredClipboardImage | null> {
  if (item.contentType !== 'image') {
    return null
  }

  if (item.imagePath || item.imagePreviewPath) {
    return null
  }

  const sourceDataUrl = item.imageData ?? item.imagePreviewData
  if (!sourceDataUrl) {
    return null
  }

  const image = decodeImageFromDataUrl(sourceDataUrl)
  if (!image) {
    return null
  }

  return persistClipboardImage(image)
}
