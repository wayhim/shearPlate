import { contextBridge, ipcRenderer } from 'electron'
import type { ClipboardItem, ContentType, ThemeMode, AppSettings } from '../shared/types'

type StoreFilter = 'all' | ContentType | 'starred' | 'snippet'

const api = {
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read-text'),
    readImage: (): Promise<string | null> => ipcRenderer.invoke('clipboard:read-image'),
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write-text', text),
    writeImage: (dataUrl: string): Promise<void> => ipcRenderer.invoke('clipboard:write-image', dataUrl),
    commitSelection: (item: ClipboardItem): Promise<boolean> => ipcRenderer.invoke('clipboard:commit-selection', item),
    onChanged: (callback: (item: ClipboardItem) => void) => {
      const listener = (_event: unknown, item: ClipboardItem) => callback(item)
      ipcRenderer.on('clipboard:changed', listener)
      return () => ipcRenderer.removeListener('clipboard:changed', listener)
    }
  },
  store: {
    getItems: (limit?: number, offset?: number, filter?: StoreFilter): Promise<ClipboardItem[]> =>
      ipcRenderer.invoke('store:get-items', limit, offset, filter),
    getItem: (id: string): Promise<ClipboardItem | null> =>
      ipcRenderer.invoke('store:get-item', id),
    getImagePreview: (id: string, mode: 'fast' | 'full' = 'fast'): Promise<string | null> =>
      ipcRenderer.invoke('store:get-image-preview', id, mode),
    searchItems: (query: string, filter?: StoreFilter): Promise<ClipboardItem[]> =>
      ipcRenderer.invoke('store:search-items', query, filter),
    getSnippets: (): Promise<ClipboardItem[]> =>
      ipcRenderer.invoke('store:get-snippets'),
    createSnippet: (keyword: string, content: string): Promise<ClipboardItem | null> =>
      ipcRenderer.invoke('store:create-snippet', keyword, content),
    toggleStar: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('store:toggle-star', id),
    updateSnippet: (id: string, isSnippet: boolean, keyword: string | null): Promise<ClipboardItem | null> =>
      ipcRenderer.invoke('store:update-snippet', id, isSnippet, keyword),
    deleteItem: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('store:delete-item', id),
    getStarred: (): Promise<ClipboardItem[]> =>
      ipcRenderer.invoke('store:get-starred')
  },
  theme: {
    getSystem: (): Promise<ThemeMode> => ipcRenderer.invoke('theme:get-system')
  },
  system: {
    getFilePreview: (filePath: string): Promise<string | null> => ipcRenderer.invoke('system:get-file-preview', filePath)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (partial: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:update', partial),
    onChanged: (callback: (settings: AppSettings) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },
  window: {
    show: (): Promise<void> => ipcRenderer.invoke('window:show'),
    hide: (): Promise<void> => ipcRenderer.invoke('window:hide'),
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
    closeCurrent: (): Promise<void> => ipcRenderer.invoke('window:close-current')
  }
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('api', api)
