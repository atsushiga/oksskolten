import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFeedDragDrop } from './use-feed-drag-drop'
import type { FeedWithCounts, Category } from '../../shared/types'

vi.mock('../lib/fetcher', () => ({
  apiPatch: vi.fn().mockResolvedValue(undefined),
  apiPost: vi.fn().mockResolvedValue(undefined),
}))

import { apiPatch } from '../lib/fetcher'

function makeFeed(overrides: Partial<FeedWithCounts> = {}): FeedWithCounts {
  return {
    id: 1,
    name: 'Test Feed',
    url: 'https://example.com',
    rss_url: null,
    rss_bridge_url: null,
    category_id: null,
    sort_order: 0,
    last_error: null,
    error_count: 0,
    disabled: 0,
    requires_js_challenge: 0,
    type: 'rss',
    etag: null,
    last_modified: null,
    last_content_hash: null,
    next_check_at: null,
    check_interval: null,
    created_at: '2024-01-01',
    category_name: null,
    article_count: 10,
    unread_count: 5,
    articles_per_week: 2,
    latest_published_at: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    name: 'Tech',
    sort_order: 0,
    collapsed: 0,
    created_at: '2024-01-01',
    ...overrides,
  }
}

function makeDragEvent(overrides: Partial<Record<string, unknown>> = {}): React.DragEvent {
  const data = new Map<string, string>()
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clientY: 10,
    dataTransfer: {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      effectAllowed: 'uninitialized',
      dropEffect: 'none',
    },
    currentTarget: {
      contains: () => false,
      getBoundingClientRect: () => ({ top: 0, height: 20 }),
    },
    relatedTarget: null,
    ...overrides,
  } as unknown as React.DragEvent
}

describe('useFeedDragDrop', () => {
  const feeds = [
    makeFeed({ id: 1, category_id: null, sort_order: 0 }),
    makeFeed({ id: 2, category_id: null, sort_order: 1 }),
    makeFeed({ id: 3, category_id: 3, sort_order: 0 }),
  ]
  const categories = [makeCategory({ id: 3 }), makeCategory({ id: 4, name: 'News', sort_order: 1 })]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mutateFeeds: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mutateCategories: any

  beforeEach(() => {
    vi.clearAllMocks()
    mutateFeeds = vi.fn()
    mutateCategories = vi.fn()
  })

  it('initializes with no drag state', () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    expect(result.current.dragOverTarget).toBeNull()
    expect(result.current.feedInsertIndicator).toBeNull()
    expect(result.current.categoryInsertIndicator).toBeNull()
    expect(result.current.isDragging).toBe(false)
  })

  it('handleDragStart sets feed drag payload', () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const event = makeDragEvent()

    act(() => result.current.handleDragStart(event, feeds[0]))

    expect(result.current.isDragging).toBe(true)
    expect(event.dataTransfer.effectAllowed).toBe('move')
    expect(event.dataTransfer.getData('application/x-feed-ids')).toBe(JSON.stringify([1]))
    expect(event.dataTransfer.getData('application/x-sidebar-kind')).toBe('feed')
  })

  it('handleCategoryDragStart sets category drag payload', () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const event = makeDragEvent()

    act(() => result.current.handleCategoryDragStart(event, categories[0]))

    expect(result.current.isDragging).toBe(true)
    expect(event.dataTransfer.getData('application/x-category-id')).toBe('3')
    expect(event.dataTransfer.getData('application/x-sidebar-kind')).toBe('category')
  })

  it('handleDragOver sets dropEffect and dragOverTarget for feed moves', () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const event = makeDragEvent()
    event.dataTransfer.setData('application/x-sidebar-kind', 'feed')

    act(() => result.current.handleDragOver(event, 5))

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.dataTransfer.dropEffect).toBe('move')
    expect(result.current.dragOverTarget).toBe(5)
  })

  it('handleDrop moves feed to new category via optimistic update', async () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const dropEvent = makeDragEvent()
    dropEvent.dataTransfer.setData('application/x-sidebar-kind', 'feed')
    dropEvent.dataTransfer.setData('application/x-feed-ids', JSON.stringify([1]))

    await act(async () => {
      await result.current.handleDrop(dropEvent, 5)
    })

    expect(dropEvent.preventDefault).toHaveBeenCalled()
    expect(result.current.isDragging).toBe(false)
    expect(mutateFeeds).toHaveBeenCalledWith(expect.any(Function), { revalidate: false })
    expect(apiPatch).toHaveBeenCalledWith('/api/feeds/1', { category_id: 5 })
  })

  it('handleDrop falls back to text/plain payload', async () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const dropEvent = makeDragEvent()
    dropEvent.dataTransfer.setData('text/plain', 'feed:1')

    await act(async () => {
      await result.current.handleDrop(dropEvent, 5)
    })

    expect(apiPatch).toHaveBeenCalledWith('/api/feeds/1', { category_id: 5 })
  })

  it('handleFeedReorderDrop reorders feeds within the same category', async () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const event = makeDragEvent({ clientY: 18 })
    event.dataTransfer.setData('application/x-sidebar-kind', 'feed')
    event.dataTransfer.setData('application/x-feed-ids', JSON.stringify([1]))

    await act(async () => {
      await result.current.handleFeedReorderDrop(event, feeds[1])
    })

    expect(event.stopPropagation).toHaveBeenCalled()
    expect(apiPatch).toHaveBeenCalledWith('/api/feeds/reorder', { feed_ids: [2, 1], category_id: null })
  })

  it('handleFeedReorderDrop ignores cross-category targets', async () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const event = makeDragEvent()
    event.dataTransfer.setData('application/x-sidebar-kind', 'feed')
    event.dataTransfer.setData('application/x-feed-ids', JSON.stringify([1]))

    await act(async () => {
      await result.current.handleFeedReorderDrop(event, feeds[2])
    })

    expect(apiPatch).not.toHaveBeenCalled()
  })

  it('handleCategoryReorderDrop reorders categories', async () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const event = makeDragEvent({ clientY: 18 })
    event.dataTransfer.setData('application/x-sidebar-kind', 'category')
    event.dataTransfer.setData('application/x-category-id', '3')

    await act(async () => {
      await result.current.handleCategoryReorderDrop(event, categories[1])
    })

    expect(event.stopPropagation).toHaveBeenCalled()
    expect(apiPatch).toHaveBeenCalledWith('/api/categories/reorder', { category_ids: [4, 3] })
  })

  it('handleCategoryReorderDrop falls back to text/plain payload', async () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const event = makeDragEvent({ clientY: 18 })
    event.dataTransfer.setData('text/plain', 'category:3')

    await act(async () => {
      await result.current.handleCategoryReorderDrop(event, categories[1])
    })

    expect(apiPatch).toHaveBeenCalledWith('/api/categories/reorder', { category_ids: [4, 3] })
  })

  it('handleDrop revalidates on API failure', async () => {
    vi.mocked(apiPatch).mockRejectedValueOnce(new Error('Network error'))
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const dropEvent = makeDragEvent()
    dropEvent.dataTransfer.setData('application/x-sidebar-kind', 'feed')
    dropEvent.dataTransfer.setData('application/x-feed-ids', JSON.stringify([1]))

    await act(async () => {
      await result.current.handleDrop(dropEvent, 5)
    })

    expect(mutateFeeds).toHaveBeenCalledTimes(2)
    expect(mutateFeeds).toHaveBeenLastCalledWith()
  })

  it('handleDragEnd resets all state', () => {
    const { result } = renderHook(() => useFeedDragDrop({ feeds, categories, mutateFeeds, mutateCategories }))
    const dragEvent = makeDragEvent()
    dragEvent.dataTransfer.setData('application/x-sidebar-kind', 'feed')

    act(() => result.current.handleDragStart(dragEvent, feeds[0]))
    act(() => result.current.handleDragOver(dragEvent, 5))
    act(() => result.current.handleDragEnd())

    expect(result.current.dragOverTarget).toBeNull()
    expect(result.current.feedInsertIndicator).toBeNull()
    expect(result.current.categoryInsertIndicator).toBeNull()
    expect(result.current.isDragging).toBe(false)
  })
})
