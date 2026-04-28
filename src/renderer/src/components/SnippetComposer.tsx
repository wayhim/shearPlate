import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { ClipboardItem, Language } from '../../../shared/types'
import { t } from '../lib/i18n'

interface SnippetComposerProps {
  language: Language
  onCreate: (keyword: string, content: string) => Promise<ClipboardItem | null>
  onCreated?: (item: ClipboardItem) => void
}

export function SnippetComposer({ language, onCreate, onCreated }: SnippetComposerProps) {
  const [expanded, setExpanded] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)

  const canSubmit = keyword.trim().length > 0 && content.trim().length > 0 && !busy

  async function handleCreate() {
    if (!canSubmit) return

    setBusy(true)
    const created = await onCreate(keyword.trim(), content)
    setBusy(false)

    if (!created) return

    setKeyword('')
    setContent('')
    setExpanded(false)
    onCreated?.(created)
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex shrink-0 items-center gap-2 rounded-[11px] border border-dashed border-[var(--color-border)] bg-[var(--color-pill-bg)] px-3 py-2 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors duration-75 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        <Plus size={14} />
        <span>{t(language, 'snippetCreate')}</span>
      </button>
    )
  }

  return (
    <div className="shrink-0 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-window-bg-strong)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">{t(language, 'snippetCreate')}</p>
          <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-tertiary)]">{t(language, 'snippetCreateHint')}</p>
        </div>
        <button
          onClick={() => {
            setExpanded(false)
            setKeyword('')
            setContent('')
          }}
          className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)] transition-colors duration-75 hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
          title={t(language, 'snippetCreateCancel')}
        >
          <X size={13} />
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{t(language, 'snippetKeyword')}</span>
          <input
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t(language, 'snippetKeywordPlaceholder')}
            className="h-9 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-window-bg)] px-3 text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{t(language, 'snippetContent')}</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t(language, 'snippetContentPlaceholder')}
            rows={4}
            className="panel-scrollbar min-h-[92px] rounded-[9px] border border-[var(--color-border)] bg-[var(--color-window-bg)] px-3 py-2.5 text-[12px] leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={() => {
            setExpanded(false)
            setKeyword('')
            setContent('')
          }}
          className="rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors duration-75 hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
        >
          {t(language, 'snippetCreateCancel')}
        </button>
        <button
          onClick={() => void handleCreate()}
          disabled={!canSubmit}
          className="rounded-[8px] bg-[var(--color-pill-bg-active)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-text-primary)] transition-colors duration-75 hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t(language, 'snippetCreateAction')}
        </button>
      </div>
    </div>
  )
}
