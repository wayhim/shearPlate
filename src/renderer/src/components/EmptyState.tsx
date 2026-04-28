import { Clipboard } from 'lucide-react'
import type { Language } from '../../../shared/types'
import { t } from '../lib/i18n'

interface EmptyStateProps {
  language: Language
}

export function EmptyState({ language }: EmptyStateProps) {
  return (
    <div className="flex h-full w-full min-h-0 flex-col items-center justify-center gap-3 rounded-[12px] bg-[var(--color-code-bg)] px-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--color-surface)]">
        <Clipboard size={20} className="text-[var(--color-primary)]" />
      </div>
      <div className="space-y-1">
        <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">
          {t(language, 'emptyTitle')}
        </p>
        <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">
          {t(language, 'emptyDesc')}
        </p>
      </div>
    </div>
  )
}
