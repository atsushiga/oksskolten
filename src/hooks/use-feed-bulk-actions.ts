import { useState, useCallback } from 'react'
import { apiPost, apiDelete } from '../lib/fetcher'
import type { FeedWithCounts } from '../../shared/types'
import type { KeyedMutator } from 'swr'
import type { FetchResult } from './use-fetch-progress'

type FeedsData = { feeds: FeedWithCounts[]; bookmark_count: number; like_count: number; comment_count?: number; clip_feed_id: number | null }

interface UseFeedBulkActionsOpts {
  feeds: FeedWithCounts[]
  selectedFeedIds: Set<number>
  mutateFeeds: KeyedMutator<FeedsData>
  clearSelection: () => void
  startFeedFetch: (feedId: number) => Promise<FetchResult>
  onMarkAllRead?: () => void
  onFetchComplete?: (result: FetchResult) => void
  onDeleted?: (deletedIds: number[]) => void
}

export function useFeedBulkActions({
  feeds,
  selectedFeedIds,
  mutateFeeds,
  clearSelection,
  startFeedFetch,
  onMarkAllRead,
  onFetchComplete,
  onDeleted,
}: UseFeedBulkActionsOpts) {
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  const getSelectedFeeds = useCallback(
    () => feeds.filter(f => selectedFeedIds.has(f.id) && f.type !== 'clip'),
    [feeds, selectedFeedIds],
  )

  const handleBulkMoveToCategory = useCallback(async (categoryId: number | null) => {
    const selected = getSelectedFeeds()
    const toMove = selected.filter(f => f.category_id !== categoryId)
    if (toMove.length === 0) return
    const ids = toMove.map(f => f.id)
    void mutateFeeds(
      prev => prev ? { ...prev, feeds: prev.feeds.map(f => ids.includes(f.id) ? { ...f, category_id: categoryId } : f) } : prev,
      { revalidate: false },
    )
    clearSelection()
    try {
      await apiPost('/api/feeds/bulk-move', { feed_ids: ids, category_id: categoryId })
    } catch {
      void mutateFeeds()
    }
  }, [getSelectedFeeds, mutateFeeds, clearSelection])

  const handleBulkMarkAllRead = useCallback(async () => {
    const selected = getSelectedFeeds()
    clearSelection()
    await Promise.all(selected.map(f => apiPost(`/api/feeds/${f.id}/mark-all-seen`)))
    void mutateFeeds()
    onMarkAllRead?.()
  }, [getSelectedFeeds, mutateFeeds, clearSelection, onMarkAllRead])

  const handleBulkFetch = useCallback(async () => {
    const selected = getSelectedFeeds().filter(f => !f.disabled)
    clearSelection()
    for (const feed of selected) {
      const result = await startFeedFetch(feed.id)
      onFetchComplete?.({ ...result, name: feed.name })
    }
  }, [getSelectedFeeds, clearSelection, startFeedFetch, onFetchComplete])

  const handleBulkDelete = useCallback(() => {
    setBulkDeleteConfirm(true)
  }, [])

  const handleBulkDeleteConfirm = useCallback(async () => {
    const selected = getSelectedFeeds()
    const ids = selected.map(f => f.id)
    void mutateFeeds(
      prev => prev ? { ...prev, feeds: prev.feeds.filter(f => !ids.includes(f.id)) } : prev,
      { revalidate: false },
    )
    setBulkDeleteConfirm(false)
    clearSelection()
    try {
      await Promise.all(ids.map(id => apiDelete(`/api/feeds/${id}`)))
    } catch {
      // partial failure
    }
    void mutateFeeds()
    onDeleted?.(ids)
  }, [getSelectedFeeds, mutateFeeds, clearSelection, onDeleted])

  return {
    bulkDeleteConfirm,
    setBulkDeleteConfirm,
    handleBulkMoveToCategory,
    handleBulkMarkAllRead,
    handleBulkFetch,
    handleBulkDelete,
    handleBulkDeleteConfirm,
  }
}
