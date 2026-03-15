import { demoStore } from './demo/demo-store'

interface SearchResult {
  id: number
  title: string
  url: string
  feed_name: string
  published_at: string | null
}

export async function searchArticles(
  q: string,
  filters: { bookmarked: boolean; liked: boolean; unread: boolean; since?: string },
  limit: number,
  _offset: number,
  _signal?: AbortSignal,
): Promise<{ articles: SearchResult[]; has_more: boolean; indexBuilding?: boolean }> {
  const data = demoStore.searchArticles({
    q,
    bookmarked: filters.bookmarked || undefined,
    liked: filters.liked || undefined,
    unread: filters.unread || undefined,
    since: filters.since,
    limit,
  })
  return { articles: data.articles, has_more: false }
}
