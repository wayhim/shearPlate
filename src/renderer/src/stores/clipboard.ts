import { create } from 'zustand'
import type { ClipboardItem, ContentType, ThemeMode } from '../../../shared/types'

export type FilterType = 'all' | ContentType | 'starred' | 'snippet'
const DEFAULT_INITIAL_LOAD_SIZE = 50

function matchesFilter(item: ClipboardItem, filter: FilterType): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'text':
    case 'image':
    case 'file':
      return item.contentType === filter
    case 'starred':
      return item.isStarred
    case 'snippet':
      return item.isSnippet
    default:
      return true
  }
}

function appendUniqueById(currentItems: ClipboardItem[], nextItems: ClipboardItem[]): ClipboardItem[] {
  const existingIds = new Set(currentItems.map((item) => item.id))
  const merged = [...currentItems]
  for (const item of nextItems) {
    if (existingIds.has(item.id)) continue
    existingIds.add(item.id)
    merged.push(item)
  }
  return merged
}

interface ClipboardState {
  items: ClipboardItem[]
  query: string
  filter: FilterType
  theme: ThemeMode
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  loadedCount: number

  setItems: (items: ClipboardItem[]) => void
  addItem: (item: ClipboardItem) => void
  removeItem: (id: string) => void
  toggleStar: (id: string) => void
  updateItem: (item: ClipboardItem) => void
  setQuery: (query: string) => void
  setFilter: (filter: FilterType) => void
  setTheme: (theme: ThemeMode) => void
  setLoading: (loading: boolean) => void

  fetchItems: (limit?: number, nextFilter?: FilterType) => Promise<void>
  loadMoreItems: () => Promise<void>
  searchItems: (query: string, nextFilter?: FilterType) => Promise<void>
  handleToggleStar: (id: string) => Promise<void>
  handleSnippetUpdate: (id: string, isSnippet: boolean, keyword: string | null) => Promise<ClipboardItem | null>
  handleCreateSnippet: (keyword: string, content: string) => Promise<ClipboardItem | null>
  handleDelete: (id: string) => Promise<void>
}

export const useClipboardStore = create<ClipboardState>((set, get) => ({
  items: [],
  query: '',
  filter: 'all',
  theme: 'system',
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadedCount: 0,

  setItems: (items) => set({ items }),
  addItem: (item) =>
    set((s) => {
      if (s.query.trim() || !matchesFilter(item, s.filter)) {
        return s
      }

      const nextItems = [item, ...s.items.filter((i) => i.id !== item.id && i.contentHash !== item.contentHash)]
      return {
        items: nextItems,
        loadedCount: nextItems.length
      }
    }),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  toggleStar: (id) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, isStarred: !i.isStarred } : i))
    })),
  updateItem: (item) =>
    set((s) => ({
      items: s.items.map((current) => (current.id === item.id ? item : current))
    })),
  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
  setTheme: (theme) => set({ theme }),
  setLoading: (loading) => set({ loading }),

  fetchItems: async (limit = DEFAULT_INITIAL_LOAD_SIZE, nextFilter?: FilterType) => {
    set({ loading: true })
    try {
      const effectiveFilter = nextFilter ?? get().filter
      const items = await window.api.store.getItems(limit, 0, effectiveFilter)
      set({
        items,
        loading: false,
        loadingMore: false,
        hasMore: items.length >= limit,
        loadedCount: items.length
      })
    } catch {
      set({ loading: false, loadingMore: false })
    }
  },

  loadMoreItems: async () => {
    const { query, filter, loading, loadingMore, loadedCount } = get()
    if (loading || loadingMore) return
    if (query.trim()) return

    set({ loadingMore: true })
    try {
      const nextItems = await window.api.store.getItems(DEFAULT_INITIAL_LOAD_SIZE, loadedCount, filter)
      set((state) => ({
        items: appendUniqueById(state.items, nextItems),
        loadingMore: false,
        hasMore: nextItems.length >= DEFAULT_INITIAL_LOAD_SIZE,
        loadedCount: loadedCount + nextItems.length
      }))
    } catch {
      set({ loadingMore: false })
    }
  },

  searchItems: async (query: string, nextFilter?: FilterType) => {
    if (!query.trim()) {
      return get().fetchItems(DEFAULT_INITIAL_LOAD_SIZE, nextFilter)
    }
    set({ loading: true })
    try {
      const effectiveFilter = nextFilter ?? get().filter
      const items = await window.api.store.searchItems(query, effectiveFilter)
      set({ items, loading: false, loadingMore: false, hasMore: false, loadedCount: items.length })
    } catch {
      set({ loading: false })
    }
  },

  handleToggleStar: async (id: string) => {
    await window.api.store.toggleStar(id)
    if (get().filter === 'starred') {
      await get().fetchItems()
      return
    }
    get().toggleStar(id)
  },

  handleSnippetUpdate: async (id: string, isSnippet: boolean, keyword: string | null) => {
    const updated = await window.api.store.updateSnippet(id, isSnippet, keyword)
    const { filter, query } = get()
    if (query.trim() || filter === 'snippet' || !updated) {
      if (query.trim()) {
        await get().searchItems(query, filter)
      } else {
        await get().fetchItems(DEFAULT_INITIAL_LOAD_SIZE, filter)
      }
      return updated
    }

    get().updateItem(updated)
    return updated
  },

  handleCreateSnippet: async (keyword: string, content: string) => {
    const created = await window.api.store.createSnippet(keyword, content)
    if (!created) return null

    const { filter, query } = get()
    if (query.trim()) {
      await get().searchItems(query, filter)
      return created
    }

    if (matchesFilter(created, filter)) {
      get().addItem(created)
      return created
    }

    await get().fetchItems(DEFAULT_INITIAL_LOAD_SIZE, filter)
    return created
  },

  handleDelete: async (id: string) => {
    await window.api.store.deleteItem(id)
    get().removeItem(id)
  }
}))
