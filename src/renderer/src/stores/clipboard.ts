import { create } from 'zustand'
import type { ClipboardItem, ContentType, ThemeMode } from '../../../shared/types'

export type FilterType = 'all' | ContentType | 'starred' | 'snippet'
const DEFAULT_INITIAL_LOAD_SIZE = 50

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

  fetchItems: (limit?: number) => Promise<void>
  loadMoreItems: () => Promise<void>
  searchItems: (query: string) => Promise<void>
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
    set((s) => ({
      items: [item, ...s.items.filter((i) => i.id !== item.id && i.contentHash !== item.contentHash)]
    })),
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

  fetchItems: async (limit = DEFAULT_INITIAL_LOAD_SIZE) => {
    set({ loading: true })
    try {
      const { filter } = get()
      let items: ClipboardItem[]
      if (filter === 'starred') {
        items = await window.api.store.getStarred()
        set({ items, loading: false, loadingMore: false, hasMore: false, loadedCount: items.length })
        return
      } else if (filter === 'snippet') {
        items = await window.api.store.getSnippets()
        set({ items, loading: false, loadingMore: false, hasMore: false, loadedCount: items.length })
        return
      } else {
        items = await window.api.store.getItems(limit, 0)
      }
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
    if (filter === 'starred' || filter === 'snippet') return

    set({ loadingMore: true })
    try {
      const nextItems = await window.api.store.getItems(DEFAULT_INITIAL_LOAD_SIZE, loadedCount)
      set((state) => ({
        items: [...state.items, ...nextItems.filter((item) => !state.items.some((existing) => existing.id === item.id))],
        loadingMore: false,
        hasMore: nextItems.length >= DEFAULT_INITIAL_LOAD_SIZE,
        loadedCount: loadedCount + nextItems.length
      }))
    } catch {
      set({ loadingMore: false })
    }
  },

  searchItems: async (query: string) => {
    if (!query.trim()) {
      return get().fetchItems()
    }
    set({ loading: true })
    try {
      const items = await window.api.store.searchItems(query)
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
        await get().searchItems(query)
      } else {
        await get().fetchItems()
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
      await get().searchItems(query)
      return created
    }

    if (filter === 'all' || filter === 'text' || filter === 'snippet') {
      get().addItem(created)
      return created
    }

    await get().fetchItems()
    return created
  },

  handleDelete: async (id: string) => {
    await window.api.store.deleteItem(id)
    get().removeItem(id)
  }
}))
