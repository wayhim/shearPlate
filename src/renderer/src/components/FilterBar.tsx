import { Bookmark, Boxes, File, Image as ImageIcon, Star, Type } from 'lucide-react'
import type { FilterType } from '../stores/clipboard'
import type { Language } from '../../../shared/types'
import { t } from '../lib/i18n'

interface FilterBarProps {
  onFilterChange: (filter: FilterType) => void
  activeFilter: FilterType
  language: Language
}

const filters: { value: FilterType; labelKey: string; icon: typeof Boxes }[] = [
  { value: 'all', labelKey: 'filterAll', icon: Boxes },
  { value: 'text', labelKey: 'filterText', icon: Type },
  { value: 'image', labelKey: 'filterImage', icon: ImageIcon },
  { value: 'file', labelKey: 'filterFile', icon: File },
  { value: 'snippet', labelKey: 'filterSnippet', icon: Bookmark },
  { value: 'starred', labelKey: 'filterStarred', icon: Star }
]

export function FilterBar({ onFilterChange, activeFilter, language }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((filter) => {
        const selected = activeFilter === filter.value
        const Icon = filter.icon
        return (
          <button
            key={filter.value}
            onClick={() => onFilterChange(filter.value)}
            className={`inline-flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] transition-colors duration-150 ${
              selected
                ? 'bg-[var(--color-pill-bg-active)] text-[var(--color-text-primary)]'
                : 'bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <Icon size={12} strokeWidth={2} className="flex-shrink-0" />
            <span>{t(language, filter.labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
