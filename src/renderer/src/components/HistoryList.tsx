import { memo, useRef, useEffect, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ClipboardCard } from './ClipboardCard'
import { EmptyState } from './EmptyState'
import { useClipboardStore } from '../stores/clipboard'
import { Loader2 } from 'lucide-react'
import type { ClipboardItem, Language } from '../../../shared/types'
import { shouldDeferHotkeysToIme } from '../lib/ime'
import { t } from '../lib/i18n'

interface HistoryListProps {
  language: Language
  items: ClipboardItem[]
  loading: boolean
  loadingMore: boolean
  canLoadMore: boolean
  onLoadMore: () => Promise<void> | void
  selectedId: string | null
  onSelect: (id: string) => void
  onHoverSelect?: (id: string) => void
  onCommit: (item: ClipboardItem) => Promise<void> | void
  onSnippetToggle: (item: ClipboardItem) => Promise<void> | void
}

interface HistoryListCardProps {
  item: ClipboardItem
  language: Language
  isSelected: boolean
  onCommit: (item: ClipboardItem) => Promise<void> | void
  onSnippetToggle: (item: ClipboardItem) => Promise<void> | void
  onToggleStar: (id: string) => void
  onDelete: (id: string) => void
}

const HistoryListCard = memo(function HistoryListCard({
  item,
  language,
  isSelected,
  onCommit,
  onSnippetToggle,
  onToggleStar,
  onDelete
}: HistoryListCardProps) {
  const handleCommit = useCallback(() => {
    void onCommit(item)
  }, [item, onCommit])

  const handleSnippetToggle = useCallback(() => {
    void onSnippetToggle(item)
  }, [item, onSnippetToggle])

  const handleStar = useCallback(() => {
    onToggleStar(item.id)
  }, [item.id, onToggleStar])

  const handleDelete = useCallback(() => {
    onDelete(item.id)
  }, [item.id, onDelete])

  return (
    <ClipboardCard
      item={item}
      language={language}
      onSnippetToggle={handleSnippetToggle}
      onStar={handleStar}
      onDelete={handleDelete}
      isSelected={isSelected}
      onCommit={handleCommit}
    />
  )
})

export function HistoryList({
  language,
  items,
  loading,
  loadingMore,
  canLoadMore,
  onLoadMore,
  selectedId,
  onSelect,
  onHoverSelect,
  onCommit,
  onSnippetToggle
}: HistoryListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const itemIndexById = useMemo(() => {
    const indexMap = new Map<string, number>()
    for (let index = 0; index < items.length; index += 1) {
      indexMap.set(items[index].id, index)
    }
    return indexMap
  }, [items])
  const selectedIndex = selectedId ? (itemIndexById.get(selectedId) ?? -1) : -1
  const handleToggleStar = useCallback((id: string) => {
    void useClipboardStore.getState().handleToggleStar(id)
  }, [])
  const handleDelete = useCallback((id: string) => {
    void useClipboardStore.getState().handleDelete(id)
  }, [])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 54,
    overscan: 4
  })

  const handleHoverSelect = useCallback((id: string) => {
    if (selectedId === id) {
      return
    }
    ;(onHoverSelect ?? onSelect)(id)
  }, [onHoverSelect, onSelect, selectedId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const selection = window.getSelection()
      const hasTextSelection = Boolean(selection && !selection.isCollapsed && selection.toString())
      const tag = target?.tagName?.toLowerCase()
      const isSearchInput = Boolean(target?.closest('[data-search-input="true"]'))
      const isTyping =
        tag === 'input' ||
        tag === 'textarea' ||
        target?.isContentEditable ||
        (target?.getAttribute('role') ?? '') === 'textbox'
      const shouldDeferToIme = isSearchInput && shouldDeferHotkeysToIme(event)

      if ((isTyping && !isSearchInput) || shouldDeferToIme || items.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const nextIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, items.length - 1)
        onSelect(items[nextIndex].id)
        virtualizer.scrollToIndex(nextIndex, { align: 'auto' })
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const nextIndex = selectedIndex <= 0 ? 0 : selectedIndex - 1
        onSelect(items[nextIndex].id)
        virtualizer.scrollToIndex(nextIndex, { align: 'auto' })
      }

      if (event.key === 'Enter' && selectedIndex >= 0) {
        event.preventDefault()
        void onCommit(items[selectedIndex])
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && selectedIndex >= 0) {
        if (hasTextSelection) {
          return
        }

        event.preventDefault()
        void onCommit(items[selectedIndex])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [items, onCommit, onSelect, selectedIndex, virtualizer])

  if (loading && items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--color-text-tertiary)]" />
      </div>
    )
  }

  if (items.length === 0) {
    return <EmptyState language={language} />
  }

  return (
    <div
      ref={parentRef}
      className="panel-scrollbar h-full min-h-0 overflow-x-hidden overflow-y-auto pb-1 pr-1.5"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index]
          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`
              }}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
            >
              <div
                className="pb-1.5"
                onMouseEnter={() => {
                  handleHoverSelect(item.id)
                }}
              >
                <HistoryListCard
                  item={item}
                  language={language}
                  isSelected={selectedId === item.id}
                  onCommit={onCommit}
                  onSnippetToggle={onSnippetToggle}
                  onToggleStar={handleToggleStar}
                  onDelete={handleDelete}
                />
              </div>
            </div>
          )
        })}
      </div>
      {canLoadMore ? (
        <div className="px-1 pb-2 pt-1">
          <button
            onClick={() => {
              void onLoadMore()
            }}
            disabled={loadingMore}
            className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors duration-75 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? t(language, 'loadingMore') : t(language, 'loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
