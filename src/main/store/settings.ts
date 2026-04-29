import { getDb, saveDb } from './database'
import type { AppSettings } from '../../shared/types'
import { DEFAULT_APP_SETTINGS } from '../../shared/types'

const LEGACY_DEFAULT_SHORTCUT = 'CommandOrControl+Shift+V'
const LEGACY_SETTING_KEYS = ['minimalMode', 'showSourceAppIcon']
const SETTING_KEYS: (keyof AppSettings)[] = [
  'theme',
  'language',
  'windowX',
  'windowY',
  'showPreview',
  'maxHistory',
  'historyRetentionDays',
  'shortcut',
  'openAtLogin'
]

let cachedSettings: AppSettings | null = null

function parseSettingValue<K extends keyof AppSettings>(key: K, raw: string): AppSettings[K] {
  if (key === 'theme') {
    return (raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system') as AppSettings[K]
  }
  if (key === 'language') {
    return (raw === 'en' ? 'en' : 'zh') as AppSettings[K]
  }
  if (key === 'windowX' || key === 'windowY') {
    if (raw === 'null' || raw === '') return null as AppSettings[K]
    const numberValue = Number(raw)
    return (Number.isFinite(numberValue) ? numberValue : null) as AppSettings[K]
  }
  if (key === 'showPreview' || key === 'openAtLogin') {
    return (raw !== 'false') as AppSettings[K]
  }
  if (key === 'maxHistory' || key === 'historyRetentionDays') {
    const numberValue = Number(raw)
    return (Number.isFinite(numberValue) ? numberValue : DEFAULT_APP_SETTINGS[key]) as AppSettings[K]
  }
  return raw as AppSettings[K]
}

function upsertSetting(key: keyof AppSettings, value: AppSettings[keyof AppSettings]): void {
  getDb().run(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  )
}

function ensureDefaults(): void {
  let needsSave = false

  for (const key of LEGACY_SETTING_KEYS) {
    getDb().run(`DELETE FROM app_settings WHERE key = ?`, [key])
    needsSave = getDb().getRowsModified() > 0 || needsSave
  }

  for (const key of SETTING_KEYS) {
    const result = getDb().exec(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`, [key])
    if (!result.length || !result[0].values.length) {
      upsertSetting(key, DEFAULT_APP_SETTINGS[key])
      needsSave = true
    }
  }

  const shortcutValue = getDb().exec(`SELECT value FROM app_settings WHERE key = 'shortcut' LIMIT 1`)
  if (shortcutValue.length && shortcutValue[0].values.length) {
    const currentShortcut = String(shortcutValue[0].values[0][0] ?? '')
    if (currentShortcut === LEGACY_DEFAULT_SHORTCUT) {
      upsertSetting('shortcut', DEFAULT_APP_SETTINGS.shortcut)
      needsSave = true
    }
  }

  if (needsSave) {
    saveDb()
  }
}

function readSettingsFromDb(): AppSettings {
  ensureDefaults()

  const rows = getDb().exec(`SELECT key, value FROM app_settings`)
  if (!rows.length) return { ...DEFAULT_APP_SETTINGS }

  const settings: AppSettings = { ...DEFAULT_APP_SETTINGS }
  for (const [key, raw] of rows[0].values) {
    const typedKey = key as keyof AppSettings
    if (!SETTING_KEYS.includes(typedKey)) continue
    ;(settings as Record<keyof AppSettings, AppSettings[keyof AppSettings]>)[typedKey] = parseSettingValue(
      typedKey,
      String(raw)
    )
  }

  return settings
}

export function getAppSettings(): AppSettings {
  if (!cachedSettings) {
    cachedSettings = readSettingsFromDb()
  }

  return { ...cachedSettings }
}

export function updateAppSettings(partial: Partial<AppSettings>): AppSettings {
  const nextSettings: AppSettings = { ...getAppSettings(), ...partial }
  let hasChanges = false

  for (const key of SETTING_KEYS) {
    if (nextSettings[key] === cachedSettings?.[key]) {
      continue
    }

    hasChanges = true
    upsertSetting(key, nextSettings[key])
  }

  cachedSettings = nextSettings
  if (hasChanges) {
    saveDb()
  }

  return { ...nextSettings }
}
