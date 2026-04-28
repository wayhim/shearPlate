import { Monitor, Moon, Sun, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { AppSettings, Language, ThemeMode } from '../../../shared/types'
import { t } from '../lib/i18n'

interface SettingsPanelProps {
  language: Language
  settings: AppSettings
  loading?: boolean
  onChange: (partial: Partial<AppSettings>) => Promise<AppSettings | null> | AppSettings | null | void
  onClose: () => void
}

const languageOptions: { key: Language; labelKey: string }[] = [
  { key: 'zh', labelKey: 'chinese' },
  { key: 'en', labelKey: 'english' }
]

const themeOptions: { key: ThemeMode; labelKey: string; icon: typeof Monitor }[] = [
  { key: 'system', labelKey: 'themeSystemShort', icon: Monitor },
  { key: 'light', labelKey: 'themeLightShort', icon: Sun },
  { key: 'dark', labelKey: 'themeDarkShort', icon: Moon }
]

const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent)

function getAcceleratorKey(event: KeyboardEvent): string | null {
  const { code, key } = event

  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code

  const normalizedKey = key.length === 1 ? key.toUpperCase() : key
  const keyMap: Record<string, string> = {
    Enter: 'Return',
    Escape: 'Escape',
    Tab: 'Tab',
    Space: 'Space',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  }

  return keyMap[normalizedKey] ?? null
}

function formatShortcutLabel(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl') return '⌘/Ctrl'
      if (part === 'Command') return '⌘'
      if (part === 'Control') return 'Ctrl'
      if (part === 'Super') return 'Win'
      if (part === 'Alt' || part === 'Option') return '⌥'
      if (part === 'Shift') return '⇧'
      if (part === 'Return') return '↩'
      if (part === 'Space') return 'Space'
      return part
    })
    .join(' + ')
}

function getCurrentThemeLabel(language: Language, theme: ThemeMode): string {
  return t(language, themeOptions.find((option) => option.key === theme)?.labelKey ?? 'themeSystem')
}

function getCurrentLanguageLabel(language: Language, selectedLanguage: Language): string {
  return t(language, languageOptions.find((option) => option.key === selectedLanguage)?.labelKey ?? 'chinese')
}

interface SettingsSectionProps {
  title: string
  children: ReactNode
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section className="space-y-2.5">
      <p className="pl-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{title}</p>
      {children}
    </section>
  )
}

interface SettingsCardProps {
  children: ReactNode
}

function SettingsCard({ children }: SettingsCardProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-xs)]">
      {children}
    </div>
  )
}

interface SettingRowProps {
  title: string
  description?: string
  descriptionTone?: 'default' | 'error'
  align?: 'center' | 'start'
  children: ReactNode
}

function SettingRow({
  title,
  description,
  descriptionTone = 'default',
  align = 'center',
  children
}: SettingRowProps) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3.5 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium tracking-[-0.01em] text-[var(--color-text-primary)]">{title}</p>
        {description ? (
          <p
            className={`mt-0.5 text-[11px] leading-4 ${
              descriptionTone === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'
            }`}
          >
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end">{children}</div>
    </div>
  )
}

interface SegmentedControlProps<T extends string> {
  options: Array<{ key: T; label: string; icon?: typeof Monitor }>
  value: T
  widthClass: string
  onChange: (value: T) => void
}

function SegmentedControl<T extends string>({ options, value, widthClass, onChange }: SegmentedControlProps<T>) {
  return (
    <div
      className={`inline-grid h-10 grid-flow-col auto-cols-fr items-center rounded-[11px] border border-[var(--color-border)] bg-[var(--color-window-edge-bg)] p-1 ${widthClass}`}
    >
      {options.map((option) => {
        const selected = option.key === value
        const Icon = option.icon

        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={`inline-flex h-full min-w-0 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[11px] font-medium tracking-[-0.01em] transition-all ${
              selected
                ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-[var(--shadow-xs)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {Icon ? <Icon size={12} className="shrink-0" /> : null}
            <span className="truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

interface NumericFieldProps {
  value: string
  min: number
  max: number
  ariaLabel: string
  onChange: (value: string) => void
  onCommit: () => void
}

function NumericField({ value, min, max, ariaLabel, onChange, onCommit }: NumericFieldProps) {
  return (
    <div className="inline-flex h-10 items-center rounded-[11px] border border-[var(--color-input-border)] bg-[var(--color-input-bg)] px-3 shadow-[var(--shadow-xs)] transition-colors focus-within:border-[var(--color-border-strong)] focus-within:bg-[var(--color-input-focus-bg)]">
      <input
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            ;(event.currentTarget as HTMLInputElement).blur()
          }
        }}
        className="h-full w-20 bg-transparent text-right text-[12px] font-medium tracking-[-0.01em] text-[var(--color-text-primary)] outline-none"
      />
    </div>
  )
}

export function SettingsPanel({ language, settings, loading = false, onChange, onClose }: SettingsPanelProps) {
  const [maxHistoryDraft, setMaxHistoryDraft] = useState(String(settings.maxHistory))
  const [retentionDraft, setRetentionDraft] = useState(String(settings.historyRetentionDays))
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState('')
  const shortcutButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setMaxHistoryDraft(String(settings.maxHistory))
    setRetentionDraft(String(settings.historyRetentionDays))
  }, [settings.historyRetentionDays, settings.maxHistory])

  useEffect(() => {
    if (!isRecordingShortcut) return
    shortcutButtonRef.current?.focus()
  }, [isRecordingShortcut])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isRecordingShortcut) {
        return
      }

      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isRecordingShortcut, onClose])

  const commitNumberSetting = (key: 'maxHistory' | 'historyRetentionDays', raw: string) => {
    const fallback = key === 'maxHistory' ? settings.maxHistory : settings.historyRetentionDays
    const min = key === 'maxHistory' ? 10 : 1
    const max = key === 'maxHistory' ? 1000 : 365
    const parsed = Number(raw)
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback
    onChange({ [key]: next })
  }

  const handleShortcutCapture = async (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isRecordingShortcut) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      setIsRecordingShortcut(false)
      setShortcutError('')
      return
    }

    const acceleratorKey = getAcceleratorKey(event.nativeEvent)
    if (!acceleratorKey) return

    const modifiers: string[] = []
    if (IS_MAC_PLATFORM) {
      if (event.metaKey) modifiers.push('Command')
      if (event.ctrlKey) modifiers.push('Control')
    } else {
      if (event.ctrlKey) modifiers.push('Control')
      if (event.metaKey) modifiers.push('Super')
    }
    if (event.altKey) modifiers.push('Alt')
    if (event.shiftKey) modifiers.push('Shift')

    if (modifiers.length === 0) {
      setShortcutError(t(language, 'shortcutRegisterFailed'))
      return
    }

    const accelerator = [...modifiers, acceleratorKey].join('+')
    setShortcutError('')

    const updated = await onChange({ shortcut: accelerator })
    if (!updated || updated.shortcut !== accelerator) {
      setShortcutError(t(language, 'shortcutRegisterFailed'))
      return
    }

    setIsRecordingShortcut(false)
  }

  return (
    <div className="window-shell frosted flex h-full w-full flex-col overflow-hidden rounded-[18px] bg-[var(--color-window-bg)] shadow-[var(--shadow-window)]">
      <div className="titlebar-drag flex items-start justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 pb-3 pt-4">
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">{t(language, 'settings')}</h1>
          <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{t(language, 'settingsSubtitle')}</p>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          title={t(language, 'close')}
        >
          <X size={14} />
        </button>
      </div>

      <div className="panel-scrollbar flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <SettingsSection title={t(language, 'shortcut')}>
          <SettingsCard>
            <SettingRow
              title={t(language, 'shortcut')}
              description={shortcutError || t(language, 'shortcutRecordHint')}
              descriptionTone={shortcutError ? 'error' : 'default'}
            >
              <button
                ref={shortcutButtonRef}
                type="button"
                onClick={() => {
                  setShortcutError('')
                  setIsRecordingShortcut(true)
                }}
                onBlur={() => {
                  setIsRecordingShortcut(false)
                }}
                onKeyDown={(event) => void handleShortcutCapture(event)}
                className={`inline-flex h-10 min-w-[188px] items-center justify-center rounded-[11px] border px-4 text-[12px] font-medium tracking-[-0.01em] outline-none transition-colors ${
                  isRecordingShortcut
                    ? 'border-[var(--color-card-selected-border)] bg-[var(--color-window-edge-bg)] text-[var(--color-text-primary)] shadow-[var(--shadow-xs)]'
                    : 'border-[var(--color-input-border)] bg-[var(--color-input-bg)] text-[var(--color-text-primary)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-input-focus-bg)]'
                }`}
              >
                {loading ? '…' : isRecordingShortcut ? t(language, 'shortcutRecording') : formatShortcutLabel(settings.shortcut)}
              </button>
            </SettingRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t(language, 'general')}>
          <SettingsCard>
            <div className="divide-y divide-[var(--color-divider)]">
              <SettingRow title={t(language, 'theme')} description={getCurrentThemeLabel(language, settings.theme)}>
                <SegmentedControl
                  options={themeOptions.map((option) => ({
                    key: option.key,
                    label: t(language, option.labelKey),
                    icon: option.icon
                  }))}
                  value={settings.theme}
                  widthClass="w-[208px]"
                  onChange={(theme) => onChange({ theme })}
                />
              </SettingRow>

              <SettingRow title={t(language, 'language')} description={getCurrentLanguageLabel(language, settings.language)}>
                <SegmentedControl
                  options={languageOptions.map((option) => ({
                    key: option.key,
                    label: t(language, option.labelKey)
                  }))}
                  value={settings.language}
                  widthClass="w-[172px]"
                  onChange={(selectedLanguage) => onChange({ language: selectedLanguage })}
                />
              </SettingRow>

              <SettingRow
                title={t(language, 'previewPanel')}
                description={settings.showPreview ? t(language, 'previewToggleHint') : t(language, 'previewDisabled')}
              >
                <button
                  type="button"
                  onClick={() => onChange({ showPreview: !settings.showPreview })}
                  className={`inline-flex h-10 min-w-[112px] items-center justify-center rounded-[11px] border px-4 text-[12px] font-medium tracking-[-0.01em] transition-colors ${
                    settings.showPreview
                      ? 'border-[var(--color-card-selected-border)] bg-[var(--color-window-edge-bg)] text-[var(--color-text-primary)]'
                      : 'border-[var(--color-input-border)] bg-[var(--color-input-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {settings.showPreview ? t(language, 'previewEnabled') : t(language, 'previewDisabled')}
                </button>
              </SettingRow>
            </div>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t(language, 'historySettings')}>
          <SettingsCard>
            <div className="divide-y divide-[var(--color-divider)]">
              <SettingRow title={t(language, 'maxHistory')}>
                <NumericField
                  ariaLabel={t(language, 'maxHistory')}
                  min={10}
                  max={1000}
                  value={maxHistoryDraft}
                  onChange={setMaxHistoryDraft}
                  onCommit={() => commitNumberSetting('maxHistory', maxHistoryDraft)}
                />
              </SettingRow>

              <SettingRow title={t(language, 'historyRetentionDays')}>
                <NumericField
                  ariaLabel={t(language, 'historyRetentionDays')}
                  min={1}
                  max={365}
                  value={retentionDraft}
                  onChange={setRetentionDraft}
                  onCommit={() => commitNumberSetting('historyRetentionDays', retentionDraft)}
                />
              </SettingRow>
            </div>
          </SettingsCard>
        </SettingsSection>
      </div>
    </div>
  )
}
