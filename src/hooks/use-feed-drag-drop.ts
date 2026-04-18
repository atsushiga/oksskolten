import { useState } from 'react'
import { apiPatch, apiPost } from '../lib/fetcher'
import type { FeedWithCounts, Category } from '../../shared/types'
import type { KeyedMutator } from 'swr'

const FEED_IDS_MIME = 'application/x-feed-ids'
const CATEGORY_ID_MIME = 'application/x-category-id'
const SIDEBAR_KIND_MIME = 'application/x-sidebar-kind'

type DropZoneTarget = number | 'uncategorized' | null
type InsertPosition = 'before' | 'after'

type FeedsResponse = {
  feeds: FeedWithCounts[]
  bookmark_count: number
  like_count: number
  comment_count?: number
  clip_feed_id: number | null
}

type CategoriesResponse = {
  categories: Category[]
}

interface UseFeedDragDropOpts {
  feeds: FeedWithCounts[]
  categories: Category[]
  mutateFeeds: KeyedMutator<FeedsResponse>
  mutateCategories: KeyedMutator<CategoriesResponse>
  onDropComplete?: () => void
}

function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function getSingleDraggedFeedId(dataTransfer: DataTransfer): number | null {
  const raw = dataTransfer.getData(FEED_IDS_MIME)
  if (!raw) return null
  try {
    const feedIds = JSON.parse(raw)
    return Array.isArray(feedIds) && feedIds.length === 1 && typeof feedIds[0] === 'number'
      ? feedIds[0]
      : null
  } catch {
    return null
  }
}

function getDraggedCategoryId(dataTransfer: DataTransfer): number | null {
  const raw = dataTransfer.getData(CATEGORY_ID_MIME)
  if (!raw) return null
  const categoryId = Number(raw)
  return Number.isFinite(categoryId) ? categoryId : null
}

function getInsertPosition(e: React.DragEvent): InsertPosition {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

export function useFeedDragDrop({
  feeds,
  categories,
  mutateFeeds,
  mutateCategories,
  onDropComplete,
}: UseFeedDragDropOpts) {
  const [dragOverTarget, setDragOverTarget] = useState<DropZoneTarget>(null)
  const [feedInsertIndicator, setFeedInsertIndicator] = useState<{ feedId: number; position: InsertPosition } | null>(null)
  const [categoryInsertIndicator, setCategoryInsertIndicator] = useState<{ categoryId: number; position: InsertPosition } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [draggingCount, setDraggingCount] = useState(0)

  function resetDragState() {
    setDragOverTarget(null)
    setFeedInsertIndicator(null)
    setCategoryInsertIndicator(null)
    setIsDragging(false)
    setDraggingCount(0)
  }

  function handleDragStart(e: React.DragEvent, feed: FeedWithCounts, selectedFeedIds?: Set<number>) {
    const feedIds = selectedFeedIds && selectedFeedIds.size > 1 && selectedFeedIds.has(feed.id)
      ? Array.from(selectedFeedIds)
      : [feed.id]

    e.dataTransfer.setData(FEED_IDS_MIME, JSON.stringify(feedIds))
    e.dataTransfer.setData(SIDEBAR_KIND_MIME, 'feed')
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
    setDraggingCount(feedIds.length)

    if (feedIds.length > 1) {
      const ghost = document.createElement('div')
      ghost.textContent = `${feedIds.length} feeds`
      ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;padding:4px 10px;border-radius:6px;font-size:12px;color:var(--color-text);background:var(--color-bg-sidebar);border:1px solid var(--color-border);pointer-events:none;white-space:nowrap;'
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 0, 0)
      requestAnimationFrame(() => document.body.removeChild(ghost))
    }
  }

  function handleCategoryDragStart(e: React.DragEvent, category: Category) {
    e.dataTransfer.setData(CATEGORY_ID_MIME, String(category.id))
    e.dataTransfer.setData(SIDEBAR_KIND_MIME, 'category')
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
    setDraggingCount(1)
  }

  function handleDragOver(e: React.DragEvent, target: number | 'uncategorized') {
    if (e.dataTransfer.getData(SIDEBAR_KIND_MIME) !== 'feed') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(target)
    setFeedInsertIndicator(null)
    setCategoryInsertIndicator(null)
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTarget(null)
    }
  }

  function handleFeedReorderDragOver(e: React.DragEvent, targetFeed: FeedWithCounts) {
    if (e.dataTransfer.getData(SIDEBAR_KIND_MIME) !== 'feed') return
    const draggedFeedId = getSingleDraggedFeedId(e.dataTransfer)
    if (!draggedFeedId || draggedFeedId === targetFeed.id) return
    const draggedFeed = feeds.find(feed => feed.id === draggedFeedId)
    if (!draggedFeed || draggedFeed.category_id !== targetFeed.category_id) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(null)
    setCategoryInsertIndicator(null)
    setFeedInsertIndicator({ feedId: targetFeed.id, position: getInsertPosition(e) })
  }

  function handleFeedReorderDragLeave(e: React.DragEvent, feedId: number) {
    if (!e.currentTarget.contains(e.relatedTarget as Node) && feedInsertIndicator?.feedId === feedId) {
      setFeedInsertIndicator(null)
    }
  }

  async function handleFeedReorderDrop(e: React.DragEvent, targetFeed: FeedWithCounts) {
    if (e.dataTransfer.getData(SIDEBAR_KIND_MIME) !== 'feed') return
    const draggedFeedId = getSingleDraggedFeedId(e.dataTransfer)
    if (!draggedFeedId || draggedFeedId === targetFeed.id) return
    const draggedFeed = feeds.find(feed => feed.id === draggedFeedId)
    if (!draggedFeed || draggedFeed.category_id !== targetFeed.category_id) return

    e.preventDefault()
    e.stopPropagation()

    const position = feedInsertIndicator?.feedId === targetFeed.id
      ? feedInsertIndicator.position
      : getInsertPosition(e)
    const siblingFeeds = feeds.filter(feed => feed.type !== 'clip' && feed.category_id === targetFeed.category_id)
    const sourceIndex = siblingFeeds.findIndex(feed => feed.id === draggedFeedId)
    const targetIndex = siblingFeeds.findIndex(feed => feed.id === targetFeed.id)
    if (sourceIndex === -1 || targetIndex === -1) {
      resetDragState()
      return
    }

    let insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
    if (sourceIndex < insertIndex) insertIndex -= 1

    const reorderedFeeds = reorderItems(siblingFeeds, sourceIndex, insertIndex)
    const nextOrder = reorderedFeeds.map(feed => feed.id)
    const unchanged = nextOrder.every((feedId, index) => feedId === siblingFeeds[index]?.id)

    resetDragState()
    if (unchanged) return

    const sortOrderById = new Map(nextOrder.map((feedId, index) => [feedId, index]))
    void mutateFeeds(
      prev => prev ? {
        ...prev,
        feeds: prev.feeds.map(feed =>
          sortOrderById.has(feed.id)
            ? { ...feed, sort_order: sortOrderById.get(feed.id)! }
            : feed,
        ),
      } : prev,
      { revalidate: false },
    )

    try {
      await apiPatch('/api/feeds/reorder', { feed_ids: nextOrder, category_id: targetFeed.category_id })
    } catch {
      void mutateFeeds()
    }

    onDropComplete?.()
  }

  function handleCategoryReorderDragOver(e: React.DragEvent, targetCategory: Category) {
    if (e.dataTransfer.getData(SIDEBAR_KIND_MIME) !== 'category') return
    const draggedCategoryId = getDraggedCategoryId(e.dataTransfer)
    if (!draggedCategoryId || draggedCategoryId === targetCategory.id) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(null)
    setFeedInsertIndicator(null)
    setCategoryInsertIndicator({ categoryId: targetCategory.id, position: getInsertPosition(e) })
  }

  function handleCategoryReorderDragLeave(e: React.DragEvent, categoryId: number) {
    if (!e.currentTarget.contains(e.relatedTarget as Node) && categoryInsertIndicator?.categoryId === categoryId) {
      setCategoryInsertIndicator(null)
    }
  }

  async function handleCategoryReorderDrop(e: React.DragEvent, targetCategory: Category) {
    if (e.dataTransfer.getData(SIDEBAR_KIND_MIME) !== 'category') return
    const draggedCategoryId = getDraggedCategoryId(e.dataTransfer)
    if (!draggedCategoryId || draggedCategoryId === targetCategory.id) return

    e.preventDefault()
    e.stopPropagation()

    const position = categoryInsertIndicator?.categoryId === targetCategory.id
      ? categoryInsertIndicator.position
      : getInsertPosition(e)
    const sourceIndex = categories.findIndex(category => category.id === draggedCategoryId)
    const targetIndex = categories.findIndex(category => category.id === targetCategory.id)
    if (sourceIndex === -1 || targetIndex === -1) {
      resetDragState()
      return
    }

    let insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
    if (sourceIndex < insertIndex) insertIndex -= 1

    const reorderedCategories = reorderItems(categories, sourceIndex, insertIndex)
    const nextOrder = reorderedCategories.map(category => category.id)
    const unchanged = nextOrder.every((categoryId, index) => categoryId === categories[index]?.id)

    resetDragState()
    if (unchanged) return

    const sortOrderById = new Map(nextOrder.map((categoryId, index) => [categoryId, index]))
    void mutateCategories(
      prev => prev ? {
        categories: prev.categories.map(category =>
          sortOrderById.has(category.id)
            ? { ...category, sort_order: sortOrderById.get(category.id)! }
            : category,
        ),
      } : prev,
      { revalidate: false },
    )

    try {
      await apiPatch('/api/categories/reorder', { category_ids: nextOrder })
    } catch {
      void mutateCategories()
    }

    onDropComplete?.()
  }

  async function handleDrop(e: React.DragEvent, categoryId: number | null) {
    if (e.dataTransfer.getData(SIDEBAR_KIND_MIME) !== 'feed') return
    e.preventDefault()
    setDragOverTarget(null)
    setFeedInsertIndicator(null)
    setCategoryInsertIndicator(null)
    setIsDragging(false)
    setDraggingCount(0)

    let feedIds: number[]
    const raw = e.dataTransfer.getData(FEED_IDS_MIME)
    if (raw) {
      try {
        feedIds = JSON.parse(raw)
      } catch {
        return
      }
    } else {
      const plainId = Number(e.dataTransfer.getData('text/plain'))
      if (!plainId) return
      feedIds = [plainId]
    }

    const feedsToMove = feedIds.filter(id => {
      const feed = feeds.find(candidate => candidate.id === id)
      return feed && feed.category_id !== categoryId
    })
    if (feedsToMove.length === 0) return

    void mutateFeeds(
      prev => {
        if (!prev) return prev

        const targetFeeds = prev.feeds.filter(feed => !feedsToMove.includes(feed.id) && feed.category_id === categoryId && feed.type !== 'clip')
        const movedSortOrderById = new Map(feedsToMove.map((feedId, index) => [feedId, targetFeeds.length + index]))

        return {
          ...prev,
          feeds: prev.feeds.map(feed =>
            movedSortOrderById.has(feed.id)
              ? {
                ...feed,
                category_id: categoryId,
                sort_order: movedSortOrderById.get(feed.id)!,
              }
              : feed,
          ),
        }
      },
      { revalidate: false },
    )

    try {
      if (feedsToMove.length === 1) {
        await apiPatch(`/api/feeds/${feedsToMove[0]}`, { category_id: categoryId })
      } else {
        await apiPost('/api/feeds/bulk-move', { feed_ids: feedsToMove, category_id: categoryId })
      }
    } catch {
      void mutateFeeds()
    }

    onDropComplete?.()
  }

  function handleDragEnd() {
    resetDragState()
  }

  return {
    dragOverTarget,
    feedInsertIndicator,
    categoryInsertIndicator,
    isDragging,
    draggingCount,
    handleDragStart,
    handleCategoryDragStart,
    handleDragOver,
    handleDragLeave,
    handleFeedReorderDragOver,
    handleFeedReorderDragLeave,
    handleFeedReorderDrop,
    handleCategoryReorderDragOver,
    handleCategoryReorderDragLeave,
    handleCategoryReorderDrop,
    handleDrop,
    handleDragEnd,
  }
}
