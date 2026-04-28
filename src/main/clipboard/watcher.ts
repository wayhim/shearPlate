import { clipboard } from 'electron'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, statSync } from 'fs'
import { isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { insertClipboardItem, stripClipboardItemPayload } from '../store/clipboard'
import { getMainWindow } from '../index'
import { getFrontmostAppName } from './active-app'
import { homedir, hostname } from 'os'
import { ensureClipboardImageStoreDirs, persistClipboardImage } from '../system/clipboard-image-store'

let watcherTimeout: ReturnType<typeof setTimeout> | null = null
let lastSignature = ''
let watcherActive = false
let suppressedClipboardChangeCount = 0
let suppressClipboardChangeUntil = 0
let unchangedPollCount = 0
let hotPollUntil = 0
let imageSignatureReuseBudget = 0
let lastImageLightweightSignature: string | null = null
let isProbeQueueRunning = false
let pendingProbeQueue: ClipboardProbe[] = []

type ClipboardFilePayload = {
  filePath: string
  fileSize: number | null
}

type ClipboardProbe = {
  signature: string
  file: ClipboardFilePayload | null
  text: string
  hasImage: boolean
  nextPollDelayMs: number
}

const EMPTY_TEXT_HASH = hashTextContent('')
const SIGNATURE_SAMPLE_BYTES = 64 * 1024
const DEFAULT_POLL_INTERVAL_MS = 260
const IMAGE_FALLBACK_POLL_INTERVAL_MS = 720
const IMAGE_FINGERPRINT_SIZE = 16
const FAST_POLL_INTERVAL_MS = 140
const HOT_POLL_WINDOW_MS = 2400
const IDLE_BACKOFF_STEP_POLLS = 6
const IDLE_BACKOFF_INTERVALS_MS = [260, 340, 460, 620, 820, 1080]
const IMAGE_SIGNATURE_SAMPLE_INTERVAL = 4
const MAX_PENDING_PROBE_QUEUE = 12
const IMAGE_FILE_PATH_PATTERN = /\.(png|jpe?g|gif|webp|heic|svg|bmp|tiff?|ico|avif)$/i

function isImageFilePath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  return IMAGE_FILE_PATH_PATTERN.test(filePath)
}

function hashTextContent(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

function hashTextSignature(value: string): string {
  if (value.length <= SIGNATURE_SAMPLE_BYTES) {
    return hashTextContent(value)
  }

  return createHash('sha1')
    .update(String(value.length))
    .update(value.slice(0, SIGNATURE_SAMPLE_BYTES / 2))
    .update(value.slice(-SIGNATURE_SAMPLE_BYTES / 2))
    .digest('hex')
}

function hashBinarySignature(buffer: Buffer): string {
  if (buffer.length <= SIGNATURE_SAMPLE_BYTES) {
    return createHash('sha1').update(buffer).digest('hex')
  }

  return createHash('sha1')
    .update(String(buffer.length))
    .update(buffer.subarray(0, SIGNATURE_SAMPLE_BYTES / 2))
    .update(buffer.subarray(buffer.length - SIGNATURE_SAMPLE_BYTES / 2))
    .digest('hex')
}

function getImageLightweightSignature(): string | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return null
  }

  const { width, height } = image.getSize()

  try {
    const fingerprint = image.resize({ width: IMAGE_FINGERPRINT_SIZE, height: IMAGE_FINGERPRINT_SIZE }).toBitmap()
    return `${width}x${height}:${hashBinarySignature(fingerprint)}`
  } catch {
    return `${width}x${height}`
  }
}

function normalizeClipboardFilePath(value: string): string | null {
  const trimmed = value.replace(/\0/g, '').trim()
  if (!trimmed) return null
  const normalizedInput = trimmed.match(/^(['"])(.*)\1$/)?.[2] ?? trimmed

  const expandHomePath = (pathValue: string): string => {
    if (pathValue === '~') {
      return homedir()
    }
    if (pathValue.startsWith('~/') || pathValue.startsWith('~\\')) {
      return `${homedir()}${pathValue.slice(1)}`
    }
    return pathValue
  }

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
      const filePath = fileURLToPath(normalizedInput)
      pushCandidate(filePath)
      pushCandidate(expandHomePath(filePath))
    } catch {
      // Continue probing decoded/plain candidates.
    }
  }

  const encodedCandidates = Array.from(candidates).filter((candidate) => candidate.includes('%'))
  for (const candidate of encodedCandidates) {
    try {
      const decodedPath = decodeURIComponent(candidate)
      pushCandidate(decodedPath)
      pushCandidate(expandHomePath(decodedPath))
    } catch {
      // Ignore decoding failures and keep probing other candidates.
    }
  }

  for (const candidate of candidates) {
    if (isAbsolute(candidate) && existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function parseFilePathList(raw: string): string | null {
  const entries = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith('#') && entry !== 'copy' && entry !== 'cut')

  for (const entry of entries) {
    const normalized = normalizeClipboardFilePath(entry)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function extractFilePathFromHtml(rawHtml: string): string | null {
  if (!rawHtml) return null

  const matches = rawHtml.match(/file:\/\/[^"'<>\\s)]+/gi) ?? []
  for (const match of matches) {
    const normalized = normalizeClipboardFilePath(match)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function readClipboardAliasPath(): string | null {
  if (process.platform !== 'darwin') return null

  try {
    const output = execFileSync(
      'osascript',
      [
        '-e',
        'try',
        '-e',
        'return POSIX path of (the clipboard as alias)',
        '-e',
        'on error',
        '-e',
        'return ""',
        '-e',
        'end try'
      ],
      { encoding: 'utf8', timeout: 400 }
    ).trim()

    return normalizeClipboardFilePath(output)
  } catch {
    return null
  }
}

function isFileLikeClipboardFormat(format: string): boolean {
  const normalizedFormat = format.toLowerCase()
  return normalizedFormat.includes('uri') || normalizedFormat.includes('file') || normalizedFormat.includes('bookmark')
}

function isImageLikeClipboardFormat(format: string): boolean {
  const normalizedFormat = format.toLowerCase()
  return (
    normalizedFormat.startsWith('image/') ||
    normalizedFormat.includes('png') ||
    normalizedFormat.includes('jpeg') ||
    normalizedFormat.includes('jpg') ||
    normalizedFormat.includes('webp') ||
    normalizedFormat.includes('gif') ||
    normalizedFormat.includes('bmp') ||
    normalizedFormat.includes('tiff') ||
    normalizedFormat.includes('bitmap')
  )
}

function isTextLikeClipboardFormat(format: string): boolean {
  const normalizedFormat = format.toLowerCase()
  return (
    normalizedFormat === 'text/plain' ||
    normalizedFormat.includes('text') ||
    normalizedFormat.includes('utf8') ||
    normalizedFormat.includes('string') ||
    normalizedFormat.includes('plain')
  )
}

function resetImageSignatureSampler(): void {
  imageSignatureReuseBudget = 0
  lastImageLightweightSignature = null
}

function getClipboardImageSignature(
  options?: { allowFallback?: boolean; basePollDelayMs?: number }
): { signature: string; nextPollDelayMs: number } | null {
  if (!options?.allowFallback) {
    resetImageSignatureSampler()
    return null
  }

  const nextPollDelayMs = Math.max(options?.basePollDelayMs ?? DEFAULT_POLL_INTERVAL_MS, IMAGE_FALLBACK_POLL_INTERVAL_MS)
  if (lastImageLightweightSignature && imageSignatureReuseBudget > 0) {
    imageSignatureReuseBudget -= 1
    return {
      signature: `image:${lastImageLightweightSignature}`,
      nextPollDelayMs
    }
  }

  const fallbackSignature = getImageLightweightSignature()
  if (!fallbackSignature) {
    resetImageSignatureSampler()
    return null
  }

  lastImageLightweightSignature = fallbackSignature
  imageSignatureReuseBudget = Math.max(0, IMAGE_SIGNATURE_SAMPLE_INTERVAL - 1)
  return {
    signature: `image:${fallbackSignature}`,
    nextPollDelayMs
  }
}

function resolveClipboardFilePath(formats: string[], text: string, html: string, hasFileLikeFormat: boolean): string | null {
  const looksLikeFileUrlText =
    /^(?:copy|cut)\s*\r?\nfile:\/\//i.test(text.trim()) || /^file:\/\//i.test(text.trim())

  if (process.platform === 'darwin' || process.platform === 'win32') {
    try {
      const bookmark = clipboard.readBookmark()
      const fromBookmark = normalizeClipboardFilePath(bookmark.url || '')
      if (fromBookmark) {
        return fromBookmark
      }
    } catch {
      // Ignore unsupported bookmark reads and continue with format probing.
    }
  }

  if (hasFileLikeFormat || looksLikeFileUrlText) {
    const fromText = parseFilePathList(text)
    if (fromText) {
      return fromText
    }
  }

  const fromHtml = extractFilePathFromHtml(html)
  if (fromHtml) {
    return fromHtml
  }

  for (const format of formats) {
    if (!isFileLikeClipboardFormat(format)) {
      continue
    }

    try {
      const raw = clipboard.readBuffer(format).toString('utf8')
      const fromBuffer = parseFilePathList(raw)
      if (fromBuffer) {
        return fromBuffer
      }
    } catch {
      // Some native clipboard formats are not UTF-8 encoded. Skip them.
    }
  }

  if (hasFileLikeFormat) {
    const fromAlias = readClipboardAliasPath()
    if (fromAlias) {
      return fromAlias
    }
  }

  return null
}

function readClipboardFilePayload(formats: string[], text: string, html: string, hasFileLikeFormat: boolean): ClipboardFilePayload | null {
  const filePath = resolveClipboardFilePath(formats, text, html, hasFileLikeFormat)
  if (!filePath) return null

  try {
    const stats = statSync(filePath)
    return {
      filePath,
      fileSize: stats.isFile() ? stats.size : null
    }
  } catch {
    return {
      filePath,
      fileSize: null
    }
  }
}

function buildClipboardProbe(defaultPollDelayMs: number): ClipboardProbe {
  const formats = clipboard.availableFormats()
  const hasHtmlFormat = formats.some((format) => format.toLowerCase().includes('html'))
  const hasFileLikeFormat = formats.some(isFileLikeClipboardFormat)
  const hasImageLikeFormat = formats.some(isImageLikeClipboardFormat)
  const hasTextLikeFormat = formats.some(isTextLikeClipboardFormat)
  const shouldReadTextEarly = hasFileLikeFormat || (!hasImageLikeFormat && hasTextLikeFormat)
  let text = shouldReadTextEarly ? clipboard.readText() : ''
  const hasFileUrlText = /^(?:copy|cut)\s*\r?\nfile:\/\//i.test(text.trim()) || /^file:\/\//i.test(text.trim())
  const html = !text && hasHtmlFormat ? clipboard.readHTML() : ''
  const file = hasFileLikeFormat || hasFileUrlText || html
    ? readClipboardFilePayload(formats, text, html, hasFileLikeFormat)
    : null
  const preferImageForFile = file ? isImageFilePath(file.filePath) : false
  if (!text && !shouldReadTextEarly && !preferImageForFile && !hasImageLikeFormat) {
    text = clipboard.readText()
  }

  const imageProbe = getClipboardImageSignature({
    allowFallback: !text || preferImageForFile || hasImageLikeFormat,
    basePollDelayMs: defaultPollDelayMs
  })

  if (file && (!preferImageForFile || !imageProbe)) {
    resetImageSignatureSampler()
    return {
      signature: `file:${hashTextContent(file.filePath)}`,
      file,
      text: '',
      hasImage: false,
      nextPollDelayMs: defaultPollDelayMs
    }
  }

  if (imageProbe) {
    return {
      signature: imageProbe.signature,
      file: null,
      text: '',
      hasImage: true,
      nextPollDelayMs: imageProbe.nextPollDelayMs
    }
  }

  if (file) {
    resetImageSignatureSampler()
    return {
      signature: `file:${hashTextContent(file.filePath)}`,
      file,
      text: '',
      hasImage: false,
      nextPollDelayMs: defaultPollDelayMs
    }
  }

  if (!text && !shouldReadTextEarly) {
    text = clipboard.readText()
  }

  if (text) {
    resetImageSignatureSampler()
    return {
      signature: `text:${hashTextSignature(text)}`,
      file: null,
      text,
      hasImage: false,
      nextPollDelayMs: defaultPollDelayMs
    }
  }

  resetImageSignatureSampler()
  return {
    signature: `text:${EMPTY_TEXT_HASH}`,
    file: null,
    text: '',
    hasImage: false,
    nextPollDelayMs: defaultPollDelayMs
  }
}

function shouldSuppressClipboardChange(): boolean {
  if (suppressedClipboardChangeCount <= 0) {
    return false
  }

  if (Date.now() > suppressClipboardChangeUntil) {
    suppressedClipboardChangeCount = 0
    suppressClipboardChangeUntil = 0
    return false
  }

  suppressedClipboardChangeCount = Math.max(0, suppressedClipboardChangeCount - 1)
  if (suppressedClipboardChangeCount === 0) {
    suppressClipboardChangeUntil = 0
  }

  return true
}

function getAdaptivePollDelay(baseDelayMs: number, changed: boolean): number {
  const now = Date.now()
  if (changed) {
    unchangedPollCount = 0
    hotPollUntil = now + HOT_POLL_WINDOW_MS
    return Math.min(baseDelayMs, FAST_POLL_INTERVAL_MS)
  }

  unchangedPollCount += 1
  if (now < hotPollUntil) {
    return Math.min(baseDelayMs, FAST_POLL_INTERVAL_MS)
  }

  const level = Math.min(IDLE_BACKOFF_INTERVALS_MS.length - 1, Math.floor(unchangedPollCount / IDLE_BACKOFF_STEP_POLLS))
  const backoffDelayMs = IDLE_BACKOFF_INTERVALS_MS[level]
  return Math.max(baseDelayMs, backoffDelayMs)
}

async function captureClipboardImage(): Promise<Awaited<ReturnType<typeof persistClipboardImage>> | null> {
  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return null
  }

  return persistClipboardImage(image)
}

async function onClipboardChange(probe: ClipboardProbe): Promise<void> {
  const storedImage = probe.file || !probe.hasImage
    ? null
    : await captureClipboardImage()
  const hasImage = Boolean(storedImage)
  if (!probe.file && probe.hasImage && !storedImage) {
    return
  }
  const appName = getFrontmostAppName()

  const contentType = probe.file ? 'file' : hasImage ? 'image' : 'text'
  const item = insertClipboardItem({
    contentType,
    textContent: probe.file || hasImage ? null : probe.text,
    imageData: null,
    imagePreviewData: null,
    imagePath: storedImage?.imagePath ?? null,
    imagePreviewPath: storedImage?.imagePreviewPath ?? null,
    imageWidth: storedImage?.width ?? null,
    imageHeight: storedImage?.height ?? null,
    filePath: probe.file?.filePath ?? null,
    fileSize: probe.file
      ? probe.file.fileSize
      : storedImage
        ? storedImage.fileSize
        : (probe.text ? Buffer.byteLength(probe.text, 'utf8') : 0),
    sourceDevice: hostname(),
    sourceApp: appName,
    contentHash: probe.file
      ? hashTextContent(`file:${probe.file.filePath}`)
      : storedImage
        ? storedImage.contentHash
        : hashTextContent(probe.text)
  })

  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('clipboard:changed', stripClipboardItemPayload(item))
  }
}

function enqueueClipboardProbe(probe: ClipboardProbe): void {
  const lastQueued = pendingProbeQueue[pendingProbeQueue.length - 1]
  if (lastQueued && lastQueued.signature === probe.signature) {
    return
  }

  if (pendingProbeQueue.length >= MAX_PENDING_PROBE_QUEUE) {
    pendingProbeQueue.shift()
  }

  pendingProbeQueue.push(probe)
}

async function flushProbeQueue(): Promise<void> {
  if (isProbeQueueRunning) {
    return
  }

  isProbeQueueRunning = true
  try {
    while (watcherActive && pendingProbeQueue.length > 0) {
      const probe = pendingProbeQueue.shift()
      if (!probe) {
        continue
      }

      try {
        await onClipboardChange(probe)
      } catch (error) {
        console.warn('[ShearPlate] Clipboard change processing failed:', error)
      }
    }
  } finally {
    isProbeQueueRunning = false
    if (watcherActive && pendingProbeQueue.length > 0) {
      void flushProbeQueue()
    }
  }
}

export function startClipboardWatcher(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  stopClipboardWatcher()
  const defaultPollDelayMs = Math.max(80, Math.round(intervalMs))
  watcherActive = true
  unchangedPollCount = 0
  hotPollUntil = 0
  pendingProbeQueue = []
  isProbeQueueRunning = false
  resetImageSignatureSampler()
  void ensureClipboardImageStoreDirs()
  const initialProbe = buildClipboardProbe(defaultPollDelayMs)
  let nextPollDelayMs = getAdaptivePollDelay(initialProbe.nextPollDelayMs, false)
  lastSignature = initialProbe.signature

  const poll = () => {
    if (!watcherActive) return

    watcherTimeout = setTimeout(async () => {
      try {
        const probe = buildClipboardProbe(defaultPollDelayMs)
        const changed = probe.signature !== lastSignature
        nextPollDelayMs = getAdaptivePollDelay(probe.nextPollDelayMs, changed)
        if (changed) {
          lastSignature = probe.signature
          if (!shouldSuppressClipboardChange()) {
            enqueueClipboardProbe(probe)
            void flushProbeQueue()
          }
        }
      } catch (error) {
        console.warn('[ShearPlate] Clipboard polling failed:', error)
        nextPollDelayMs = getAdaptivePollDelay(defaultPollDelayMs, false)
      } finally {
        if (watcherActive) {
          poll()
        }
      }
    }, nextPollDelayMs)
  }

  poll()
}

export function stopClipboardWatcher(): void {
  watcherActive = false
  if (watcherTimeout) {
    clearTimeout(watcherTimeout)
    watcherTimeout = null
  }
  pendingProbeQueue = []
  isProbeQueueRunning = false
  resetImageSignatureSampler()
}

export function suppressNextClipboardCapture(durationMs = 1200): void {
  suppressedClipboardChangeCount += 1
  suppressClipboardChangeUntil = Math.max(suppressClipboardChangeUntil, Date.now() + durationMs)
}
