import { Star, Trash2, Bookmark } from 'lucide-react'
import { memo, useMemo } from 'react'
import type { ClipboardItem, Language } from '../../../shared/types'
import { t } from '../lib/i18n'
import { formatFileDisplayText } from '../lib/file-display'

interface ClipboardCardProps {
  item: ClipboardItem
  language: Language
  onSnippetToggle: () => void
  onStar: () => void
  onDelete: () => void
  isSelected: boolean
  onCommit: () => void
}

export const ClipboardCard = memo(function ClipboardCard({
  item,
  language,
  onSnippetToggle,
  onStar,
  onDelete,
  isSelected,
  onCommit
}: ClipboardCardProps) {
  const previewText = useMemo(
    () =>
      item.contentType === 'file'
        ? formatFileDisplayText(item.filePath, language)
        : item.contentType === 'image'
          ? t(language, 'filterImage')
          : item.textContent || item.filePath || 'Clipboard content',
    [item.contentType, item.filePath, item.textContent, language]
  )

  const actionButtonClass =
    'h-6 w-6 rounded-[7px] text-[var(--color-text-tertiary)] transition-colors duration-75 hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]'

  return (
    <div
      onClick={onCommit}
      className={`group relative flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-2.5 py-1.5 transition-colors duration-75 ${
        isSelected
          ? 'border-[var(--color-card-selected-border)] bg-[var(--color-card-selected-bg)]'
          : 'border-transparent bg-transparent hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div title={previewText} className="truncate text-[12.5px] font-medium leading-[1.25] text-[var(--color-text-primary)]">
          {previewText}
        </div>
      </div>

      <div className={`flex items-center gap-0.5 transition-all duration-75 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <button
          onClick={(event) => {
            event.stopPropagation()
            onSnippetToggle()
          }}
          className={`${actionButtonClass} ${item.isSnippet ? 'text-[var(--color-accent)]' : ''}`}
          title={item.isSnippet ? t(language, 'snippetRemove') : t(language, 'snippetSave')}
        >
          <Bookmark size={14} fill={item.isSnippet ? 'currentColor' : 'none'} className="mx-auto" />
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation()
            onStar()
          }}
          className={`${actionButtonClass} ${item.isStarred ? 'text-[var(--color-accent)]' : ''}`}
          title={item.isStarred ? t(language, 'unstar') : t(language, 'star')}
        >
          <Star size={14} fill={item.isStarred ? 'currentColor' : 'none'} className="mx-auto" />
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          className={`${actionButtonClass} hover:bg-[var(--color-error-bg)] hover:text-[var(--color-error)]`}
          title={t(language, 'delete')}
        >
          <Trash2 size={14} className="mx-auto" />
        </button>
      </div>
    </div>
  )
})
