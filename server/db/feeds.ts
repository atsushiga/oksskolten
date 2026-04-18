import { getDb, runNamed } from './connection.js'
import type { Feed, FeedWithCounts } from './types.js'
import type { MeiliArticleDoc } from '../search/client.js'
import { deleteArticlesByFeedFromSearch, syncArticlesByFeedToSearch } from '../search/sync.js'

function getNextFeedSortOrder(categoryId: number | null, excludeFeedIds: number[] = []): number {
  const exclusionSql = excludeFeedIds.length > 0
    ? `AND id NOT IN (${excludeFeedIds.map(() => '?').join(',')})`
    : ''
  const sql = categoryId == null
    ? `
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
      FROM feeds
      WHERE category_id IS NULL
        ${exclusionSql}
    `
    : `
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
      FROM feeds
      WHERE category_id = ?
        ${exclusionSql}
    `
  const args = categoryId == null ? excludeFeedIds : [categoryId, ...excludeFeedIds]
  const row = getDb().prepare(sql).get(...args) as { next: number }
  return row.next
}

export function getFeeds(): FeedWithCounts[] {
  return getDb().prepare(`
    SELECT f.*, c.name AS category_name,
      COALESCE(ac.article_count, 0) AS article_count,
      COALESCE(ac.unread_count, 0) AS unread_count,
      COALESCE(ac.articles_per_week, 0) AS articles_per_week,
      ac.latest_published_at
    FROM feeds f
    LEFT JOIN categories c ON f.category_id = c.id
    LEFT JOIN (
      SELECT feed_id,
        COUNT(*) AS article_count,
        SUM(CASE WHEN seen_at IS NULL THEN 1 ELSE 0 END) AS unread_count,
        COUNT(CASE WHEN COALESCE(published_at, fetched_at) >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-28 days') THEN 1 END) / 4.0 AS articles_per_week,
        MAX(COALESCE(published_at, fetched_at)) AS latest_published_at
      FROM articles GROUP BY feed_id
    ) ac ON f.id = ac.feed_id
    ORDER BY
      CASE WHEN f.type = 'clip' THEN 1 ELSE 0 END,
      CASE WHEN f.category_id IS NULL THEN 1 ELSE 0 END,
      f.category_id,
      f.sort_order ASC,
      f.name COLLATE NOCASE ASC
  `).all() as FeedWithCounts[]
}

export function getFeedMetrics(feedId: number): { avg_content_length: number | null } | undefined {
  return getDb().prepare(`
    SELECT AVG(LENGTH(full_text)) AS avg_content_length
    FROM articles
    WHERE feed_id = ? AND full_text IS NOT NULL
  `).get(feedId) as { avg_content_length: number | null } | undefined
}

export function getFeedById(id: number): Feed | undefined {
  return getDb().prepare('SELECT * FROM feeds WHERE id = ?').get(id) as Feed | undefined
}

export function getFeedByUrl(url: string): Feed | undefined {
  return getDb().prepare('SELECT * FROM feeds WHERE url = ?').get(url) as Feed | undefined
}

export function getEnabledFeeds(): Feed[] {
  return getDb().prepare(
    "SELECT * FROM feeds WHERE disabled = 0 AND type = 'rss' AND (next_check_at IS NULL OR next_check_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
  ).all() as Feed[]
}

export function ensureClipFeed(): Feed {
  const existing = getDb().prepare("SELECT * FROM feeds WHERE type = 'clip'").get() as Feed | undefined
  if (existing) return existing
  return createFeed({
    name: 'Clips',
    url: 'clip://saved',
    type: 'clip',
  })
}

export function getClipFeed(): Feed | undefined {
  return getDb().prepare("SELECT * FROM feeds WHERE type = 'clip'").get() as Feed | undefined
}

export function createFeed(data: {
  name: string
  url: string
  rss_url?: string | null
  rss_bridge_url?: string | null
  category_id?: number | null
  sort_order?: number
  requires_js_challenge?: number
  type?: 'rss' | 'clip'
}): Feed {
  const categoryId = data.category_id ?? null
  const sortOrder = data.sort_order ?? getNextFeedSortOrder(categoryId)
  const info = runNamed(`
    INSERT INTO feeds (name, url, rss_url, rss_bridge_url, category_id, sort_order, requires_js_challenge, type)
    VALUES (@name, @url, @rss_url, @rss_bridge_url, @category_id, @sort_order, @requires_js_challenge, @type)
  `, {
    name: data.name,
    url: data.url,
    rss_url: data.rss_url ?? null,
    rss_bridge_url: data.rss_bridge_url ?? null,
    category_id: categoryId,
    sort_order: sortOrder,
    requires_js_challenge: data.requires_js_challenge ?? 0,
    type: data.type ?? 'rss',
  })
  return getDb().prepare('SELECT * FROM feeds WHERE id = ?').get(info.lastInsertRowid) as Feed
}

export function updateFeed(
  id: number,
  data: { name?: string; rss_url?: string | null; rss_bridge_url?: string | null; disabled?: number; category_id?: number | null; sort_order?: number; requires_js_challenge?: number },
): Feed | undefined {
  const feed = getFeedById(id)
  if (!feed) return undefined

  const fields: string[] = []
  const params: Record<string, unknown> = { id }
  const categoryChanged = data.category_id !== undefined && data.category_id !== feed.category_id

  if (data.name !== undefined) {
    fields.push('name = @name')
    params.name = data.name
  }
  if (data.rss_url !== undefined) {
    fields.push('rss_url = @rss_url')
    params.rss_url = data.rss_url
  }
  if (data.rss_bridge_url !== undefined) {
    fields.push('rss_bridge_url = @rss_bridge_url')
    params.rss_bridge_url = data.rss_bridge_url
  }
  if (data.disabled !== undefined) {
    fields.push('disabled = @disabled')
    params.disabled = data.disabled
    if (data.disabled === 0) {
      fields.push('error_count = 0')
      fields.push("last_error = NULL")
    }
  }
  if (data.category_id !== undefined) {
    fields.push('category_id = @category_id')
    params.category_id = data.category_id
  }
  if (data.sort_order !== undefined) {
    fields.push('sort_order = @sort_order')
    params.sort_order = data.sort_order
  } else if (categoryChanged) {
    fields.push('sort_order = @sort_order')
    params.sort_order = getNextFeedSortOrder(data.category_id ?? null, [id])
  }
  if (data.requires_js_challenge !== undefined) {
    fields.push('requires_js_challenge = @requires_js_challenge')
    params.requires_js_challenge = data.requires_js_challenge
  }

  if (fields.length === 0) return feed

  const updatedFeed = getDb().transaction(() => {
    runNamed(`UPDATE feeds SET ${fields.join(', ')} WHERE id = @id`, params)

    if (categoryChanged) {
      runNamed(`UPDATE articles SET category_id = @category_id WHERE feed_id = @id`, {
        category_id: data.category_id,
        id,
      })
    }

    return getDb().prepare('SELECT * FROM feeds WHERE id = ?').get(feed.id) as Feed
  })()

  // Meilisearch sync outside transaction (external service, best-effort)
  if (categoryChanged) {
    const docs = getDb().prepare(`
      SELECT id, feed_id, category_id, title,
             COALESCE(full_text, '') AS full_text,
             COALESCE(full_text_translated, '') AS full_text_translated,
             lang,
             COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
             COALESCE(score, 0) AS score,
             (seen_at IS NULL) AS is_unread,
             (liked_at IS NOT NULL) AS is_liked,
             (bookmarked_at IS NOT NULL) AS is_bookmarked
      FROM articles WHERE feed_id = ?
    `).all(id) as MeiliArticleDoc[]
    syncArticlesByFeedToSearch(docs)
  }

  return updatedFeed
}

export function bulkMoveFeedsToCategory(feedIds: number[], categoryId: number | null): void {
  if (feedIds.length === 0) return
  const placeholders = feedIds.map(() => '?').join(',')
  getDb().transaction(() => {
    const nextSortOrder = getNextFeedSortOrder(categoryId, feedIds)
    const updateFeedStmt = getDb().prepare('UPDATE feeds SET category_id = ?, sort_order = ? WHERE id = ?')
    feedIds.forEach((feedId, index) => {
      updateFeedStmt.run(categoryId, nextSortOrder + index, feedId)
    })
    getDb().prepare(`UPDATE articles SET category_id = ? WHERE feed_id IN (${placeholders})`).run(categoryId, ...feedIds)
  })()

  // Sync Meilisearch index for all affected feeds in one batch
  const allDocs = getDb().prepare(`
    SELECT id, feed_id, category_id, title,
           COALESCE(full_text, '') AS full_text,
           COALESCE(full_text_translated, '') AS full_text_translated,
           lang,
           COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
           COALESCE(score, 0) AS score,
           (seen_at IS NULL) AS is_unread,
           (liked_at IS NOT NULL) AS is_liked,
           (bookmarked_at IS NOT NULL) AS is_bookmarked
    FROM articles WHERE feed_id IN (${placeholders})
  `).all(...feedIds) as MeiliArticleDoc[]
  syncArticlesByFeedToSearch(allDocs)
}

export function reorderFeeds(feedIds: number[], categoryId: number | null): void {
  if (feedIds.length === 0) return
  const placeholders = feedIds.map(() => '?').join(',')
  const feedRows = getDb().prepare(`SELECT id, category_id FROM feeds WHERE id IN (${placeholders})`).all(...feedIds) as Array<{ id: number; category_id: number | null }>
  const movedFeedIds = feedRows
    .filter(feed => feed.category_id !== categoryId)
    .map(feed => feed.id)

  getDb().transaction(() => {
    const updateFeedStmt = getDb().prepare('UPDATE feeds SET category_id = ?, sort_order = ? WHERE id = ?')
    feedIds.forEach((feedId, index) => {
      updateFeedStmt.run(categoryId, index, feedId)
    })

    if (movedFeedIds.length > 0) {
      const movedPlaceholders = movedFeedIds.map(() => '?').join(',')
      getDb().prepare(`UPDATE articles SET category_id = ? WHERE feed_id IN (${movedPlaceholders})`).run(categoryId, ...movedFeedIds)
    }
  })()

  if (movedFeedIds.length > 0) {
    const movedPlaceholders = movedFeedIds.map(() => '?').join(',')
    const docs = getDb().prepare(`
      SELECT id, feed_id, category_id, title,
             COALESCE(full_text, '') AS full_text,
             COALESCE(full_text_translated, '') AS full_text_translated,
             lang,
             COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
             COALESCE(score, 0) AS score,
             (seen_at IS NULL) AS is_unread,
             (liked_at IS NOT NULL) AS is_liked,
             (bookmarked_at IS NOT NULL) AS is_bookmarked
      FROM articles WHERE feed_id IN (${movedPlaceholders})
    `).all(...movedFeedIds) as MeiliArticleDoc[]
    syncArticlesByFeedToSearch(docs)
  }
}

export function deleteFeed(id: number): boolean {
  // Collect article IDs and delete feed atomically (CASCADE deletes articles)
  const { articleIds, deleted } = getDb().transaction(() => {
    const ids = (getDb().prepare('SELECT id FROM articles WHERE feed_id = ?').all(id) as { id: number }[]).map((r) => r.id)
    const result = getDb().prepare('DELETE FROM feeds WHERE id = ?').run(id)
    return { articleIds: ids, deleted: result.changes > 0 }
  })()
  if (deleted && articleIds.length > 0) {
    deleteArticlesByFeedFromSearch(articleIds)
  }
  return deleted
}

/**
 * Record a feed fetch error with exponential backoff scheduling.
 *
 * 3-stage backoff (CommaFeed-style):
 * - errorCount < 3: normal retry (next cron cycle, ~5min)
 * - errorCount >= 3: backoff = 1h × (errorCount - 2), capped at 4h
 *
 * Feeds are never disabled by errors. They always get retried with increasing delays.
 * Manual refresh (fetchSingleFeed) always works regardless of next_check_at.
 */
export function updateFeedError(feedId: number, error: string | null): void {
  getDb().transaction(() => {
    if (error) {
      getDb().prepare(
        'UPDATE feeds SET last_error = ?, error_count = error_count + 1 WHERE id = ?',
      ).run(error, feedId)

      // Exponential backoff via next_check_at (instead of disabling)
      const feed = getDb().prepare('SELECT error_count FROM feeds WHERE id = ?').get(feedId) as { error_count: number } | undefined
      if (feed && feed.error_count >= 3) {
        const BACKOFF_BASE = 3600 // 1 hour in seconds
        const MAX_BACKOFF = 4 * 3600 // 4 hours
        const backoff = Math.min(MAX_BACKOFF, BACKOFF_BASE * (feed.error_count - 2))
        const nextCheckAt = new Date(Date.now() + backoff * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
        getDb().prepare(
          'UPDATE feeds SET next_check_at = ? WHERE id = ?',
        ).run(nextCheckAt, feedId)
      }
    } else {
      getDb().prepare(
        'UPDATE feeds SET last_error = NULL, error_count = 0 WHERE id = ?',
      ).run(feedId)
    }
  })()
}

/**
 * Handle rate-limit (429/503) responses separately from real errors.
 * Does NOT increment error_count (FreshRSS approach).
 */
export function updateFeedRateLimit(feedId: number, retryAfterSeconds: number | null): void {
  const delay = retryAfterSeconds ?? 3600 // default 1h if no Retry-After header
  const nextCheckAt = new Date(Date.now() + delay * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  getDb().prepare(
    'UPDATE feeds SET next_check_at = ?, last_error = ? WHERE id = ?',
  ).run(nextCheckAt, `Rate limited, retry after ${delay}s`, feedId)
}

export function updateFeedRssUrl(feedId: number, rssUrl: string): void {
  getDb().prepare('UPDATE feeds SET rss_url = ? WHERE id = ?').run(rssUrl, feedId)
}

export function updateFeedSchedule(feedId: number, nextCheckAt: string, checkInterval: number): void {
  getDb().prepare(
    'UPDATE feeds SET next_check_at = ?, check_interval = ? WHERE id = ?',
  ).run(nextCheckAt, checkInterval, feedId)
}

export function updateFeedCacheHeaders(feedId: number, etag: string | null, lastModified: string | null, contentHash?: string | null): void {
  if (contentHash !== undefined) {
    getDb().prepare(
      'UPDATE feeds SET etag = ?, last_modified = ?, last_content_hash = ? WHERE id = ?',
    ).run(etag, lastModified, contentHash, feedId)
  } else {
    getDb().prepare(
      'UPDATE feeds SET etag = ?, last_modified = ? WHERE id = ?',
    ).run(etag, lastModified, feedId)
  }
}
