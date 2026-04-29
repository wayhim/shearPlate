import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, clipboard, nativeTheme, screen, shell } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { electronApp } from '@electron-toolkit/utils'
import { initDatabase, saveDbNow } from './store/database'
import {
  getClipboardItem,
  getClipboardItems,
  searchClipboardItems,
  stripClipboardItemPayload,
  toggleStar,
  deleteClipboardItem,
  getStarredItems,
  getSnippetItems,
  createCustomSnippet,
  updateSnippet,
  dedupeClipboardItems,
  applyClipboardRetentionPolicy,
  touchClipboardItem,
  updateClipboardImageStorage
} from './store/clipboard'
import { startClipboardWatcher, stopClipboardWatcher, suppressNextClipboardCapture } from './clipboard/watcher'
import {
  capturePasteTargetContext,
  pasteIntoPreviousTarget,
} from './clipboard/active-app'
import type { PasteTargetContext } from './clipboard/active-app'
import { getClipboardNativeImage } from './system/clipboard-preview'
import {
  getStoredClipboardImagePreview,
  materializeClipboardImagePaths,
  registerClipboardImageProtocol
} from './system/clipboard-image-store'
import { getFilePreviewData } from './system/file-preview'
import { DEFAULT_APP_SETTINGS } from '../shared/types'
import type { ClipboardItem } from '../shared/types'
import { getAppSettings, updateAppSettings } from './store/settings'
import type { AppSettings, ThemeMode } from '../shared/types'
import { PANEL_FULL_WIDTH, PANEL_HEIGHT } from '../shared/layout'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let trayMenu: Menu | null = null
let activeShortcut: string | null = null
let suppressWindowPositionPersistence = false
let suppressPanelBlurHideUntil = 0
let suppressSettingsBlurCloseUntil = 0
let windowPositionPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingWindowPosition: { x: number; y: number } | null = null
let isQuittingAfterFlush = false
let selectionPasteContext: { shouldPaste: boolean; previousTarget: PasteTargetContext | null } = {
  shouldPaste: false,
  previousTarget: null
}
const SETTINGS_WINDOW_WIDTH = 456
const SETTINGS_WINDOW_HEIGHT = 620
const IMAGE_FILE_PATH_PATTERN = /\.(png|jpe?g|gif|webp|heic|svg|bmp|tiff?|ico|avif)$/i
const WINDOW_BG_LIGHT = '#F6F7F9'
const WINDOW_BG_DARK = '#1C1F24'

function configureSessionDataPath(): void {
  if (process.platform !== 'win32') return

  try {
    const tempRoot = app.getPath('temp')
    const sessionDataPath = join(
      tempRoot,
      'shear-plate',
      app.isPackaged ? 'session-data' : `session-data-dev-${process.pid}`
    )
    mkdirSync(sessionDataPath, { recursive: true })
    app.setPath('sessionData', sessionDataPath)
  } catch (error) {
    console.warn('[ShearPlate] Failed to configure sessionData path:', error)
  }
}

configureSessionDataPath()

function isImageFilePath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  return IMAGE_FILE_PATH_PATTERN.test(filePath)
}

function getSafeSettings(): AppSettings {
  try {
    return getAppSettings()
  } catch {
    return DEFAULT_APP_SETTINGS
  }
}

function resolveEffectiveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
  return theme
}

function getWindowBackgroundColor(settings = getSafeSettings()): string {
  return resolveEffectiveTheme(settings.theme) === 'dark' ? WINDOW_BG_DARK : WINDOW_BG_LIGHT
}

function applyWindowBackgroundColor(settings = getSafeSettings()): void {
  const color = getWindowBackgroundColor(settings)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(color)
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setBackgroundColor(color)
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function resetSelectionPasteContext(): void {
  selectionPasteContext = { shouldPaste: false, previousTarget: null }
}

function suppressPanelBlurHide(durationMs = 320): void {
  suppressPanelBlurHideUntil = Date.now() + durationMs
}

function suppressSettingsBlurClose(durationMs = 320): void {
  suppressSettingsBlurCloseUntil = Date.now() + durationMs
}

function hidePanel(options?: { resetPasteContext?: boolean; hideApp?: boolean; forPasteRelay?: boolean }): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const [x, y] = mainWindow.getPosition()
  const [width, height] = mainWindow.getSize()
  console.log('[ShearPlate] hidePanel()', {
    visible: mainWindow.isVisible(),
    focused: mainWindow.isFocused(),
    x,
    y,
    width,
    height
  })

  if (process.platform === 'win32' && options?.forPasteRelay) {
    mainWindow.blur()
  }

  mainWindow.hide()
  if (process.platform === 'darwin' && options?.hideApp !== false) {
    app.hide()
  }

  if (options?.resetPasteContext !== false) {
    resetSelectionPasteContext()
  }
}

function clampIntegerSetting(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function normalizeSettingsPatch(partial: Partial<AppSettings>, current: AppSettings): Partial<AppSettings> {
  const next: Partial<AppSettings> = { ...partial }

  if (partial.maxHistory !== undefined) {
    next.maxHistory = clampIntegerSetting(partial.maxHistory, 10, 1000, current.maxHistory)
  }

  if (partial.historyRetentionDays !== undefined) {
    next.historyRetentionDays = clampIntegerSetting(partial.historyRetentionDays, 1, 365, current.historyRetentionDays)
  }

  if (partial.shortcut !== undefined) {
    next.shortcut = typeof partial.shortcut === 'string' ? partial.shortcut.trim() || current.shortcut : current.shortcut
  }

  if (partial.showPreview !== undefined) {
    next.showPreview = Boolean(partial.showPreview)
  }

  return next
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getPanelSize(): { width: number; height: number } {
  return {
    width: PANEL_FULL_WIDTH,
    height: PANEL_HEIGHT
  }
}

function suppressWindowPersistence<T>(operation: () => T, durationMs = 50): T {
  suppressWindowPositionPersistence = true
  const result = operation()
  setTimeout(() => {
    suppressWindowPositionPersistence = false
  }, durationMs)
  return result
}

function flushPendingWindowPosition(): void {
  if (windowPositionPersistTimer) {
    clearTimeout(windowPositionPersistTimer)
    windowPositionPersistTimer = null
  }

  if (!pendingWindowPosition) return

  const { x, y } = pendingWindowPosition
  pendingWindowPosition = null
  const current = getAppSettings()
  if (current.windowX === x && current.windowY === y) return
  updateAppSettings({ windowX: x, windowY: y })
}

function scheduleWindowPositionPersistence(x: number, y: number): void {
  pendingWindowPosition = { x, y }

  if (windowPositionPersistTimer) {
    clearTimeout(windowPositionPersistTimer)
  }

  windowPositionPersistTimer = setTimeout(() => {
    windowPositionPersistTimer = null
    flushPendingWindowPosition()
  }, 140)
}

function setWindowPosition(win: BrowserWindow, x: number, y: number): void {
  suppressWindowPersistence(() => {
    win.setPosition(Math.round(x), Math.round(y), false)
  })
}

function loadRendererView(win: BrowserWindow, view: 'panel' | 'settings' = 'panel'): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL)
    if (view !== 'panel') {
      rendererUrl.searchParams.set('view', view)
    }
    win.loadURL(rendererUrl.toString())
    return
  }

  if (view === 'panel') {
    win.loadFile(join(__dirname, '../renderer/index.html'))
    return
  }

  win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
}

function sendToRenderer(win: BrowserWindow | null, channel: string, ...args: unknown[]): void {
  if (!win || win.isDestroyed()) return

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      if (!win || win.isDestroyed()) return
      win.webContents.send(channel, ...args)
    })
    return
  }

  win.webContents.send(channel, ...args)
}

function getTrayLabel(
  language: AppSettings['language'],
  key: 'open' | 'settings' | 'hide' | 'quit'
): string {
  const labels = {
    zh: {
      open: '打开',
      settings: '设置',
      hide: '隐藏',
      quit: '退出'
    },
    en: {
      open: 'Open',
      settings: 'Settings',
      hide: 'Hide',
      quit: 'Quit'
    }
  } as const

  return labels[language][key]
}

function writeClipboardFileReference(filePath: string | null): boolean {
  if (!filePath || !existsSync(filePath)) {
    return false
  }

  if (process.platform === 'darwin') {
    try {
      execFileSync(
        'osascript',
        [
          '-e',
          'on run argv',
          '-e',
          'set targetPath to item 1 of argv',
          '-e',
          'set the clipboard to (POSIX file targetPath)',
          '-e',
          'end run',
          filePath
        ],
        { timeout: 1000 }
      )
      return true
    } catch {
      // Fall through to the text fallback if AppleScript cannot write a file reference.
    }
  }

  clipboard.writeText(filePath)
  return true
}

function buildTrayContextMenu(language: AppSettings['language'] = getAppSettings().language): Menu {
  return Menu.buildFromTemplate([
    { label: getTrayLabel(language, 'open'), click: () => showPanel() },
    { label: getTrayLabel(language, 'settings'), click: () => showSettingsWindow() },
    { type: 'separator' },
    { label: getTrayLabel(language, 'hide'), click: () => hidePanel() },
    { type: 'separator' },
    { label: getTrayLabel(language, 'quit'), click: () => app.quit() }
  ])
}

function refreshTrayMenu(language: AppSettings['language'] = getAppSettings().language): void {
  if (!tray || tray.isDestroyed()) return
  trayMenu = buildTrayContextMenu(language)
  if (process.platform !== 'darwin') {
    tray.setContextMenu(trayMenu)
  }
}

function broadcastSettingsChanged(settings: AppSettings): void {
  sendToRenderer(mainWindow, 'settings:changed', settings)
  sendToRenderer(settingsWindow, 'settings:changed', settings)
  refreshTrayMenu(settings.language)
}

function positionWindow(
  win: BrowserWindow,
  settings: AppSettings,
  options?: { width?: number; height?: number; reservedWidth?: number }
): void {
  const panelSize = getPanelSize()
  const width = options?.width ?? panelSize.width
  const height = options?.height ?? panelSize.height
  const reservedWidth = options?.reservedWidth ?? width
  const restorePoint =
    settings.windowX !== null && settings.windowY !== null ? { x: settings.windowX, y: settings.windowY } : screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(restorePoint)
  const workArea = display.workArea
  const padding = 12

  const fallbackX = workArea.x + workArea.width - reservedWidth - padding
  const fallbackY = workArea.y + Math.round((workArea.height - height) / 2)
  const targetX = clamp(
    settings.windowX ?? fallbackX,
    workArea.x + padding,
    workArea.x + workArea.width - reservedWidth - padding
  )
  const targetY = clamp(settings.windowY ?? fallbackY, workArea.y + padding, workArea.y + workArea.height - height - padding)

  setWindowPosition(win, targetX, targetY)
}

function positionStandaloneWindow(win: BrowserWindow, width: number, height: number): void {
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const workArea = display.workArea
  const padding = 20

  const targetX = clamp(
    pointer.x - Math.round(width / 2),
    workArea.x + padding,
    workArea.x + workArea.width - width - padding
  )
  const targetY = clamp(
    pointer.y - Math.round(height / 2),
    workArea.y + padding,
    workArea.y + workArea.height - height - padding
  )

  setWindowPosition(win, targetX, targetY)
}

function createWindow(): BrowserWindow {
  const { width, height } = getPanelSize()
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: false,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    backgroundColor: getWindowBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(false)
  }

  // Keep panel visible after opening; explicit close/hide actions handle dismissal.
  // This avoids immediate hide loops on some macOS tray focus transitions.
  win.on('blur', () => {
    if (!win.isVisible()) return
    if (Date.now() < suppressPanelBlurHideUntil) return
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.warn('[ShearPlate][Renderer]', { level, message, line, sourceId })
    }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[ShearPlate][Renderer] render-process-gone', details)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[ShearPlate][Renderer] did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    })
  })

  win.on('closed', () => {
    mainWindow = null
  })

  win.on('moved', () => {
    if (win.isDestroyed()) return
    if (suppressWindowPositionPersistence) return
    const [x, y] = win.getPosition()
    scheduleWindowPositionPersistence(x, y)
  })

  loadRendererView(win, 'panel')

  return win
}

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: SETTINGS_WINDOW_WIDTH,
    height: SETTINGS_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: false,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: getWindowBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('blur', () => {
    if (!win.isVisible()) return
    if (Date.now() < suppressSettingsBlurCloseUntil) return
    win.close()
  })

  win.on('closed', () => {
    settingsWindow = null
  })

  loadRendererView(win, 'settings')

  return win
}

function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', fileName),
    join(process.resourcesPath, fileName),
    join(process.resourcesPath, 'resources', fileName),
    join(__dirname, '../../resources', fileName)
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function createTrayImage() {
  const loadRasterIcon = (fileName: string, options?: { template?: boolean; resize?: boolean }): Electron.NativeImage | null => {
    const iconPath = resolveResourcePath(fileName)
    if (!iconPath) return null
    const icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) return null

    const shouldResize = options?.resize ?? true
    const nextIcon = shouldResize ? icon.resize({ width: 18, height: 18 }) : icon
    if (options?.template) {
      nextIcon.setTemplateImage(true)
    }
    return nextIcon
  }

  if (process.platform === 'darwin') {
    const templateIcon =
      loadRasterIcon('trayTemplate.png', { template: true, resize: false }) ??
      loadRasterIcon('trayTemplate@2x.png', { template: true, resize: false })
    if (templateIcon) return templateIcon
  }

  if (process.platform === 'win32') {
    const windowsIcon =
      loadRasterIcon('icons/icon.ico') ??
      loadRasterIcon('icons/icon.png') ??
      loadRasterIcon('trayTemplate.png')
    if (windowsIcon) return windowsIcon
  }

  const trayIconPath = resolveResourcePath('tray-icon.svg')
  if (trayIconPath) {
    const trayIconSvg = readFileSync(trayIconPath, 'utf8')
    const normalizedTrayIconSvg =
      process.platform === 'darwin'
        ? trayIconSvg.replaceAll('fill="white"', 'fill="black"').replaceAll('stroke="white"', 'stroke="black"')
        : trayIconSvg
    const icon = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(normalizedTrayIconSvg).toString('base64')}`
    )
    if (!icon.isEmpty()) {
      if (process.platform === 'darwin') {
        const templateIcon = icon.resize({ width: 18, height: 18 })
        templateIcon.setTemplateImage(true)
        return templateIcon
      }

      return icon.resize({ width: 18, height: 18 })
    }
  }

  const fallbackIcon =
    loadRasterIcon('trayTemplate.png') ??
    loadRasterIcon('trayTemplate@2x.png') ??
    loadRasterIcon('icons/icon.png')
  if (fallbackIcon) return fallbackIcon

  throw new Error('Unable to load tray icon from resources/')
}

function createTray(): Tray {
  const icon = createTrayImage()
  const t = new Tray(icon)
  t.setToolTip('ShearPlate')
  trayMenu = buildTrayContextMenu()
  if (process.platform === 'darwin') {
    t.on('click', () => {
      showPanel()
    })
    t.on('right-click', () => {
      if (trayMenu) {
        t.popUpContextMenu(trayMenu)
      }
    })
  } else {
    t.setContextMenu(trayMenu)
    t.on('click', () => {
      showPanel()
    })
    t.on('double-click', () => {
      showPanel()
    })
  }

  return t
}

function bindShortcutHandler() {
  showPanel()
}

function registerShortcut(accelerator = getAppSettings().shortcut): boolean {
  const nextAccelerator = accelerator.trim()
  if (!nextAccelerator) {
    return false
  }

  const previousShortcut = activeShortcut
  if (previousShortcut && globalShortcut.isRegistered(previousShortcut)) {
    globalShortcut.unregister(previousShortcut)
  }

  try {
    const ret = globalShortcut.register(nextAccelerator, bindShortcutHandler)
    if (!ret) {
      if (previousShortcut) {
        globalShortcut.register(previousShortcut, bindShortcutHandler)
      }
      return false
    }

    activeShortcut = nextAccelerator
    return true
  } catch (error) {
    if (previousShortcut) {
      globalShortcut.register(previousShortcut, bindShortcutHandler)
    }
    console.warn('[ShearPlate] Failed to register shortcut:', nextAccelerator, error)
    return false
  }
}

function showSettingsWindow(): void {
  suppressPanelBlurHide()
  suppressSettingsBlurClose()

  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    hidePanel({ resetPasteContext: false, hideApp: false })
  }

  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow()
  }

  settingsWindow.setSize(SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT, false)
  positionStandaloneWindow(settingsWindow, SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT)
  settingsWindow.show()
  settingsWindow.focus()
}

function showPanel() {
  if (!mainWindow) {
    mainWindow = createWindow()
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[ShearPlate] showPanel() aborted: mainWindow unavailable')
    return
  }
  suppressPanelBlurHide(420)
  const settings = getAppSettings()
  selectionPasteContext = {
    shouldPaste: true,
    previousTarget: capturePasteTargetContext()
  }
  const { width, height } = getPanelSize()
  console.log('[ShearPlate] showPanel() before show', {
    settingsWindowX: settings.windowX,
    settingsWindowY: settings.windowY,
    width,
    height
  })
  const [currentWidth, currentHeight] = mainWindow.getSize()
  if (currentWidth !== width || currentHeight !== height) {
    mainWindow.setSize(width, height, false)
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (process.platform === 'darwin') {
    app.show()
    app.focus({ steal: true })
  }

  positionWindow(mainWindow, settings, { width, height, reservedWidth: PANEL_FULL_WIDTH })
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.focus()
  mainWindow.moveTop()

  if (process.platform !== 'darwin') {
    mainWindow.setAlwaysOnTop(true)
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.setAlwaysOnTop(false)
    }, 40)
    return
  }

  mainWindow.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    app.focus({ steal: true })
    mainWindow.moveTop()
    mainWindow.focus()
    mainWindow.webContents.focus()
  }, 16)
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.setVisibleOnAllWorkspaces(false)
  }, 120)
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.setAlwaysOnTop(false)
  }, 260)
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [x, y] = mainWindow.getPosition()
    const [nextWidth, nextHeight] = mainWindow.getSize()
    console.log('[ShearPlate] showPanel() after show', {
      visible: mainWindow.isVisible(),
      focused: mainWindow.isFocused(),
      x,
      y,
      width: nextWidth,
      height: nextHeight
    })
  }, 40)
}

async function commitSelection(item: ClipboardItem): Promise<boolean> {
  const touchedItem = touchClipboardItem(item.id)
  if (touchedItem && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clipboard:changed', stripClipboardItemPayload(touchedItem))
  }

  const committedItem =
    item.contentType === 'image' && !item.imagePath && !item.imagePreviewPath
      ? getClipboardItem(item.id) ?? item
      : item

  let usedRichClipboardPayload = false

  if (committedItem.contentType === 'text') {
    clipboard.writeText(committedItem.textContent ?? committedItem.filePath ?? '')
  } else if (
    committedItem.contentType === 'image' &&
    (committedItem.imageData || committedItem.imagePath || committedItem.imagePreviewPath)
  ) {
    const image = getClipboardNativeImage(committedItem) ?? (
      committedItem.imageData ? nativeImage.createFromDataURL(committedItem.imageData) : null
    )
    if (!image || image.isEmpty()) {
      return false
    }
    clipboard.writeImage(image)
    usedRichClipboardPayload = true
  } else if (committedItem.contentType === 'file') {
    const filePath = committedItem.filePath
    const canWriteAsImage = isImageFilePath(filePath)

    if (canWriteAsImage && filePath) {
      const imageFromPath = nativeImage.createFromPath(filePath)
      if (!imageFromPath.isEmpty()) {
        clipboard.writeImage(imageFromPath)
        usedRichClipboardPayload = true
      }
    }

    if (!usedRichClipboardPayload) {
      const wroteFileReference = writeClipboardFileReference(filePath)
      if (!wroteFileReference) {
        clipboard.writeText(filePath ?? '')
      }
      usedRichClipboardPayload = wroteFileReference
    }
  } else {
    return false
  }

  suppressNextClipboardCapture()

  shell.beep()
  const shouldPaste = selectionPasteContext.shouldPaste
  const previousTarget = selectionPasteContext.previousTarget
  hidePanel({ resetPasteContext: false, forPasteRelay: shouldPaste })
  resetSelectionPasteContext()

  if (shouldPaste) {
    const pasteDelayMs =
      process.platform === 'darwin'
        ? usedRichClipboardPayload ? 180 : 90
        : process.platform === 'win32'
          ? usedRichClipboardPayload ? 45 : 22
          : usedRichClipboardPayload ? 120 : 70
    await new Promise((resolve) => setTimeout(resolve, pasteDelayMs))
    const pasted = await pasteIntoPreviousTarget(previousTarget)
    if (!pasted) {
      console.warn('[ShearPlate] Paste relay did not complete successfully', { previousTarget })
    }
  }

  return true
}

// IPC handlers
ipcMain.handle('clipboard:read-text', () => clipboard.readText())
ipcMain.handle('clipboard:read-image', () => {
  const img = clipboard.readImage()
  return img.isEmpty() ? null : img.toDataURL()
})
ipcMain.handle('clipboard:write-text', (_e, text: string) => clipboard.writeText(text))
ipcMain.handle('clipboard:write-image', (_e, dataUrl: string) => {
  const img = nativeImage.createFromDataURL(dataUrl)
  clipboard.writeImage(img)
})
ipcMain.handle('clipboard:commit-selection', (_e, item: ClipboardItem) => commitSelection(item))

ipcMain.handle('window:show', () => showPanel())
ipcMain.handle('window:hide', () => hidePanel())
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:close-current', (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  ownerWindow?.close()
})
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return
  }
  mainWindow.maximize()
})

ipcMain.handle('theme:get-system', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

ipcMain.handle('system:get-file-preview', async (_event, filePath: string) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return null
  return getFilePreviewData(filePath.trim())
})

ipcMain.handle('settings:get', () => getAppSettings())
ipcMain.handle('settings:update', (_e, partial: Partial<AppSettings>) => {
  const currentSettings = getAppSettings()
  const normalizedPartial = normalizeSettingsPatch(partial, currentSettings)

  if (normalizedPartial.shortcut !== undefined) {
    const nextShortcut = normalizedPartial.shortcut
    if (!nextShortcut || !registerShortcut(nextShortcut)) {
      throw new Error('Shortcut registration failed')
    }

    const next = updateAppSettings({ ...normalizedPartial, shortcut: nextShortcut })
    if (currentSettings.shortcut !== nextShortcut) {
      console.log(`[ShearPlate] Shortcut updated to ${nextShortcut}`)
    }
    applyWindowBackgroundColor(next)
    broadcastSettingsChanged(next)
    return next
  }

  const next = updateAppSettings(normalizedPartial)
  if (normalizedPartial.maxHistory !== undefined || normalizedPartial.historyRetentionDays !== undefined) {
    applyClipboardRetentionPolicy()
  }
  applyWindowBackgroundColor(next)
  broadcastSettingsChanged(next)
  return next
})

// Store IPC
ipcMain.handle('store:get-items', (_e, limit?: number, offset?: number) => {
  return getClipboardItems(limit, offset)
})
ipcMain.handle('store:get-item', (_e, id: string) => {
  return getClipboardItem(id)
})
ipcMain.handle('store:get-image-preview', async (_e, id: string, mode: 'fast' | 'full' = 'fast') => {
  let item = getClipboardItem(id)
  if (!item || item.contentType !== 'image') {
    return null
  }

  if (!item.imagePath && !item.imagePreviewPath) {
    const materializedImage = await materializeClipboardImagePaths(item)
    if (materializedImage) {
      updateClipboardImageStorage(item.id, {
        imagePath: materializedImage.imagePath,
        imagePreviewPath: materializedImage.imagePreviewPath,
        imageWidth: materializedImage.width,
        imageHeight: materializedImage.height,
        fileSize: materializedImage.fileSize,
        contentHash: materializedImage.contentHash
      })

      const refreshedItem = getClipboardItem(id)
      if (refreshedItem && refreshedItem.contentType === 'image') {
        item = refreshedItem
      }
    }
  }

  return getStoredClipboardImagePreview(item, mode)
})
ipcMain.handle('store:search-items', (_e, query: string) => {
  return searchClipboardItems(query)
})
ipcMain.handle('store:toggle-star', (_e, id: string) => {
  return toggleStar(id)
})
ipcMain.handle('store:get-snippets', () => {
  return getSnippetItems()
})
ipcMain.handle('store:update-snippet', (_e, id: string, isSnippet: boolean, keyword: string | null) => {
  return updateSnippet(id, isSnippet, keyword)
})
ipcMain.handle('store:create-snippet', (_e, keyword: string, content: string) => {
  return createCustomSnippet(keyword, content)
})
ipcMain.handle('store:delete-item', (_e, id: string) => {
  return deleteClipboardItem(id)
})
ipcMain.handle('store:get-starred', () => {
  return getStarredItems()
})

// App lifecycle
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.shearplate')
  if (process.platform === 'darwin') {
    app.dock.hide()
  }
  registerClipboardImageProtocol()
  nativeTheme.on('updated', () => {
    const settings = getSafeSettings()
    if (settings.theme === 'system') {
      applyWindowBackgroundColor(settings)
    }
  })
  console.log('[ShearPlate] App ready, initializing...')

  try {
    await initDatabase()
    const removed = dedupeClipboardItems()
    if (removed > 0) {
      console.log(`[ShearPlate] Dedupe removed ${removed} duplicated clipboard item(s)`)
    }
    applyClipboardRetentionPolicy()
    console.log('[ShearPlate] Database initialized')
  } catch (err) {
    console.error('[ShearPlate] Database init failed:', err)
  }

  try {
    mainWindow = createWindow()
    console.log('[ShearPlate] Window prepared')
  } catch (err) {
    console.error('[ShearPlate] Window preparation failed:', err)
  }

  try {
    tray = createTray()
    console.log('[ShearPlate] Tray created')
  } catch (err) {
    console.error('[ShearPlate] Tray creation failed:', err)
  }

  if (registerShortcut()) {
    console.log(`[ShearPlate] Shortcut registered (${activeShortcut})`)
  } else if (
    getAppSettings().shortcut !== DEFAULT_APP_SETTINGS.shortcut &&
    registerShortcut(DEFAULT_APP_SETTINGS.shortcut)
  ) {
    updateAppSettings({ shortcut: DEFAULT_APP_SETTINGS.shortcut })
    console.warn(`[ShearPlate] Falling back to default shortcut (${DEFAULT_APP_SETTINGS.shortcut})`)
  } else {
    console.error('[ShearPlate] Failed to register global shortcut')
  }

  startClipboardWatcher()
  console.log('[ShearPlate] Clipboard watcher started — app running in tray')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
}).catch(err => {
  console.error('[ShearPlate] Fatal startup error:', err)
})

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
})

app.on('before-quit', (event) => {
  if (isQuittingAfterFlush) {
    return
  }

  event.preventDefault()
  stopClipboardWatcher()
  globalShortcut.unregisterAll()
  flushPendingWindowPosition()

  void saveDbNow(true)
    .catch((error) => {
      console.error('[ShearPlate] Final database flush failed before quit:', error)
    })
    .finally(() => {
      isQuittingAfterFlush = true
      app.quit()
    })
})
