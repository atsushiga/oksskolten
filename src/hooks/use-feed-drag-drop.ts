import { useState } from 'react'
import { apiPatch, apiPost } from '../lib/fetcher'
import type { FeedWithCounts } from '../../shared/types'
import type { KeyedMutator } from 'swr'

interface UseFeedDragDropOpts {
  feeds: FeedWithCounts[]
  mutateFeeds: KeyedMutator<{ feeds: FeedWithCounts[]; bookmark_count: number; like_count: number; comment_count?: number; clip_feed_id: number | null }>
  onDropComplete?: () => void
}

export function useFeedDragDrop({ feeds, mutateFeeds, onDropComplete }: UseFeedDragDropOpts) {
  const [dragOverTarget, setDragOverTarget] = useState<number | 'uncategorized' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [draggingCount, setDraggingCount] = useState(0)

  function handleDragStart(e: React.DragEvent, feed: FeedWithCounts, selectedFeedIds?: Set<number>) {
    const feedIds = selectedFeedIds && selectedFeedIds.size > 1 && selectedFeedIds.has(feed.id)
      ? Array.from(selectedFeedIds)
      : [feed.id]

    e.dataTransfer.setData('application/x-feed-ids', JSON.stringify(feedIds))
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
    setDraggingCount(feedIds.length)

    // Custom drag image for multi-select
    if (feedIds.length > 1) {
      const ghost = document.createElement('div')
      ghost.textContent = `${feedIds.length} feeds`
      ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;padding:4px 10px;border-radius:6px;font-size:12px;color:var(--color-text);background:var(--color-bg-sidebar);border:1px solid var(--color-border);pointer-events:none;white-space:nowrap;'
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 0, 0)
      requestAnimationFrame(() => document.body.removeChild(ghost))
    }
  }

  function handleDragOver(e: React.DragEvent, target: number | 'uncategorized') {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(target)
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear when actually leaving the container (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTarget(null)
    }
  }

  async function handleDrop(e: React.DragEvent, categoryId: number | null) {
    e.preventDefault()
    setDragOverTarget(null)
    setIsDragging(false)
    setDraggingCount(0)

    let feedIds: number[]
    const raw = e.dataTransfer.getData('application/x-feed-ids')
    if (raw) {
      try {
        feedIds = JSON.parse(raw)
      } catch {
        return
      }
    } else {
      // Fallback for legacy single-feed drag (shouldn't happen, but safe)
      const plainId = Number(e.dataTransfer.getData('text/plain'))
      if (!plainId) return
      feedIds = [plainId]
    }

    // Filter out feeds already in the target category
    const feedsToMove = feedIds.filter(id => {
      const f = feeds.find(feed => feed.id === id)
      return f && f.category_id !== categoryId
    })
    if (feedsToMove.length === 0) return

    // Optimistic update
    void mutateFeeds(
      prev => prev ? {
        ...prev,
        feeds: prev.feeds.map(f =>
          feedsToMove.includes(f.id) ? { ...f, category_id: categoryId } : f,
        ),
      } : prev,
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
    setDragOverTarget(null)
    setIsDragging(false)
    setDraggingCount(0)
  }

  return {
    dragOverTarget,
    isDragging,
    draggingCount,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  }
}
