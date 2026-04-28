import { Search, CircleX } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Language } from '../../../shared/types'
import { t } from '../lib/i18n'
import { cancelImeComposition, finishImeComposition, startImeComposition } from '../lib/ime'

interface SearchBarProps {
  value: string
  language: Language
  onSearch: (value: string) => void
  focusKey?: number
}

export function SearchBar({ value, language, onSearch, focusKey = 0 }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 20)

    return () => window.clearTimeout(timer)
  }, [focusKey])

  useEffect(() => cancelImeComposition, [])

  return (
    <div className="group relative flex h-[50px] items-center rounded-[14px] border border-[var(--color-input-border)] bg-[var(--color-input-bg)] pl-5 pr-4.5 shadow-[var(--shadow-search)] transition-all duration-150 focus-within:border-[var(--color-input-border)] focus-within:bg-[var(--color-input-focus-bg)] focus-within:shadow-[var(--shadow-search-focus)]">
      <Search size={16} className="pointer-events-none text-[var(--color-text-tertiary)] transition-colors group-focus-within:text-[var(--color-text-secondary)]" />
      <input
        ref={inputRef}
        data-search-input="true"
        type="text"
        value={value}
        placeholder={t(language, 'searchPlaceholder')}
        onChange={(e) => onSearch(e.target.value)}
        onBlur={() => cancelImeComposition()}
        onCompositionStart={() => startImeComposition()}
        onCompositionEnd={() => finishImeComposition()}
        className="h-full flex-1 bg-transparent px-3.5 pr-9 text-[13.5px] font-medium tracking-[-0.01em] text-[var(--color-text-primary)] outline-none placeholder:font-normal placeholder:text-[var(--color-text-tertiary)]"
      />

      {value ? (
        <button
          onClick={() => onSearch('')}
          className="absolute right-3.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
          title={t(language, 'delete')}
        >
          <CircleX size={14} />
        </button>
      ) : null}
    </div>
  )
}
