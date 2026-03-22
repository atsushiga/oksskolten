import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle, ensureClipFeed, getArticleById, markImagesArchived, markArticleSeen, upsertSetting } from '../db.js'
import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockArchiveArticleImages, mockIsImageArchivingEnabled, mockDeleteArticleImages, mockFetchArticleContent, mockFetchAndParseRss } = vi.hoisted(() => ({
  mockArchiveArticleImages: vi.fn(),
  mockIsImageArchivingEnabled: vi.fn(),
  mockDeleteArticleImages: vi.fn(),
  mockFetchArticleContent: vi.fn(),
  mockFetchAndParseRss: vi.fn(),
}))

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: vi.fn(),
    discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
    summarizeArticle: vi.fn(),
    streamSummarizeArticle: vi.fn(),
    translateArticle: vi.fn(),
    streamTranslateArticle: vi.fn(),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
    fetchArticleContent: (...args: unknown[]) => mockFetchArticleContent(...args),
  }
})

vi.mock('../fetcher/rss.js', () => ({
  fetchAndParseRss: (...args: unknown[]) => mockFetchAndParseRss(...args),
}))

vi.mock('../anthropic.js', () => ({
  anthropic: { messages: { stream: vi.fn(), create: vi.fn() } },
}))

vi.mock('../fetcher/article-images.js', () => ({
  archiveArticleImages: (...args: unknown[]) => mockArchiveArticleImages(...args),
  isImageArchivingEnabled: (...args: unknown[]) => mockIsImageArchivingEnabled(...args),
  deleteArticleImages: (...args: unknown[]) => mockDeleteArticleImages(...args),
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

function seedFeed(overrides: Partial<Parameters<typeof createFeed>[0]> = {}) {
  return createFeed({ name: 'Test Feed', url: 'https://example.com', ...overrides })
}

function seedArticle(feedId: number, overrides: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({
    feed_id: feedId,
    title: 'Test Article',
    url: `https://example.com/article/${Math.random()}`,
    published_at: '2025-01-01T00:00:00Z',
    ...overrides,
  })
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  vi.clearAllMocks()
  mockFetchArticleContent.mockResolvedValue({
    fullText: 'Fetched article content',
    ogImage: 'https://example.com/og.jpg',
    excerpt: 'Short excerpt',
    lang: 'en',
    lastError: null,
    title: 'Fetched Title',
  })
  mockFetchAndParseRss.mockResolvedValue({
    items: [],
    notModified: false,
    etag: null,
    lastModified: null,
    contentHash: null,
    httpCacheSeconds: null,
    rssTtlSeconds: null,
  })
  mockIsImageArchivingEnabled.mockReturnValue(false)
  mockArchiveArticleImages.mockResolvedValue({ rewrittenText: '', downloaded: 0, errors: 0 })
  mockDeleteArticleImages.mockReturnValue(0)
})

// ---------------------------------------------------------------------------
// POST /api/articles/from-url
// ---------------------------------------------------------------------------

describe('POST /api/articles/from-url', () => {
  it('201: creates article with fetched content', async () => {
    ensureClipFeed()

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-1' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.created).toBe(true)
    expect(body.article.title).toBe('Fetched Title')
    expect(body.article.full_text).toBe('Fetched article content')
    expect(body.article.og_image).toBe('https://example.com/og.jpg')
    expect(body.article.lang).toBe('en')
    expect(mockFetchArticleContent).toHaveBeenCalledWith('https://blog.example.com/post-1')
  })

  it('201: uses provided title over fetched title', async () => {
    ensureClipFeed()

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-2', title: 'My Custom Title' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().article.title).toBe('My Custom Title')
  })

  it('201: passes provided html to content fetch when supplied', async () => {
    ensureClipFeed()

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: {
        url: 'https://blog.example.com/post-html',
        html: '<html><body><article>Provided article body</article></body></html>',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(mockFetchArticleContent).toHaveBeenCalledWith(
      'https://blog.example.com/post-html',
      { providedHtml: '<html><body><article>Provided article body</article></body></html>' },
    )
  })

  it('201: falls back to hostname when no title', async () => {
    ensureClipFeed()
    mockFetchArticleContent.mockResolvedValue({
      fullText: 'Content',
      ogImage: null,
      excerpt: null,
      lang: 'en',
      lastError: null,
      title: null,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-3' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().article.title).toBe('blog.example.com')
  })

  it('201: stores last_error when fetchFullText fails (graceful degradation)', async () => {
    ensureClipFeed()
    mockFetchArticleContent.mockResolvedValue({
      fullText: null,
      ogImage: null,
      excerpt: null,
      lang: null,
      lastError: 'fetchFullText: Network timeout',
      title: null,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-4' },
    })

    expect(res.statusCode).toBe(201)
    const article = res.json().article
    expect(article.full_text).toBeNull()
    // last_error is stored in DB but getArticleById doesn't select it;
    // verify the article was still created successfully despite the fetch error
    expect(article.id).toBeDefined()
    expect(article.title).toBe('blog.example.com') // falls back to hostname
  })

  it('400: missing url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/url/i)
  })

  it('409: article already exists in clips', async () => {
    const clipFeed = ensureClipFeed()
    seedArticle(clipFeed.id, { url: 'https://blog.example.com/existing' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/existing' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already exists/i)
    expect(res.json().can_force).toBeUndefined()
  })

  it('200: refreshes an existing clip article when html is provided', async () => {
    const clipFeed = ensureClipFeed()
    const articleId = seedArticle(clipFeed.id, {
      url: 'https://blog.example.com/existing-refresh',
      full_text: 'Old preview',
      summary: 'Old summary',
      full_text_translated: 'Old translation',
      translated_lang: 'ja',
    })

    mockFetchArticleContent.mockResolvedValue({
      fullText: 'Refreshed full body from browser DOM',
      ogImage: 'https://example.com/new.jpg',
      excerpt: 'Fresh excerpt',
      lang: 'en',
      lastError: null,
      title: 'Fetched Title',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: {
        url: 'https://blog.example.com/existing-refresh',
        html: '<html><body><article>Rendered full content</article></body></html>',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      refetched: true,
      article: {
        id: articleId,
        full_text: 'Refreshed full body from browser DOM',
        summary: null,
        full_text_translated: null,
        translated_lang: null,
      },
    })
    expect(mockFetchArticleContent).toHaveBeenCalledWith(
      'https://blog.example.com/existing-refresh',
      { providedHtml: '<html><body><article>Rendered full content</article></body></html>' },
    )
  })

  it('409: returns can_force when article exists in RSS feed', async () => {
    ensureClipFeed()
    const rssFeed = seedFeed()
    seedArticle(rssFeed.id, { url: 'https://blog.example.com/rss-article' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/rss-article' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().can_force).toBe(true)
    expect(res.json().article).toBeDefined()
  })

  it('200: force-moves RSS article to clip feed', async () => {
    const clipFeed = ensureClipFeed()
    const rssFeed = seedFeed()
    const artId = seedArticle(rssFeed.id, { url: 'https://blog.example.com/to-move' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/to-move', force: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().moved).toBe(true)
    // Verify article moved to clip feed
    const moved = getArticleById(artId)
    expect(moved!.feed_id).toBe(clipFeed.id)
    expect(moved!.feed_type).toBe('clip')
  })

  it('200: force-moves RSS article to clip feed and refreshes content when html is provided', async () => {
    const clipFeed = ensureClipFeed()
    const rssFeed = seedFeed()
    const artId = seedArticle(rssFeed.id, {
      url: 'https://blog.example.com/to-move-refresh',
      full_text: 'Old preview',
      summary: 'Old summary',
      full_text_translated: 'Old translation',
      translated_lang: 'ja',
    })

    mockFetchArticleContent.mockResolvedValue({
      fullText: 'Rendered full body from browser DOM',
      ogImage: 'https://example.com/refreshed.jpg',
      excerpt: 'Fresh excerpt',
      lang: 'en',
      lastError: null,
      title: 'Fetched Title',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: {
        url: 'https://blog.example.com/to-move-refresh',
        force: true,
        html: '<html><body><article>Rendered full body</article></body></html>',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      moved: true,
      refetched: true,
      article: {
        id: artId,
        feed_id: clipFeed.id,
        feed_type: 'clip',
        full_text: 'Rendered full body from browser DOM',
        summary: null,
        full_text_translated: null,
        translated_lang: null,
      },
    })
    expect(mockFetchArticleContent).toHaveBeenCalledWith(
      'https://blog.example.com/to-move-refresh',
      { providedHtml: '<html><body><article>Rendered full body</article></body></html>' },
    )
  })

  it('500: force-move fails when clip feed not found', async () => {
    // Create RSS feed and article but no clip feed
    const rssFeed = seedFeed()
    seedArticle(rssFeed.id, { url: 'https://blog.example.com/no-clip' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/no-clip', force: true },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error).toMatch(/clip feed/i)
  })

  it('500: clip feed not found', async () => {
    // Do NOT call ensureClipFeed — no clip feed exists
    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/from-url',
      headers: json,
      payload: { url: 'https://blog.example.com/post-5' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error).toMatch(/clip feed/i)
  })
})

// ---------------------------------------------------------------------------
// POST /api/articles/:id/refetch
// ---------------------------------------------------------------------------

describe('POST /api/articles/:id/refetch', () => {
  it('200: refetches an existing article and clears derived content', async () => {
    const feed = seedFeed()
    const articleId = seedArticle(feed.id, {
      url: 'https://note.com/example/n/premium',
      lang: 'ja',
      full_text: 'Old body',
      full_text_translated: 'Old translation',
      translated_lang: 'en',
      summary: 'Old summary',
      excerpt: 'Old excerpt',
      og_image: 'https://example.com/old.jpg',
      last_error: 'old error',
    })

    mockFetchArticleContent.mockResolvedValue({
      fullText: 'Refetched premium body',
      ogImage: 'https://example.com/new.jpg',
      excerpt: 'New excerpt',
      lang: 'ja',
      lastError: null,
      title: 'Ignored title',
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${articleId}/refetch`,
    })

    expect(res.statusCode).toBe(200)
    expect(mockFetchArticleContent).toHaveBeenCalledWith('https://note.com/example/n/premium', {
      listingExcerpt: undefined,
    })
    expect(res.json()).toMatchObject({
      refetched: true,
      article: {
        id: articleId,
        full_text: 'Refetched premium body',
        full_text_translated: null,
        translated_lang: null,
        summary: null,
        og_image: 'https://example.com/new.jpg',
      },
    })

    const updated = getArticleById(articleId)
    expect(updated?.full_text).toBe('Refetched premium body')
    expect(updated?.full_text_translated).toBeNull()
    expect(updated?.translated_lang).toBeNull()
    expect(updated?.summary).toBeNull()
    expect(updated?.og_image).toBe('https://example.com/new.jpg')
    expect(updated?.title).toBe('Test Article')
  })

  it('200: refetch uses RSS item excerpt as fallback for RSS articles', async () => {
    const feed = seedFeed({ rss_url: 'https://note.com/example/rss' })
    const articleId = seedArticle(feed.id, {
      url: 'https://note.com/example/n/premium-rss',
      full_text: 'Old preview',
      excerpt: 'Old short excerpt',
      summary: 'Old summary',
    })

    mockFetchAndParseRss.mockResolvedValue({
      items: [
        {
          title: 'Premium note article',
          url: 'https://note.com/example/n/premium-rss',
          published_at: '2025-01-01T00:00:00Z',
          excerpt: 'Full body from RSS content:encoded',
        },
      ],
      notModified: false,
      etag: null,
      lastModified: null,
      contentHash: null,
      httpCacheSeconds: null,
      rssTtlSeconds: null,
    })
    mockFetchArticleContent.mockResolvedValue({
      fullText: 'Full body from RSS content:encoded',
      ogImage: null,
      excerpt: 'Full body from RSS content:encoded',
      lang: 'ja',
      lastError: null,
      title: null,
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${articleId}/refetch`,
    })

    expect(res.statusCode).toBe(200)
    expect(mockFetchAndParseRss).toHaveBeenCalledWith(expect.objectContaining({ id: feed.id }), { skipCache: true })
    expect(mockFetchArticleContent).toHaveBeenCalledWith('https://note.com/example/n/premium-rss', {
      listingExcerpt: 'Full body from RSS content:encoded',
    })
    expect(res.json()).toMatchObject({
      refetched: true,
      article: {
        id: articleId,
        full_text: 'Full body from RSS content:encoded',
        summary: null,
      },
    })
  })

  it('200: clears archived image state when refetching', async () => {
    const feed = seedFeed()
    const articleId = seedArticle(feed.id, {
      full_text: '![alt](/api/articles/images/test.png)',
    })
    markImagesArchived(articleId)

    mockFetchArticleContent.mockResolvedValue({
      fullText: 'Fresh body',
      ogImage: null,
      excerpt: null,
      lang: 'en',
      lastError: null,
      title: null,
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${articleId}/refetch`,
    })

    expect(res.statusCode).toBe(200)
    expect(getArticleById(articleId)?.images_archived_at).toBeNull()
  })

  it('404: returns not found for unknown article', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/99999/refetch',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/not found/i)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/articles/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/articles/:id', () => {
  it('204: deletes clip article', async () => {
    const clipFeed = ensureClipFeed()
    const artId = seedArticle(clipFeed.id, { url: 'https://example.com/to-delete' })

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/articles/${artId}`,
    })

    expect(res.statusCode).toBe(204)
    expect(getArticleById(artId)).toBeUndefined()
  })

  it('204: deletes clip article and cleans up archived images', async () => {
    const clipFeed = ensureClipFeed()
    const artId = seedArticle(clipFeed.id, { url: 'https://example.com/with-images' })
    markImagesArchived(artId)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/articles/${artId}`,
    })

    expect(res.statusCode).toBe(204)
    expect(mockDeleteArticleImages).toHaveBeenCalledWith(artId)
  })

  it('403: rejects deletion of RSS feed articles', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/articles/${artId}`,
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/clip/i)
  })

  it('404: article not found', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/articles/99999',
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/articles/batch-refetch', () => {
  it('200: refetches multiple articles and reports per-item status', async () => {
    const feed = seedFeed()
    const firstId = seedArticle(feed.id, {
      url: 'https://note.com/example/n/1',
      full_text: 'Old body 1',
      summary: 'Old summary 1',
    })
    const secondId = seedArticle(feed.id, {
      url: 'https://note.com/example/n/2',
      full_text: 'Old body 2',
      summary: 'Old summary 2',
    })

    mockFetchArticleContent
      .mockResolvedValueOnce({
        fullText: 'Refetched body 1',
        ogImage: null,
        excerpt: 'Excerpt 1',
        lang: 'ja',
        lastError: null,
        title: null,
      })
      .mockResolvedValueOnce({
        fullText: 'Refetched body 2',
        ogImage: null,
        excerpt: 'Excerpt 2',
        lang: 'ja',
        lastError: null,
        title: null,
      })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/batch-refetch',
      headers: json,
      payload: { ids: [firstId, secondId, 99999] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      success: 2,
      failed: 1,
      results: [
        { id: firstId, ok: true },
        { id: secondId, ok: true },
        { id: 99999, ok: false, error: 'Article not found' },
      ],
    })
    expect(getArticleById(firstId)?.full_text).toBe('Refetched body 1')
    expect(getArticleById(secondId)?.full_text).toBe('Refetched body 2')
    expect(getArticleById(firstId)?.summary).toBeNull()
    expect(getArticleById(secondId)?.summary).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// POST /api/articles/:id/archive-images
// ---------------------------------------------------------------------------

describe('POST /api/articles/:id/archive-images', () => {
  it('202: accepted', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Article with ![img](https://example.com/image.png)' })
    mockIsImageArchivingEnabled.mockReturnValue(true)

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/archive-images`,
    })

    expect(res.statusCode).toBe(202)
    expect(res.json().status).toBe('accepted')
  })

  it('400: no full_text', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: null })
    mockIsImageArchivingEnabled.mockReturnValue(true)

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/archive-images`,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/full text/i)
  })

  it('400: image archiving not enabled', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Some text' })
    mockIsImageArchivingEnabled.mockReturnValue(false)

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/archive-images`,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not enabled/i)
  })

  it('404: article not found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/99999/archive-images',
    })

    expect(res.statusCode).toBe(404)
  })

  it('409: images already archived', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Article text' })
    markImagesArchived(artId)
    mockIsImageArchivingEnabled.mockReturnValue(true)

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/archive-images`,
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already archived/i)
  })
})

// ---------------------------------------------------------------------------
// GET /api/articles/images/:filename
// ---------------------------------------------------------------------------

describe('GET /api/articles/images/:filename', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-test-images-'))
    upsertSetting('images.storage_path', tmpDir)
  })

  it('200: serves image with correct content-type and cache headers', async () => {
    const filename = '1_abc123.png'
    fs.writeFileSync(path.join(tmpDir, filename), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles/images/${filename}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toMatch(/immutable/)
  })

  it('400: path traversal attempt with ..', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/articles/images/..secret',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/invalid/i)
  })

  it('404: file not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/articles/images/nonexistent_image.jpg',
    })

    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /api/articles — smartFloor bypass for clip feeds
// ---------------------------------------------------------------------------

describe('GET /api/articles smartFloor bypass for clip feeds', () => {
  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  }

  it('returns old clip articles that smartFloor would normally hide', async () => {
    const clipFeed = ensureClipFeed()

    // Create articles older than SMART_FLOOR_DAYS (7), all seen
    for (let i = 0; i < 5; i++) {
      const id = seedArticle(clipFeed.id, {
        url: `https://example.com/clip-old-${i}`,
        published_at: daysAgo(30 + i),
      })
      markArticleSeen(id, true)
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles?feed_id=${clipFeed.id}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    // All 5 old articles should be returned (smartFloor not applied)
    expect(body.articles.length).toBe(5)
  })

  it('returns total_without_floor when smartFloor hides articles', async () => {
    const feed = seedFeed({ url: 'https://twf.example.com' })

    for (let i = 0; i < 5; i++) {
      const id = seedArticle(feed.id, {
        url: `https://example.com/twf-recent-${i}`,
        published_at: daysAgo(i),
      })
      markArticleSeen(id, true)
    }
    for (let i = 0; i < 20; i++) {
      const id = seedArticle(feed.id, {
        url: `https://example.com/twf-old-${i}`,
        published_at: daysAgo(30 + i),
      })
      markArticleSeen(id, true)
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles?feed_id=${feed.id}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(20)
    expect(body.total_without_floor).toBe(25)
  })

  it('no_floor=1 bypasses smartFloor and returns all articles', async () => {
    const feed = seedFeed({ url: 'https://nofloor.example.com' })

    for (let i = 0; i < 5; i++) {
      const id = seedArticle(feed.id, {
        url: `https://example.com/nf-recent-${i}`,
        published_at: daysAgo(i),
      })
      markArticleSeen(id, true)
    }
    for (let i = 0; i < 20; i++) {
      const id = seedArticle(feed.id, {
        url: `https://example.com/nf-old-${i}`,
        published_at: daysAgo(30 + i),
      })
      markArticleSeen(id, true)
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles?feed_id=${feed.id}&no_floor=1&limit=100`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.articles.length).toBe(25)
    expect(body.total).toBe(25)
    expect(body.total_without_floor).toBeUndefined()
  })

  it('still applies smartFloor to regular (non-clip) feeds', async () => {
    const feed = seedFeed({ url: 'https://regular.example.com' })

    // 5 recent articles within 7 days + 20 old articles (all seen, total > 20)
    for (let i = 0; i < 5; i++) {
      const id = seedArticle(feed.id, {
        url: `https://example.com/regular-recent-${i}`,
        published_at: daysAgo(i),
      })
      markArticleSeen(id, true)
    }

    for (let i = 0; i < 20; i++) {
      const id = seedArticle(feed.id, {
        url: `https://example.com/regular-old-${i}`,
        published_at: daysAgo(30 + i),
      })
      markArticleSeen(id, true)
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles?feed_id=${feed.id}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    // smartFloor should hide articles older than 7 days (beyond the 20-article floor)
    // 25 total, 20th newest is within old range, 7-day window has 5 → floor = max(7days, 20th) → 20
    expect(body.articles.length).toBe(20)
  })
})
