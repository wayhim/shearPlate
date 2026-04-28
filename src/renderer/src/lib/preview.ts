import type { ClipboardItem, Language } from '../../../shared/types'
import { formatFileDisplayText } from './file-display'
import { t } from './i18n'

function getPreviewText(item: ClipboardItem, language: Language): string {
  if (item.contentType === 'file') {
    return formatFileDisplayText(item.filePath, language)
  }

  if (item.contentType === 'image') {
    return t(language, 'filterImage')
  }

  return item.textContent || item.filePath || 'Clipboard content'
}

export function shouldShowPreviewForItem(
  item: ClipboardItem,
  compact = false,
  measuredOverflow = false,
  language: Language = 'zh'
): boolean {
  if (item.contentType === 'image') return true
  if (measuredOverflow) return true

  const previewText = getPreviewText(item, language)
  if (/[\r\n]/.test(previewText.trim())) return true

  const softLimit = compact ? 34 : 42
  return previewText.trim().length > softLimit
}
