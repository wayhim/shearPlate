import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bookmark, ChevronUp, ChevronsDown, FileText, Maximize2, Minimize2 } from 'lucide-react'
import type { ClipboardItem, Language } from '../../../shared/types'
import { SourceAppBadge } from './SourceAppBadge'
import { formatFileDisplayText, getFileDisplayName, getFileKindLabel, getFileTypeLabel } from '../lib/file-display'
import { t } from '../lib/i18n'

type InferredLanguage = 'typescript' | 'json' | 'http' | 'shell' | 'markdown' | 'plain'

type SyntaxToken = {
  text: string
  kind:
    | 'plain'
    | 'muted'
    | 'keyword'
    | 'string'
    | 'number'
    | 'comment'
    | 'type'
    | 'accent'
}

interface PreviewPanelProps {
  item: ClipboardItem | null
  preloadItems?: ClipboardItem[]
  language: Language
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}

const HIGHLIGHT_CHAR_LIMIT = 12_000
const HIGHLIGHT_LINE_LIMIT = 220
const COLLAPSED_PREVIEW_LINE_LIMIT = 18
const COLLAPSED_PREVIEW_CHAR_LIMIT = 1_600
const FILE_PREVIEW_LOAD_DELAY_MS = 90
const CODE_TOKEN_CACHE_LIMIT = 180
const IMAGE_PREVIEW_CACHE_LIMIT = 140
const IMAGE_PREVIEW_FALLBACK_CACHE_LIMIT = 48
const FILE_PREVIEW_CACHE_LIMIT = 140
const IMAGE_MEMORY_PREFETCH_LIMIT = 18
const imagePreviewCache = new Map<string, string | null>()
const imagePreviewRequestCache = new Map<string, Promise<string | null>>()
const imagePreviewFallbackCache = new Map<string, string | null>()
const filePreviewCache = new Map<string, string | null>()
const filePreviewRequestCache = new Map<string, Promise<string | null>>()
const codeTokenCache = new Map<string, { lines: string[]; tokenizedLines: SyntaxToken[][] }>()
const imageMemoryPrefetchCache = new Map<string, HTMLImageElement | null>()
const imageMemoryPrefetchRequestCache = new Map<string, Promise<void>>()

function rememberCacheEntry<K, V>(cache: Map<K, V>, cacheKey: K, value: V, limit: number): V {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey)
  }
  cache.set(cacheKey, value)

  if (cache.size <= limit) {
    return value
  }

  const oldestKey = cache.keys().next().value
  if (oldestKey !== undefined) {
    cache.delete(oldestKey)
  }

  return value
}

function readCacheEntry<K, V>(cache: Map<K, V>, cacheKey: K): V | undefined {
  if (!cache.has(cacheKey)) {
    return undefined
  }

  const cached = cache.get(cacheKey) as V
  rememberCacheEntry(cache, cacheKey, cached, Number.POSITIVE_INFINITY)
  return cached
}

function primeImageMemoryCache(cacheKey: string, src: string | null): Promise<void> {
  if (!src) {
    rememberCacheEntry(imageMemoryPrefetchCache, cacheKey, null, IMAGE_MEMORY_PREFETCH_LIMIT)
    return Promise.resolve()
  }

  const cached = readCacheEntry(imageMemoryPrefetchCache, cacheKey)
  if (cached !== undefined) {
    return Promise.resolve()
  }

  const inFlight = imageMemoryPrefetchRequestCache.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  const request = new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'async'

    let settled = false
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      rememberCacheEntry(imageMemoryPrefetchCache, cacheKey, value, IMAGE_MEMORY_PREFETCH_LIMIT)
      resolve()
    }

    image.onload = () => finish(image)
    image.onerror = () => finish(null)
    image.src = src
  }).finally(() => {
    imageMemoryPrefetchRequestCache.delete(cacheKey)
  })

  imageMemoryPrefetchRequestCache.set(cacheKey, request)
  return request
}

function formatTime(ts: number, language: Language): string {
  const targetDate = new Date(ts)
  const now = new Date()
  if (
    targetDate.getFullYear() === now.getFullYear() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getDate() === now.getDate()
  ) {
    return targetDate.toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  const diff = Date.now() - ts
  if (diff < 60_000) return t(language, 'justNow')
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return targetDate.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getTextCharacterCount(text: string): number {
  return text.length
}

function getCollapsedPreviewText(text: string): string {
  if (!text) return text

  let lineCount = 1
  let output = ''
  const limit = Math.min(text.length, COLLAPSED_PREVIEW_CHAR_LIMIT)

  for (let index = 0; index < limit; index += 1) {
    const char = text[index]
    if (char === '\n') {
      if (lineCount >= COLLAPSED_PREVIEW_LINE_LIMIT) {
        break
      }
      lineCount += 1
    }
    output += char
  }

  return output
}

function getLineCount(text: string, stopAt = Number.POSITIVE_INFINITY): number {
  if (!text) return 1

  let lineCount = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n') continue
    lineCount += 1
    if (lineCount >= stopAt) {
      return lineCount
    }
  }

  return lineCount
}

function getUtf8ByteLength(text: string): number {
  let total = 0
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.charCodeAt(index)
    if (codePoint < 0x80) {
      total += 1
      continue
    }
    if (codePoint < 0x800) {
      total += 2
      continue
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      index += 1
      total += 4
      continue
    }
    total += 3
  }
  return total
}

function getTextFingerprint(text: string): string {
  if (text.length <= 120) {
    return `${text.length}:${text}`
  }

  const middleIndex = Math.floor(text.length / 2)
  return [
    text.length,
    text.slice(0, 56),
    text.slice(Math.max(0, middleIndex - 28), middleIndex + 28),
    text.slice(-56)
  ].join(':')
}

function inferLanguage(text: string, filePath: string | null): InferredLanguage {
  const trimmed = text.trim()
  const lowerPath = filePath?.toLowerCase() || ''

  if (/\.(ts|tsx|js|jsx)$/.test(lowerPath)) return 'typescript'
  if (/\.(json)$/.test(lowerPath)) return 'json'
  if (/\.(sh|zsh|bash)$/.test(lowerPath)) return 'shell'
  if (/\.(md|markdown)$/.test(lowerPath)) return 'markdown'
  if (/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+/m.test(trimmed) || /HTTP\/\d(?:\.\d)?/.test(trimmed)) return 'http'
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) return 'json'
  if (/\b(import|export|const|let|function|return|interface|type|async|await)\b/.test(trimmed)) return 'typescript'
  if (/^\s*(curl|npm|pnpm|yarn|git|cd|ls|cat|echo)\b/m.test(trimmed) || /\$\w+/.test(trimmed)) return 'shell'
  if (/^#{1,6}\s/m.test(trimmed) || /^[-*+]\s/m.test(trimmed)) return 'markdown'
  return 'plain'
}

function isCodeLike(text: string, lang: InferredLanguage): boolean {
  if (lang !== 'plain') return true
  return /[{}()[\];<>]/.test(text) || getLineCount(text, 4) > 3
}

function tokenizeLine(line: string, language: InferredLanguage): SyntaxToken[] {
  if (!line) return [{ text: ' ', kind: 'plain' }]

  if (language === 'http') {
    if (/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+/.test(line)) {
      return line.split(/(\s+)/).map((part, index) => ({
        text: part,
        kind: index === 0 ? 'keyword' : /HTTP\//.test(part) ? 'type' : 'plain'
      }))
    }

    const headerMatch = line.match(/^([A-Za-z-]+)(:\s*)(.*)$/)
    if (headerMatch) {
      return [
        { text: headerMatch[1], kind: 'type' },
        { text: headerMatch[2], kind: 'muted' },
        { text: headerMatch[3], kind: 'plain' }
      ]
    }
  }

  const tokens: SyntaxToken[] = []
  const pattern = /(\/\/.*$|#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:import|from|export|default|const|let|var|function|return|if|else|for|while|class|new|async|await|try|catch|throw|interface|type|extends|implements|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|\$[A-Za-z_][\w]*|\b[A-Z][A-Za-z0-9_]+\b|https?:\/\/[^\s]+|[{}()[\].,:;<>])/g
  let lastIndex = 0

  for (const match of line.matchAll(pattern)) {
    const matched = match[0]
    const index = match.index ?? 0

    if (index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, index), kind: 'plain' })
    }

    let kind: SyntaxToken['kind'] = 'plain'
    if (/^(\/\/|#)/.test(matched)) {
      kind = 'comment'
    } else if (/^https?:\/\//.test(matched)) {
      kind = 'accent'
    } else if (/^[$]/.test(matched)) {
      kind = 'accent'
    } else if (/^[{}()[\].,:;<>]$/.test(matched)) {
      kind = 'muted'
    } else if (/^\d/.test(matched)) {
      kind = 'number'
    } else if (/^("|'|`)/.test(matched)) {
      const nextChar = line.slice(index + matched.length).trimStart()[0]
      kind = language === 'json' && nextChar === ':' ? 'type' : 'string'
    } else if (/^[A-Z]/.test(matched)) {
      kind = 'type'
    } else if (/\b(import|from|export|default|const|let|var|function|return|if|else|for|while|class|new|async|await|try|catch|throw|interface|type|extends|implements|true|false|null|undefined)\b/.test(matched)) {
      kind = 'keyword'
    }

    tokens.push({ text: matched, kind })
    lastIndex = index + matched.length
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), kind: 'plain' })
  }

  return tokens
}

function rememberTokenizedPreview(
  cacheKey: string,
  payload: { lines: string[]; tokenizedLines: SyntaxToken[][] }
): { lines: string[]; tokenizedLines: SyntaxToken[][] } {
  return rememberCacheEntry(codeTokenCache, cacheKey, payload, CODE_TOKEN_CACHE_LIMIT)
}

function getTokenizedPreview(
  cacheKey: string,
  text: string,
  inferredLanguage: InferredLanguage
): { lines: string[]; tokenizedLines: SyntaxToken[][] } {
  const cached = codeTokenCache.get(cacheKey)
  if (cached) {
    return rememberTokenizedPreview(cacheKey, cached)
  }

  const lines = text.split('\n')
  const tokenizedLines = lines.map((line) => tokenizeLine(line, inferredLanguage))
  return rememberTokenizedPreview(cacheKey, { lines, tokenizedLines })
}

function CodePreview({
  text,
  inferredLanguage,
  cacheKey,
  scrollable = true,
  hasActionButton = false
}: {
  text: string
  inferredLanguage: InferredLanguage
  cacheKey?: string
  scrollable?: boolean
  hasActionButton?: boolean
}) {
  const resolvedCacheKey = useMemo(
    () => cacheKey ?? `${inferredLanguage}:${getTextFingerprint(text)}`,
    [cacheKey, inferredLanguage, text]
  )
  const { lines, tokenizedLines } = useMemo(
    () => getTokenizedPreview(resolvedCacheKey, text, inferredLanguage),
    [resolvedCacheKey, text, inferredLanguage]
  )

  return (
    <pre
      className={`preview-selectable whitespace-pre-wrap break-words rounded-[14px] bg-[var(--color-code-bg)] px-3 py-3 font-mono text-[12px] leading-6 text-[var(--color-text-primary)] ${
        hasActionButton ? 'pr-12' : ''
      } ${
        scrollable ? 'panel-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
      }`}
    >
      <code>
        {tokenizedLines.map((tokens, lineIndex) => (
          <div key={`${lineIndex}-${lines[lineIndex]?.slice(0, 12) ?? ''}`} className="min-h-6">
            {tokens.map((token, tokenIndex) => (
              <span key={`${lineIndex}-${tokenIndex}`} className={`syntax-${token.kind}`}>
                {token.text}
              </span>
            ))}
          </div>
        ))}
      </code>
    </pre>
  )
}

function PlainTextPreview({ text, scrollable = true, hasActionButton = false }: { text: string; scrollable?: boolean; hasActionButton?: boolean }) {
  return (
    <pre
      className={`preview-selectable whitespace-pre-wrap break-words rounded-[12px] bg-[var(--color-code-bg)] px-3 py-3 text-[12.5px] leading-6 text-[var(--color-text-primary)] ${
        hasActionButton ? 'pr-12' : ''
      } ${
        scrollable ? 'panel-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
      }`}
    >
      {text}
    </pre>
  )
}

function PreviewBodyTransition({ transitionKey, children }: { transitionKey: string; children: ReactNode }) {
  void transitionKey

  return (
    <div className="relative h-full min-h-0">{children}</div>
  )
}

export const PreviewPanel = memo(function PreviewPanel({
  item,
  preloadItems = [],
  language,
  fullscreen = false,
  onToggleFullscreen
}: PreviewPanelProps) {
  const [imagePreviewData, setImagePreviewData] = useState<string | null>(
    item?.contentType === 'image' ? (item.imagePreviewData ?? item.imageData) : null
  )
  const [filePreviewData, setFilePreviewData] = useState<string | null>(null)
  const [isFilePreviewLoading, setIsFilePreviewLoading] = useState(false)
  const [isImagePreviewLoading, setIsImagePreviewLoading] = useState(false)
  const [textByteSize, setTextByteSize] = useState(0)
  const previewItem = item
  const previewText =
    previewItem?.contentType === 'file'
      ? formatFileDisplayText(previewItem.filePath, language)
      : previewItem?.contentType === 'text'
        ? previewItem.textContent || ''
        : previewItem?.filePath || ''
  const inferredLanguage =
    previewItem?.contentType === 'text' ? inferLanguage(previewText, previewItem?.filePath || null) : 'plain'
  const codeLike = previewItem?.contentType === 'text' ? isCodeLike(previewText, inferredLanguage) : false
  const [isExpanded, setIsExpanded] = useState(false)
  const lineCountForHighlight = useMemo(
    () => getLineCount(previewText, HIGHLIGHT_LINE_LIMIT + 1),
    [previewText]
  )
  const lineCountForCollapse = useMemo(
    () => getLineCount(previewText, COLLAPSED_PREVIEW_LINE_LIMIT + 1),
    [previewText]
  )
  const shouldUsePlainPreview = previewText.length > HIGHLIGHT_CHAR_LIMIT || lineCountForHighlight > HIGHLIGHT_LINE_LIMIT
  const shouldCollapseLongText =
    previewItem?.contentType === 'text' &&
    (previewText.length > COLLAPSED_PREVIEW_CHAR_LIMIT || lineCountForCollapse > COLLAPSED_PREVIEW_LINE_LIMIT)
  const collapsedPreviewText = useMemo(() => getCollapsedPreviewText(previewText), [previewText])
  const previewTime = previewItem ? formatTime(previewItem.createdAt, language) : ''
  const imagePreviewMode: 'fast' | 'full' = fullscreen ? 'full' : 'fast'
  const imageCacheKey = useMemo(
    () => (
      previewItem?.contentType === 'image'
        ? `${previewItem.contentHash || previewItem.id}:${imagePreviewMode}`
        : null
    ),
    [imagePreviewMode, previewItem?.contentHash, previewItem?.contentType, previewItem?.id]
  )
  const inlineImageFallbackPreview = useMemo(
    () => (
      previewItem?.contentType === 'image'
        ? (imagePreviewMode === 'full'
          ? (previewItem.imageData ?? previewItem.imagePreviewData)
          : (previewItem.imagePreviewData ?? previewItem.imageData))
        : null
    ),
    [imagePreviewMode, previewItem?.contentType, previewItem?.imageData, previewItem?.imagePreviewData]
  )
  const fileDisplayName = useMemo(
    () => (previewItem?.contentType === 'file' ? getFileDisplayName(previewItem.filePath, language) : ''),
    [language, previewItem?.contentType, previewItem?.filePath]
  )
  const fileTypeLabel = useMemo(
    () => (previewItem?.contentType === 'file' ? getFileTypeLabel(previewItem.filePath, language) : ''),
    [language, previewItem?.contentType, previewItem?.filePath]
  )
  const textCharacterCount = useMemo(
    () => (previewItem?.contentType === 'text' ? getTextCharacterCount(previewText) : 0),
    [previewItem?.contentType, previewText]
  )
  const previewSize = previewItem
    ? formatSize(previewItem.contentType === 'text' ? textByteSize : previewItem.fileSize)
    : ''

  useEffect(() => {
    if (previewItem?.contentType !== 'text') {
      setTextByteSize(0)
      return
    }

    let cancelled = false
    const textSnapshot = previewText
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      setTextByteSize(getUtf8ByteLength(textSnapshot))
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [previewItem?.contentType, previewItem?.id, previewText])

  useEffect(() => {
    if (!item || item.contentType !== 'image') {
      setImagePreviewData(null)
      setIsImagePreviewLoading(false)
      return
    }

    const previewMode: 'fast' | 'full' = fullscreen ? 'full' : 'fast'
    const imageCacheKey = `${item.contentHash || item.id}:${previewMode}`
    const inlinePreview = previewMode === 'fast'
      ? (item.imagePreviewData ?? item.imageData)
      : (item.imageData ?? item.imagePreviewData)

    if (inlinePreview) {
      setImagePreviewData(inlinePreview)
      setIsImagePreviewLoading(false)
      void primeImageMemoryCache(imageCacheKey, inlinePreview)
      if (previewMode === 'fast') {
        return
      }
    }

    const cachedPreview = readCacheEntry(imagePreviewCache, imageCacheKey)
    if (cachedPreview !== undefined) {
      setImagePreviewData(cachedPreview)
      setIsImagePreviewLoading(false)
      void primeImageMemoryCache(imageCacheKey, cachedPreview)
      return
    }

    let cancelled = false
    setImagePreviewData(null)
    setIsImagePreviewLoading(true)

    let request = imagePreviewRequestCache.get(imageCacheKey)
    if (!request) {
      request = window.api.store.getImagePreview(item.id, previewMode).finally(() => {
        imagePreviewRequestCache.delete(imageCacheKey)
      })
      imagePreviewRequestCache.set(imageCacheKey, request)
    }

    void request.then((nextPreview) => {
      if (cancelled) return
      rememberCacheEntry(imagePreviewCache, imageCacheKey, nextPreview, IMAGE_PREVIEW_CACHE_LIMIT)
      void primeImageMemoryCache(imageCacheKey, nextPreview)
      setImagePreviewData(nextPreview ?? inlinePreview ?? null)
      setIsImagePreviewLoading(false)
    }).catch(() => {
      if (cancelled) return
      imagePreviewCache.delete(imageCacheKey)
      setImagePreviewData(inlinePreview ?? null)
      setIsImagePreviewLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [
    fullscreen,
    item?.contentHash,
    item?.contentType,
    item?.id,
    item?.imageData,
    item?.imagePreviewData
  ])

  const handleImagePreviewError = useCallback(() => {
    if (previewItem?.contentType !== 'image') {
      return
    }

    const fallbackCacheKey = imageCacheKey ?? previewItem.id
    const cachedFallback = readCacheEntry(imagePreviewFallbackCache, fallbackCacheKey)
    if (cachedFallback !== undefined) {
      setImagePreviewData(cachedFallback)
      setIsImagePreviewLoading(false)
      return
    }

    rememberCacheEntry(
      imagePreviewFallbackCache,
      fallbackCacheKey,
      inlineImageFallbackPreview ?? null,
      IMAGE_PREVIEW_FALLBACK_CACHE_LIMIT
    )
    if (imageCacheKey) {
      rememberCacheEntry(
        imagePreviewCache,
        imageCacheKey,
        inlineImageFallbackPreview ?? null,
        IMAGE_PREVIEW_CACHE_LIMIT
      )
    }

    setImagePreviewData(inlineImageFallbackPreview ?? null)
    setIsImagePreviewLoading(false)
  }, [imageCacheKey, inlineImageFallbackPreview, previewItem?.contentType, previewItem?.id])

  useEffect(() => {
    if (!preloadItems.length) {
      return
    }

    let cancelled = false

    for (const candidate of preloadItems) {
      if (candidate.contentType !== 'image') continue

      const preloadMode: 'fast' = 'fast'
      const preloadKey = `${candidate.contentHash || candidate.id}:${preloadMode}`
      const inlinePreview = candidate.imagePreviewData ?? candidate.imageData

      if (inlinePreview) {
        rememberCacheEntry(imagePreviewCache, preloadKey, inlinePreview, IMAGE_PREVIEW_CACHE_LIMIT)
        void primeImageMemoryCache(preloadKey, inlinePreview)
        continue
      }

      const cachedPreview = readCacheEntry(imagePreviewCache, preloadKey)
      if (cachedPreview !== undefined) {
        void primeImageMemoryCache(preloadKey, cachedPreview)
        continue
      }

      let request = imagePreviewRequestCache.get(preloadKey)
      if (!request) {
        request = window.api.store.getImagePreview(candidate.id, preloadMode).finally(() => {
          imagePreviewRequestCache.delete(preloadKey)
        })
        imagePreviewRequestCache.set(preloadKey, request)
      }

      void request.then((nextPreview) => {
        if (cancelled) return
        rememberCacheEntry(imagePreviewCache, preloadKey, nextPreview, IMAGE_PREVIEW_CACHE_LIMIT)
        void primeImageMemoryCache(preloadKey, nextPreview)
      }).catch(() => {
        if (cancelled) return
        imagePreviewCache.delete(preloadKey)
      })
    }

    return () => {
      cancelled = true
    }
  }, [preloadItems])

  useEffect(() => {
    if (previewItem?.contentType === 'text') {
      setIsExpanded(true)
      return
    }
    setIsExpanded(false)
  }, [previewItem?.contentType, previewItem?.id])

  useEffect(() => {
    if (previewItem?.contentType !== 'file' || !previewItem.filePath) {
      setFilePreviewData(null)
      setIsFilePreviewLoading(false)
      return
    }

    const filePath = previewItem.filePath
    const cachedPreview = readCacheEntry(filePreviewCache, filePath)
    if (cachedPreview !== undefined) {
      setFilePreviewData(cachedPreview)
      setIsFilePreviewLoading(false)
      return
    }

    let cancelled = false
    setIsFilePreviewLoading(true)
    setFilePreviewData(null)
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return

      let request = filePreviewRequestCache.get(filePath)
      if (!request) {
        request = window.api.system.getFilePreview(filePath).finally(() => {
          filePreviewRequestCache.delete(filePath)
        })
        filePreviewRequestCache.set(filePath, request)
      }

      void request.then((nextPreview) => {
        rememberCacheEntry(filePreviewCache, filePath, nextPreview, FILE_PREVIEW_CACHE_LIMIT)
        if (cancelled) return
        setFilePreviewData(nextPreview)
        setIsFilePreviewLoading(false)
      }).catch(() => {
        rememberCacheEntry(filePreviewCache, filePath, null, FILE_PREVIEW_CACHE_LIMIT)
        if (cancelled) return
        setFilePreviewData(null)
        setIsFilePreviewLoading(false)
      })
    }, FILE_PREVIEW_LOAD_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [previewItem?.contentType, previewItem?.filePath, previewItem?.id])

  if (!previewItem) {
    return (
      <div
        className={`flex h-full min-h-0 flex-col ${fullscreen ? 'px-1.5' : 'border-l border-[var(--color-divider)] pl-3 pr-1.5'}`}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col rounded-[12px] bg-[var(--color-code-bg)] px-5 py-4 text-center">
          <div className="flex shrink-0 items-center justify-center">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
              {t(language, 'previewTitle')}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--color-surface)]">
              <FileText size={18} className="text-[var(--color-text-tertiary)]" />
            </div>
            <div className="space-y-1">
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">选择一条内容开始预览</p>
              <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">上下方向键和鼠标悬停都会同步更新右侧内容。</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const previewBody = previewItem.contentType === 'file' && filePreviewData
    ? (
        <div className="panel-scrollbar flex h-full min-h-0 items-center justify-center overflow-auto rounded-[12px] bg-[var(--color-preview-image-bg)] p-3">
          <img
            src={filePreviewData}
            alt=""
            className="max-h-full max-w-full rounded-[10px] object-contain"
          />
        </div>
      )
    : previewItem.contentType === 'file' && isFilePreviewLoading
      ? (
          <div className="flex h-full min-h-0 items-center justify-center rounded-[12px] bg-[var(--color-code-bg)] px-5 text-center">
            <p className="text-[12px] text-[var(--color-text-tertiary)]">{t(language, 'previewLoading')}</p>
          </div>
        )
    : previewItem.contentType === 'image' && isImagePreviewLoading
      ? (
          <div className="flex h-full min-h-0 items-center justify-center rounded-[12px] bg-[var(--color-code-bg)] px-5 text-center">
            <p className="text-[12px] text-[var(--color-text-tertiary)]">{t(language, 'previewLoading')}</p>
          </div>
        )
    : previewItem.contentType === 'image' && imagePreviewData
    ? (
        <div className="panel-scrollbar flex h-full min-h-0 items-center justify-center overflow-auto rounded-[12px] bg-[var(--color-preview-image-bg)] p-3">
          <img
            src={imagePreviewData}
            alt="Clipboard preview"
            onError={handleImagePreviewError}
            className="max-h-full max-w-full rounded-[10px] object-contain"
          />
        </div>
      )
    : codeLike && !shouldUsePlainPreview
      ? (
          <CodePreview
            text={previewText}
            inferredLanguage={inferredLanguage}
            cacheKey={`full:${previewItem.id}:${previewItem.contentHash}:${inferredLanguage}:${getTextFingerprint(previewText)}`}
            hasActionButton={Boolean(onToggleFullscreen)}
          />
        )
      : <PlainTextPreview text={previewText || t(language, 'emptyDesc')} hasActionButton={Boolean(onToggleFullscreen)} />
  const collapsedPreviewBody = codeLike && !shouldUsePlainPreview
    ? (
        <CodePreview
          text={collapsedPreviewText}
          inferredLanguage={inferredLanguage}
          cacheKey={`collapsed:${previewItem?.id ?? 'none'}:${previewItem?.contentHash ?? 'none'}:${inferredLanguage}:${getTextFingerprint(collapsedPreviewText)}`}
          scrollable={false}
          hasActionButton={Boolean(onToggleFullscreen)}
        />
      )
    : <PlainTextPreview text={collapsedPreviewText || t(language, 'emptyDesc')} scrollable={false} hasActionButton={Boolean(onToggleFullscreen)} />
  const shouldShowCollapsedPreview = shouldCollapseLongText && !isExpanded
  const previewDisplayBody = shouldShowCollapsedPreview
    ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="relative h-full overflow-hidden">
            <div className="h-full">{collapsedPreviewBody}</div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-window-bg)] via-[color-mix(in_srgb,var(--color-window-bg)_82%,transparent)] to-transparent" />
          </div>
        </div>
      )
    : (
        <div className="min-h-0 flex-1 overflow-hidden">{previewBody}</div>
      )
  let previewDisplayTransitionKey: string
  if (shouldShowCollapsedPreview) {
    previewDisplayTransitionKey = `collapsed:${previewItem.id}:${shouldUsePlainPreview ? 'plain' : codeLike ? 'code' : 'plain'}`
  } else if (previewItem.contentType === 'file') {
    previewDisplayTransitionKey = isFilePreviewLoading
      ? `file:loading:${previewItem.id}`
      : (filePreviewData ? `file:ready:${previewItem.id}` : `file:empty:${previewItem.id}`)
  } else if (previewItem.contentType === 'image') {
    previewDisplayTransitionKey = isImagePreviewLoading
      ? `image:loading:${previewItem.id}:${imagePreviewMode}`
      : (imagePreviewData ? `image:ready:${previewItem.id}:${imagePreviewMode}` : `image:empty:${previewItem.id}:${imagePreviewMode}`)
  } else {
    previewDisplayTransitionKey = `text:${previewItem.id}:${shouldUsePlainPreview ? 'plain' : 'code'}`
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden transition-all duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        fullscreen ? 'px-1.5' : 'border-l border-[var(--color-divider)] pl-3 pr-1.5'
      }`}
    >
      <div className="mb-2.5 flex shrink-0 flex-col gap-1.5 transition-all duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)]">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="truncate text-[10.5px] text-[var(--color-text-tertiary)]">
              {previewItem.contentType === 'image'
                ? 'Image'
                : previewItem.contentType === 'file'
                  ? `${getFileKindLabel(previewItem.filePath, language)} · ${fileTypeLabel}`
                  : codeLike
                    ? inferredLanguage
                    : 'Text'}
            </span>
            {previewItem.contentType === 'file' ? (
              <div className="truncate text-[13px] font-medium tracking-[-0.01em] text-[var(--color-text-primary)]">
                {fileDisplayName}
              </div>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {previewItem.isSnippet ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-pill-bg)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                <Bookmark size={10} className="flex-shrink-0" />
                <span>{previewItem.snippetKeyword || t(language, 'snippet')}</span>
              </span>
            ) : null}
            <SourceAppBadge appName={previewItem.sourceApp} language={language} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-[var(--color-text-tertiary)]">
          <span className="text-[10px]">{previewTime}</span>
          <span className="text-[var(--color-text-disabled)]">•</span>
          {previewItem.contentType === 'text' ? (
            <>
              <span className="text-[10px]">
                {textCharacterCount.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')} {t(language, 'characters')}
              </span>
              <span className="text-[var(--color-text-disabled)]">•</span>
            </>
          ) : null}
          <span className="text-[10px]">{previewSize}</span>
        </div>
      </div>

      <div className="min-h-0 h-0 flex-1 overflow-hidden">
        <div className="group/preview relative flex h-full min-h-0 flex-col">
          {onToggleFullscreen ? (
            <div className="pointer-events-none absolute right-3 top-3 z-10 opacity-0 transition-opacity duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/preview:opacity-100 group-focus-within/preview:opacity-100">
              <button
                onClick={onToggleFullscreen}
                title={t(language, fullscreen ? 'previewExitFullscreen' : 'previewFullscreen')}
                className={`pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-window-bg-strong)_88%,transparent)] text-[var(--color-text-secondary)] shadow-[var(--shadow-popover)] backdrop-blur-md transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:scale-[1.03] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] ${
                  fullscreen ? 'rotate-0' : 'rotate-0'
                }`}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          ) : null}
          <PreviewBodyTransition transitionKey={previewDisplayTransitionKey}>
            {previewDisplayBody}
          </PreviewBodyTransition>

          {shouldCollapseLongText ? (
            <div className="mt-2 shrink-0 flex justify-center">
              <button
                onClick={() => setIsExpanded((current) => !current)}
                title={t(language, isExpanded ? 'previewCollapse' : 'previewExpand')}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-window-bg-strong)] text-[var(--color-text-secondary)] shadow-[var(--shadow-popover)] transition-all duration-75 hover:-translate-y-px hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronsDown size={14} />}
              </button>
            </div>
          ) : null}
        </div>
      </div>

    </div>
  )
})
