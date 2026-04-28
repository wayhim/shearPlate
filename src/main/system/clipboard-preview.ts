import { nativeImage, type NativeImage } from 'electron'
import type { ClipboardItem } from '../../shared/types'
import { getStoredClipboardNativeImage } from './clipboard-image-store'

export const FAST_IMAGE_PREVIEW_MAX_DIMENSION = 560
const DEFAULT_IMAGE_PREVIEW_MAX_DIMENSION = 1200
const imagePreviewCache = new Map<string, string | null>()
const decodedImageCache = new Map<string, NativeImage>()
const IMAGE_PREVIEW_CACHE_LIMIT = 160
const DECODED_IMAGE_CACHE_LIMIT = 96

type ImagePreviewMode = 'fast' | 'full' | 'custom'

function getImagePreviewCacheKey(item: ClipboardItem, mode: ImagePreviewMode, maxDimension: number): string {
  return `${item.contentHash || item.id}:${item.fileSize ?? 0}:${item.imagePath ?? ''}:${item.imagePreviewPath ?? ''}:${mode}:${maxDimension}`
}

function getDecodedImageCacheKey(item: ClipboardItem): string {
  return `${item.contentHash || item.id}:${item.fileSize ?? 0}:${item.imagePath ?? ''}:${item.imagePreviewPath ?? ''}`
}

function rememberPreviewData(cacheKey: string, value: string | null): void {
  if (imagePreviewCache.has(cacheKey)) {
    imagePreviewCache.delete(cacheKey)
  }
  imagePreviewCache.set(cacheKey, value)

  if (imagePreviewCache.size <= IMAGE_PREVIEW_CACHE_LIMIT) return
  const oldestKey = imagePreviewCache.keys().next().value
  if (oldestKey) {
    imagePreviewCache.delete(oldestKey)
  }
}

function rememberDecodedImage(cacheKey: string, image: NativeImage): void {
  if (decodedImageCache.has(cacheKey)) {
    decodedImageCache.delete(cacheKey)
  }
  decodedImageCache.set(cacheKey, image)

  if (decodedImageCache.size <= DECODED_IMAGE_CACHE_LIMIT) return
  const oldestKey = decodedImageCache.keys().next().value
  if (oldestKey) {
    decodedImageCache.delete(oldestKey)
  }
}

export function getClipboardNativeImage(item: ClipboardItem): NativeImage | null {
  if (item.contentType !== 'image') {
    return null
  }

  const cacheKey = getDecodedImageCacheKey(item)
  const cached = decodedImageCache.get(cacheKey)
  if (cached && !cached.isEmpty()) {
    return cached
  }

  const storedPathImage = getStoredClipboardNativeImage(item)
  if (storedPathImage && !storedPathImage.isEmpty()) {
    rememberDecodedImage(cacheKey, storedPathImage)
    return storedPathImage
  }

  const sourceDataUrl = item.imageData ?? item.imagePreviewData
  if (!sourceDataUrl) {
    return null
  }

  try {
    const image = nativeImage.createFromDataURL(sourceDataUrl)
    if (image.isEmpty()) {
      return null
    }
    rememberDecodedImage(cacheKey, image)
    return image
  } catch {
    return null
  }
}

export function getClipboardImagePreviewData(
  item: ClipboardItem,
  options?: {
    mode?: ImagePreviewMode
    maxDimension?: number
    allowStoredPreview?: boolean
    preferOriginal?: boolean
  }
): string | null {
  if (item.contentType !== 'image') {
    return null
  }

  const mode = options?.mode ?? 'custom'
  const maxDimension = options?.maxDimension ?? DEFAULT_IMAGE_PREVIEW_MAX_DIMENSION
  const allowStoredPreview = options?.allowStoredPreview ?? true
  const preferOriginal = options?.preferOriginal ?? false
  const cacheKey = getImagePreviewCacheKey(item, mode, maxDimension)
  if (imagePreviewCache.has(cacheKey)) {
    return imagePreviewCache.get(cacheKey) ?? null
  }

  if (preferOriginal && item.imageData) {
    rememberPreviewData(cacheKey, item.imageData)
    return item.imageData
  }

  if (preferOriginal && item.imagePath) {
    const image = nativeImage.createFromPath(item.imagePath)
    if (!image.isEmpty()) {
      const dataUrl = image.toDataURL()
      rememberPreviewData(cacheKey, dataUrl)
      return dataUrl
    }
  }

  if (allowStoredPreview && item.imagePreviewData) {
    rememberPreviewData(cacheKey, item.imagePreviewData)
    return item.imagePreviewData
  }

  if (allowStoredPreview && item.imagePreviewPath) {
    const image = nativeImage.createFromPath(item.imagePreviewPath)
    if (!image.isEmpty()) {
      const dataUrl = image.toDataURL()
      rememberPreviewData(cacheKey, dataUrl)
      return dataUrl
    }
  }

  if (!item.imageData && !item.imagePath) {
    rememberPreviewData(cacheKey, null)
    return null
  }

  if (
    item.imageWidth !== null &&
    item.imageHeight !== null &&
    item.imageWidth <= maxDimension &&
    item.imageHeight <= maxDimension
  ) {
    if (item.imageData) {
      rememberPreviewData(cacheKey, item.imageData)
      return item.imageData
    }
    const image = getClipboardNativeImage(item)
    const dataUrl = image && !image.isEmpty() ? image.toDataURL() : null
    rememberPreviewData(cacheKey, dataUrl)
    return dataUrl
  }

  try {
    const image = getClipboardNativeImage(item)
    if (!image || image.isEmpty()) {
      const fallback = item.imageData ?? null
      rememberPreviewData(cacheKey, fallback)
      return fallback
    }

    const sourceDataUrl = item.imageData ?? image.toDataURL()
    const previewData = createImagePreviewData(image, sourceDataUrl, maxDimension)
    rememberPreviewData(cacheKey, previewData)
    return previewData
  } catch {
    const fallback = item.imageData ?? null
    rememberPreviewData(cacheKey, fallback)
    return fallback
  }
}

export function createImagePreviewData(
  image: NativeImage,
  originalDataUrl: string,
  maxDimension = DEFAULT_IMAGE_PREVIEW_MAX_DIMENSION
): string {
  if (image.isEmpty()) {
    return originalDataUrl
  }

  const { width, height } = image.getSize()
  if (width <= maxDimension && height <= maxDimension) {
    return originalDataUrl
  }

  const scale = Math.min(maxDimension / width, maxDimension / height)
  const resizedImage = image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  })
  return resizedImage.toDataURL()
}
