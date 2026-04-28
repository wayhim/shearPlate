import type { Language } from '../../../shared/types'
import { t } from '../lib/i18n'

interface SourceAppBadgeProps {
  appName: string | null | undefined
  language: Language
  textClassName?: string
}

export function SourceAppBadge({
  appName,
  language,
  textClassName = 'text-[10px] font-medium text-[var(--color-text-secondary)]'
}: SourceAppBadgeProps) {
  const label = appName?.trim() || t(language, 'unknownApp')

  return (
    <span className={`inline-flex min-w-0 items-center ${textClassName}`}>
      <span className="truncate">{label}</span>
    </span>
  )
}
