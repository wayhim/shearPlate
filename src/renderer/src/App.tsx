import { useEffect, useCallback, useRef, useState, useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import { SearchBar } from './components/SearchBar'
import { FilterBar } from './components/FilterBar'
import { HistoryList } from './components/HistoryList'
import { SettingsPanel } from './components/SettingsPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { SnippetComposer } from './components/SnippetComposer'
import { useClipboardStore, type FilterType } from './stores/clipboard'
import { DEFAULT_APP_SETTINGS } from '../../shared/types'
import type { AppSettings, ThemeMode } from '../../shared/types'
import { PANEL_COLLAPSED_WIDTH, PANEL_PREVIEW_WIDTH } from '../../shared/layout'
import { shouldDeferHotkeysToIme } from './lib/ime'

const api = typeof window !== 'undefined' ? window.api : undefined
const APP_VIEW = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null
const PANEL_TOTAL_WIDTH = PANEL_COLLAPSED_WIDTH + PANEL_PREVIEW_WIDTH
const PANEL_MAX_PANE_RATIO = 3
const DEFAULT_LIST_WIDTH_RATIO = PANEL_COLLAPSED_WIDTH / PANEL_TOTAL_WIDTH
const IMAGE_PRELOAD_NEIGHBOR_RANGE = 2
const PREVIEW_SYNC_DELAY_MS = 32

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getPaneWidthBounds(totalWidth: number): { minPaneWidth: number; maxPaneWidth: number } {
  const minPaneWidth = totalWidth / (PANEL_MAX_PANE_RATIO + 1)
  return {
    minPaneWidth,
    maxPaneWidth: totalWidth - minPaneWidth
  }
}

function useManagedSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [isReady, setIsReady] = useState(false)
  const previousSettingsRef = useRef<AppSettings>(DEFAULT_APP_SETTINGS)
  const systemThemeRef = useRef<'light' | 'dark'>('light')

  const applyResolvedTheme = useCallback((themeMode: ThemeMode, nextSystemTheme?: 'light' | 'dark') => {
    const resolvedTheme = themeMode === 'system' ? nextSystemTheme ?? systemThemeRef.current : themeMode
    useClipboardStore.getState().setTheme(resolvedTheme)
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [])

  useEffect(() => {
    if (!api) return

    let cancelled = false

    void api.theme.getSystem().then((sysTheme) => {
      if (cancelled) return

      const nextSystemTheme = sysTheme === 'dark' ? 'dark' : 'light'
      systemThemeRef.current = nextSystemTheme

      void api.settings.get().then((savedSettings) => {
        if (cancelled) return

        previousSettingsRef.current = savedSettings
        setSettings(savedSettings)
        applyResolvedTheme(savedSettings.theme, nextSystemTheme)
        setIsReady(true)
      })
    })

    const dispose = api.settings.onChanged((nextSettings) => {
      previousSettingsRef.current = nextSettings
      setSettings(nextSettings)
      applyResolvedTheme(nextSettings.theme)
      setIsReady(true)
    })

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [applyResolvedTheme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const updateSystemTheme = (matches: boolean) => {
      const nextSystemTheme = matches ? 'dark' : 'light'
      systemThemeRef.current = nextSystemTheme
      if (previousSettingsRef.current.theme === 'system') {
        applyResolvedTheme('system', nextSystemTheme)
      }
    }

    updateSystemTheme(media.matches)

    const listener = (event: MediaQueryListEvent) => updateSystemTheme(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [applyResolvedTheme])

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const previousSettings = previousSettingsRef.current
    const optimisticSettings = { ...previousSettings, ...partial }

    previousSettingsRef.current = optimisticSettings
    setSettings(optimisticSettings)

    if (partial.theme) {
      applyResolvedTheme(partial.theme)
    }

    try {
      const updated = await api?.settings.update(partial)
      if (!updated) return null

      previousSettingsRef.current = updated
      setSettings(updated)
      applyResolvedTheme(updated.theme)
      return updated
    } catch {
      previousSettingsRef.current = previousSettings
      setSettings(previousSettings)
      applyResolvedTheme(previousSettings.theme)
      return null
    }
  }, [applyResolvedTheme])

  return { settings, isReady, updateSettings }
}

function SettingsWindowApp() {
  const { settings, isReady, updateSettings } = useManagedSettings()

  return (
    <div className="preview-stage relative flex h-screen w-screen">
      <SettingsPanel
        language={settings.language}
        settings={settings}
        loading={!isReady}
        onChange={updateSettings}
        onClose={() => void api?.window.closeCurrent()}
      />
    </div>
  )
}

function ClipboardApp() {
  const {
    fetchItems,
    loadMoreItems,
    searchItems,
    setQuery,
    setFilter,
    filter,
    query,
    items,
    loading,
    loadingMore,
    hasMore
  } = useClipboardStore()
  const { settings, isReady } = useManagedSettings()
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const hoverSelectionFrameRef = useRef<number | null>(null)
  const hoverPendingIdRef = useRef<string | null>(null)
  const panelLayoutRef = useRef<HTMLDivElement>(null)
  const resizeStateRef = useRef<{ startX: number; startListWidth: number } | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewSelectedId, setPreviewSelectedId] = useState<string | null>(null)
  const [searchFocusKey, setSearchFocusKey] = useState(0)
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false)
  const [isResizingLayout, setIsResizingLayout] = useState(false)
  const [panelWidth, setPanelWidth] = useState(PANEL_TOTAL_WIDTH)
  const [listWidthRatio, setListWidthRatio] = useState(DEFAULT_LIST_WIDTH_RATIO)

  useEffect(() => {
    const dispose = api?.clipboard.onChanged((item) => {
      useClipboardStore.getState().addItem(item)
    })

    return () => {
      dispose?.()
    }
  }, [])

  useEffect(() => {
    if (!isReady) return
    void fetchItems()
    setSearchFocusKey((prev) => prev + 1)
  }, [fetchItems, isReady, settings.historyRetentionDays, settings.maxHistory])

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null)
      setPreviewSelectedId(null)
      return
    }

    setSelectedId((prev) => (prev && items.some((item) => item.id === prev) ? prev : items[0].id))
  }, [items])

  useEffect(() => {
    if (!selectedId) {
      setPreviewSelectedId(null)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setPreviewSelectedId(selectedId)
    }, PREVIEW_SYNC_DELAY_MS)

    return () => window.clearTimeout(timeoutId)
  }, [selectedId])

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value)
      clearTimeout(searchTimer.current)
      searchTimer.current = setTimeout(() => {
        if (api) {
          searchItems(value)
        }
      }, 180)
    },
    [searchItems, setQuery]
  )

  const handleFilterChange = useCallback(
    (nextFilter: FilterType) => {
      setFilter(nextFilter)
      if (query.trim()) {
        void searchItems(query, nextFilter)
        return
      }
      void useClipboardStore.getState().fetchItems(undefined, nextFilter)
    },
    [query, searchItems, setFilter]
  )

  const handleCommitItem = useCallback(async (item: (typeof items)[number]) => {
    await api?.clipboard.commitSelection(item)
  }, [])

  const handleListSnippetToggle = useCallback(async (item: (typeof items)[number]) => {
    return useClipboardStore.getState().handleSnippetUpdate(
      item.id,
      !item.isSnippet,
      item.isSnippet ? null : item.snippetKeyword
    )
  }, [])

  const handleHistorySnippetToggle = useCallback((item: (typeof items)[number]) => {
    void handleListSnippetToggle(item)
  }, [handleListSnippetToggle])

  const handleSelectItem = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? prev : id))
  }, [])

  const handleHoverSelectItem = useCallback((id: string) => {
    hoverPendingIdRef.current = id
    if (hoverSelectionFrameRef.current !== null) {
      return
    }

    hoverSelectionFrameRef.current = window.requestAnimationFrame(() => {
      hoverSelectionFrameRef.current = null
      const nextId = hoverPendingIdRef.current
      if (!nextId) return
      setSelectedId((prev) => (prev === nextId ? prev : nextId))
    })
  }, [])

  const handleCreateSnippet = useCallback(async (keyword: string, content: string) => {
    return useClipboardStore.getState().handleCreateSnippet(keyword, content)
  }, [])

  const visibleItems = items
  const showSnippetComposer = filter === 'snippet'
  const isPreviewVisible = settings.showPreview
  const visibleItemIndexById = useMemo(() => {
    const indexMap = new Map<string, number>()
    for (let index = 0; index < visibleItems.length; index += 1) {
      indexMap.set(visibleItems[index].id, index)
    }
    return indexMap
  }, [visibleItems])
  const selectedVisibleIndex = useMemo(
    () => (selectedId ? (visibleItemIndexById.get(selectedId) ?? -1) : -1),
    [selectedId, visibleItemIndexById]
  )
  const previewVisibleIndex = useMemo(
    () => (previewSelectedId ? (visibleItemIndexById.get(previewSelectedId) ?? -1) : -1),
    [previewSelectedId, visibleItemIndexById]
  )
  const selectedItem = useMemo(
    () => (previewVisibleIndex >= 0 ? visibleItems[previewVisibleIndex] : null),
    [previewVisibleIndex, visibleItems]
  )
  const imagePreloadItems = useMemo(
    () => {
      if (!isPreviewVisible || previewVisibleIndex < 0 || !visibleItems.length) {
        return []
      }

      const startIndex = Math.max(0, previewVisibleIndex - IMAGE_PRELOAD_NEIGHBOR_RANGE)
      const endIndex = Math.min(visibleItems.length - 1, previewVisibleIndex + IMAGE_PRELOAD_NEIGHBOR_RANGE)
      const preloadCandidates: typeof visibleItems = []

      for (let index = startIndex; index <= endIndex; index += 1) {
        if (index === previewVisibleIndex) continue
        const candidate = visibleItems[index]
        if (candidate.contentType !== 'image') continue
        preloadCandidates.push(candidate)
      }

      return preloadCandidates
    },
    [isPreviewVisible, previewVisibleIndex, visibleItems]
  )
  const { minPaneWidth, maxPaneWidth } = useMemo(() => getPaneWidthBounds(panelWidth), [panelWidth])
  const listPaneWidth = useMemo(
    () => (isPreviewVisible ? clamp(panelWidth * listWidthRatio, minPaneWidth, maxPaneWidth) : panelWidth),
    [isPreviewVisible, listWidthRatio, maxPaneWidth, minPaneWidth, panelWidth]
  )
  const previewPaneWidth = isPreviewVisible ? Math.max(panelWidth - listPaneWidth, 0) : 0

  useEffect(() => {
    const handleWindowFocus = () => {
      setSearchFocusKey((prev) => prev + 1)
    }

    window.addEventListener('focus', handleWindowFocus)
    return () => window.removeEventListener('focus', handleWindowFocus)
  }, [])

  useEffect(() => {
    if (isPreviewFullscreen && !selectedId) {
      setIsPreviewFullscreen(false)
    }
  }, [isPreviewFullscreen, selectedId])

  useEffect(() => {
    if (!isPreviewVisible && isPreviewFullscreen) {
      setIsPreviewFullscreen(false)
    }
  }, [isPreviewFullscreen, isPreviewVisible])

  useEffect(() => {
    return () => {
      clearTimeout(searchTimer.current)
      if (hoverSelectionFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverSelectionFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const panelNode = panelLayoutRef.current
    if (!panelNode) return

    const updatePanelWidth = (nextWidth: number) => {
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return
      setPanelWidth(nextWidth)
    }

    updatePanelWidth(panelNode.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      updatePanelWidth(entry.contentRect.width)
    })

    observer.observe(panelNode)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const scrollingTimers = new Map<HTMLElement, number>()

    const handleScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const scrollContainer = target.closest('.panel-scrollbar')
      if (!(scrollContainer instanceof HTMLElement)) return

      scrollContainer.dataset.scrolling = 'true'
      const existingTimer = scrollingTimers.get(scrollContainer)
      if (existingTimer) {
        window.clearTimeout(existingTimer)
      }

      const timeoutId = window.setTimeout(() => {
        delete scrollContainer.dataset.scrolling
        scrollingTimers.delete(scrollContainer)
      }, 420)

      scrollingTimers.set(scrollContainer, timeoutId)
    }

    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('scroll', handleScroll, true)
      scrollingTimers.forEach((timeoutId) => window.clearTimeout(timeoutId))
      scrollingTimers.clear()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return
      }

      if (shouldDeferHotkeysToIme(event)) {
        return
      }

      event.preventDefault()

      if (isPreviewFullscreen) {
        setIsPreviewFullscreen(false)
        return
      }

      void api?.window.hide()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPreviewFullscreen])

  const handleTogglePreviewFullscreen = useCallback(() => {
    setIsPreviewFullscreen((current) => !current)
  }, [])

  const clearResizeListeners = useCallback(() => {
    resizeCleanupRef.current?.()
    resizeCleanupRef.current = null
  }, [])

  const stopLayoutResize = useCallback(() => {
    clearResizeListeners()
    resizeStateRef.current = null
    setIsResizingLayout(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [clearResizeListeners])

  useEffect(() => {
    return () => {
      clearResizeListeners()
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [clearResizeListeners])

  useEffect(() => {
    if (isPreviewFullscreen && isResizingLayout) {
      stopLayoutResize()
    }
  }, [isPreviewFullscreen, isResizingLayout, stopLayoutResize])

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isPreviewFullscreen) return

      event.preventDefault()
      event.stopPropagation()
      clearResizeListeners()

      resizeStateRef.current = {
        startX: event.clientX,
        startListWidth: listPaneWidth
      }

      setIsResizingLayout(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const resizeState = resizeStateRef.current
        if (!resizeState) return

        const totalWidth = panelLayoutRef.current?.getBoundingClientRect().width || panelWidth
        const { minPaneWidth, maxPaneWidth } = getPaneWidthBounds(totalWidth)
        const deltaX = moveEvent.clientX - resizeState.startX
        const nextListWidth = clamp(resizeState.startListWidth + deltaX, minPaneWidth, maxPaneWidth)
        setListWidthRatio(nextListWidth / totalWidth)
      }

      const handlePointerUp = () => {
        stopLayoutResize()
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointercancel', handlePointerUp, { once: true })
      window.addEventListener('pointerup', handlePointerUp, { once: true })
      resizeCleanupRef.current = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointercancel', handlePointerUp)
        window.removeEventListener('pointerup', handlePointerUp)
      }
    },
    [clearResizeListeners, isPreviewFullscreen, listPaneWidth, panelWidth, stopLayoutResize]
  )

  return (
    <div
      className="preview-stage relative flex h-screen w-screen justify-start"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          void window.api?.window.hide()
        }
      }}
    >
      <div
        className="window-shell frosted pointer-events-auto relative flex h-full flex-col overflow-hidden rounded-[18px] bg-[var(--color-window-bg)] shadow-[var(--shadow-window)]"
        style={{ width: '100%' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          ref={panelLayoutRef}
          className={`relative grid min-h-0 flex-1 gap-0 transition-[grid-template-columns] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isResizingLayout ? 'duration-0' : 'duration-[140ms]'
          }`}
          style={{
            gridTemplateColumns: isPreviewVisible
              ? (isPreviewFullscreen ? '0px minmax(0,1fr)' : `${listPaneWidth}px ${previewPaneWidth}px`)
              : 'minmax(0,1fr)'
          }}
        >
          {isPreviewVisible && !isPreviewFullscreen ? (
            <div
              role="separator"
              aria-label="调整列表与预览宽度"
              aria-orientation="vertical"
              onPointerDown={handleResizePointerDown}
              className="group absolute inset-y-2 z-20 flex w-4 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
              style={{ left: `${listPaneWidth}px` }}
            >
              <div
                className={`pointer-events-none h-14 w-1 rounded-full bg-[var(--color-border-strong)] transition-opacity duration-100 ${
                  isResizingLayout ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              />
            </div>
          ) : null}
          <div
            className={`min-h-0 h-full overflow-hidden transition-[opacity,transform] duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isPreviewFullscreen ? 'pointer-events-none -translate-x-4 opacity-0' : 'translate-x-0 opacity-100'
            }`}
          >
            <div className="flex h-full min-h-0 flex-col px-2 pb-2 pt-2">
              <div
                className={`overflow-hidden transition-all duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isPreviewFullscreen ? 'max-h-0 translate-y-[-8px] opacity-0' : 'max-h-40'
                }`}
              >
                <div className="px-1 pb-0 pt-0.5">
                  <div className="titlebar-drag h-3 rounded-[10px]" />
                  <div className="mt-2 space-y-2">
                    <SearchBar value={query} language={settings.language} onSearch={handleSearch} focusKey={searchFocusKey} />
                    <FilterBar onFilterChange={handleFilterChange} activeFilter={filter} language={settings.language} />
                  </div>
                </div>
              </div>

              <div className="h-2 shrink-0" />

              {showSnippetComposer ? (
                <SnippetComposer
                  language={settings.language}
                  onCreate={handleCreateSnippet}
                  onCreated={(created) => {
                    setSelectedId(created.id)
                  }}
                />
              ) : null}

              <div className="min-h-0 flex-1 overflow-hidden">
                <HistoryList
                  language={settings.language}
                  items={visibleItems}
                  loading={loading}
                  loadingMore={loadingMore}
                  canLoadMore={hasMore && !query.trim()}
                  onLoadMore={loadMoreItems}
                  selectedId={selectedId}
                  onSelect={handleSelectItem}
                  onHoverSelect={handleHoverSelectItem}
                  onCommit={handleCommitItem}
                  onSnippetToggle={handleHistorySnippetToggle}
                />
              </div>
            </div>
          </div>
          {isPreviewVisible ? (
            <div
              className={`min-h-0 h-full overflow-hidden transition-[opacity,transform,padding] duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                isPreviewFullscreen ? 'translate-x-0 px-2.5 pb-2.5 pt-2.5 opacity-100' : 'translate-x-0 pl-3 pr-2 pb-2 pt-2 opacity-100'
              }`}
            >
              <PreviewPanel
                item={selectedItem}
                preloadItems={imagePreloadItems}
                language={settings.language}
                fullscreen={isPreviewFullscreen}
                onToggleFullscreen={selectedItem ? handleTogglePreviewFullscreen : undefined}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return APP_VIEW === 'settings' ? <SettingsWindowApp /> : <ClipboardApp />
}
