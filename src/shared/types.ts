export type ContentType = 'text' | 'image' | 'file'
export type Language = 'zh' | 'en'

export interface ClipboardItem {
  id: string
  contentType: ContentType
  textContent: string | null
  imageData: string | null
  imagePreviewData: string | null
  imagePath: string | null
  imagePreviewPath: string | null
  imageWidth: number | null
  imageHeight: number | null
  filePath: string | null
  fileSize: number | null
  sourceDevice: string
  sourceApp: string
  contentHash: string
  isStarred: boolean
  isSnippet: boolean
  snippetKeyword: string | null
  createdAt: number
}

export interface Device {
  id: string
  hostname: string
  ipAddress: string
  port: number
  pairedAt: number
  lastSeenAt: number
}

export type ThemeMode = 'system' | 'light' | 'dark'

export interface AppSettings {
  theme: ThemeMode
  language: Language
  windowX: number | null
  windowY: number | null
  showPreview: boolean
  maxHistory: number
  historyRetentionDays: number
  shortcut: string
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'zh',
  windowX: null,
  windowY: null,
  showPreview: true,
  maxHistory: 120,
  historyRetentionDays: 7,
  shortcut: 'Alt+V'
}
