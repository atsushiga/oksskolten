import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { startSSE } from '../lib/sse.js'
import { logger } from '../logger.js'

const log = logger.child('search')
import {
  getArticles,
  getArticleByUrl,
  getArticleById,
  getArticlesByIds,
  markArticleSeen,
  markArticlesSeen,
  markArticlesSeenState,
  recordArticleRead,
  markArticleBookmarked,
  markArticleLiked,
  updateArticleContent,
  updateArticleComment,
  updateScore,
  getExistingArticleUrls,
  getClipFeed,
  getFeedById,
  insertArticle,
  deleteArticle,
  deleteArticles,
  getSimilarArticles,
  getDb,
  clearImagesArchived,
  type ArticleDetail,
} from '../db.js'
import type { MeiliArticleDoc } from '../search/client.js'
import { buildMeiliFilter, meiliSearch } from '../search/client.js'
import { isSearchReady, syncArticleToSearch } from '../search/sync.js'
import { requireJson } from '../auth.js'
import { summarizeArticle, translateArticle, streamSummarizeArticle, streamTranslateArticle, fetchArticleContent } from '../fetcher.js'
import type { AiTextResult } from '../fetcher.js'
import { fetchAndParseRss } from '../fetcher/rss.js'
import { cleanUrl } from '../fetcher/url-cleaner.js'
import { archiveArticleImages, isImageArchivingEnabled, deleteArticleImages } from '../fetcher/article-images.js'
import { getSetting } from '../db/settings.js'
import path from 'node:path'
import fs from 'node:fs'
import { dataPath } from '../paths.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'

function getTranslateTargetLang(): string {
  return getSetting('translate.target_lang') || getSetting('general.language') || 'ja'
}

const DEFAULT_ARTICLE_LIMIT = 20
const MAX_ARTICLE_LIMIT = 100
const MAX_CHECK_URLS = 200
const MAX_BATCH_SEEN = 100
const MAX_SEARCH_LIMIT = 50

// Coerce to number, treating NaN as undefined to preserve existing behavior
const coerceOptionalNumber = z.preprocess(
  (val) => { const n = Number(val); return Number.isNaN(n) ? undefined : n },
  z.number().optional(),
)

const ArticlesQuery = z.object({
  feed_id: coerceOptionalNumber,
  category_id: coerceOptionalNumber,
  unread: z.string().optional(),
  bookmarked: z.string().optional(),
  liked: z.string().optional(),
  commented: z.string().optional(),
  read: z.string().optional(),
  sort: z.string().optional(),
  no_floor: z.string().optional(),
  limit: coerceOptionalNumber,
  offset: coerceOptionalNumber,
})

const SearchQuery = z.object({
  q: z.string().min(1, 'q is required'),
  feed_id: coerceOptionalNumber,
  category_id: coerceOptionalNumber,
  unread: z.string().optional(),
  liked: z.string().optional(),
  bookmarked: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: coerceOptionalNumber,
  offset: coerceOptionalNumber,
})

const ByUrlQuery = z.object({
  url: z.string().min(1, 'url is required'),
})

const CheckUrlsBody = z.object({
  urls: z.array(z.string()).min(1, 'urls must be a non-empty array').max(MAX_CHECK_URLS, `Maximum ${MAX_CHECK_URLS} urls per request`),
})

const httpsUrl = z
  .string({ error: 'url is required' })
  .min(1, 'url is required')
  .url('must be a valid URL')
  .refine((u) => u.startsWith('https://'), { message: 'Only https:// URLs are allowed' })

const FromUrlBody = z.object({
  url: httpsUrl,
  title: z.string().optional(),
  html: z.string().optional(),
  force: z.boolean().optional(),
})

const SeenBody = z.object({ seen: z.boolean({ message: 'seen must be a boolean' }) })
const BookmarkBody = z.object({ bookmarked: z.boolean({ message: 'bookmarked must be a boolean' }) })
const LikeBody = z.object({ liked: z.boolean({ message: 'liked must be a boolean' }) })
const CommentBody = z.object({ comment: z.string().max(5000, 'comment must be 5000 characters or fewer') })
const BatchSeenBody = z.object({
  ids: z.array(z.number()).min(1, 'ids must be a non-empty array').max(MAX_BATCH_SEEN, `Maximum ${MAX_BATCH_SEEN} ids per request`),
  seen: z.boolean().optional(),
})
const BatchDeleteBody = z.object({
  ids: z.array(z.number()).min(1, 'ids must be a non-empty array').max(MAX_BATCH_SEEN, `Maximum ${MAX_BATCH_SEEN} ids per request`),
})
const BatchRefetchBody = z.object({
  ids: z.array(z.number()).min(1, 'ids must be a non-empty array').max(MAX_BATCH_SEEN, `Maximum ${MAX_BATCH_SEEN} ids per request`),
})
const StreamQuery = z.object({ stream: z.string().optional() })
const FilenameParams = z.object({ filename: z.string() })

// --- Known error codes that the frontend can i18n-translate ---

const KNOWN_ERROR_CODES = new Set([
  'ANTHROPIC_KEY_NOT_SET',
  'GEMINI_KEY_NOT_SET',
  'OPENAI_KEY_NOT_SET',
  'GOOGLE_TRANSLATE_KEY_NOT_SET',
  'DEEPL_KEY_NOT_SET',
  'SUMMARIZATION_FAILED',
  'TRANSLATION_FAILED',
])

function extractKnownErrorCode(err: unknown): string | null {
  if (err instanceof Error) {
    if (KNOWN_ERROR_CODES.has(err.message)) return err.message
    const code = (err as Error & { code?: string }).code
    if (code && KNOWN_ERROR_CODES.has(code)) return code
  }
  return null
}

function extractClientErrorMessage(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  if (err.message.startsWith('DeepL API error:')) return err.message
  if (err.message.startsWith('Google Translate API error:')) return err.message
  return null
}

// --- Shared AI handler for summarize/translate ---

interface AiHandlerConfig {
  getCached: (article: ArticleDetail) => string | null
  validate?: (article: ArticleDetail) => string | null
  streamFn: (fullText: string, onDelta: (d: string) => void) => Promise<{ text: string } & AiTextResult>
  nonStreamFn: (fullText: string) => Promise<{ text: string } & AiTextResult>
  applyResult: (articleId: number, text: string) => void
  errorMessage: string
  errorCode: string
}

function createAiHandler(config: AiHandlerConfig) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const params = NumericIdParams.parse(request.params)
    const article = getArticleById(params.id)
    if (!article) {
      reply.status(404).send({ error: 'Article not found' })
      return
    }

    const cached = config.getCached(article)
    if (cached) {
      reply.send({ text: cached, cached: true })
      return
    }

    if (!article.full_text) {
      reply.status(400).send({ error: 'No full text available' })
      return
    }

    const validationError = config.validate?.(article)
    if (validationError) {
      reply.status(400).send({ error: validationError })
      return
    }

    const { stream } = StreamQuery.parse(request.query)

    try {
      if (stream === '1') {
        const sse = startSSE(reply)
        const result = await config.streamFn(
          article.full_text,
          (delta) => { sse.send({ type: 'delta', text: delta }) },
        )
        config.applyResult(article.id, result.text)
        const usage = formatUsage(result)
        sse.send({ type: 'done', usage })
        sse.end()
      } else {
        const result = await config.nonStreamFn(article.full_text)
        config.applyResult(article.id, result.text)
        reply.send({ text: result.text, usage: formatUsage(result) })
      }
    } catch (err) {
      request.log.error(err, config.errorMessage)
      const errorCode = extractKnownErrorCode(err)
      const clientError = extractClientErrorMessage(err)
      const errorMsg = errorCode ?? clientError ?? config.errorCode
      if (reply.raw.headersSent) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`)
        reply.raw.end()
      } else {
        reply.status(500).send({ error: errorMsg })
      }
    }
  }
}

function formatUsage(result: AiTextResult) {
  return {
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    billing_mode: result.billingMode,
    model: result.model,
    ...(result.monthlyChars != null ? { monthly_chars: result.monthlyChars } : {}),
  }
}

async function findRssListingExcerpt(article: ArticleDetail): Promise<string | undefined> {
  if (article.feed_type !== 'rss') return undefined
  const feed = getFeedById(article.feed_id)
  if (!feed) return undefined

  try {
    const rss = await fetchAndParseRss(feed, { skipCache: true })
    const targetUrl = cleanUrl(article.url)
    const match = rss.items.find((item) => cleanUrl(item.url) === targetUrl)
    return match?.excerpt
  } catch {
    return undefined
  }
}

async function refetchArticleContent(
  article: ArticleDetail,
  request: FastifyRequest,
): Promise<ArticleDetail | undefined> {
  const listingExcerpt = await findRssListingExcerpt(article)
  const content = await fetchArticleContent(article.url, {
    listingExcerpt,
  })

  if (article.images_archived_at) {
    try {
      deleteArticleImages(article.id)
    } catch (err) {
      request.log.error(err, 'Failed to delete archived images during refetch')
    }
    clearImagesArchived(article.id)
  }

  updateArticleContent(article.id, {
    lang: content.lang,
    full_text: content.fullText,
    full_text_translated: null,
    translated_lang: null,
    summary: null,
    excerpt: content.excerpt,
    og_image: content.ogImage,
    last_error: content.lastError,
  })

  return getArticleById(article.id)
}

export async function articleRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/articles', async (request, reply) => {
    const query = ArticlesQuery.parse(request.query)
    const limit = Math.min(Math.max(query.limit || DEFAULT_ARTICLE_LIMIT, 1), MAX_ARTICLE_LIMIT)
    const offset = Math.max(query.offset || 0, 0)
    const feedId = query.feed_id ?? undefined
    const categoryId = query.category_id ?? undefined
    const unread = query.unread === '1'
  const bookmarked = query.bookmarked === '1'
  const liked = query.liked === '1'
  const commented = query.commented === '1'
  const read = query.read === '1'
    const sort = query.sort === 'score' ? 'score' as const : undefined
    const noFloor = query.no_floor === '1'

    const isClipFeed = feedId != null && getClipFeed()?.id === feedId
    const smartFloor = !noFloor && !isClipFeed && !unread && !bookmarked && !liked && !commented && !read
    const { articles, total, totalWithoutFloor } = getArticles({ feedId, categoryId, unread, bookmarked, liked, commented, read, sort, limit, offset, smartFloor })
    const hasMore = offset + articles.length < total

    // When unread filter yields 0 results, return total article count (without unread filter)
    // so the UI can distinguish "no articles" from "all read"
    let totalAll: number | undefined
    if (unread && total === 0 && offset === 0) {
      const allResult = getArticles({ feedId, categoryId, limit: 0, offset: 0 })
      totalAll = allResult.total
    }

    reply.send({ articles, total, has_more: hasMore, ...(totalWithoutFloor != null ? { total_without_floor: totalWithoutFloor } : {}), ...(totalAll != null ? { total_all: totalAll } : {}) })
  })

  api.get('/api/articles/search', async (request, reply) => {
    const query = parseOrBadRequest(SearchQuery, request.query, reply)
    if (!query) return

    if (!isSearchReady()) {
      reply.status(503).send({ error: 'Search index is building' })
      return
    }

    const limit = Math.min(Math.max(query.limit || DEFAULT_ARTICLE_LIMIT, 1), MAX_SEARCH_LIMIT)
    const offset = Math.max(query.offset || 0, 0)
    const unread = query.unread === '1' ? true : query.unread === '0' ? false : undefined
    const liked = query.liked === '1'
    const bookmarked = query.bookmarked === '1'

    try {
      const filter = buildMeiliFilter({
        feed_id: query.feed_id,
        category_id: query.category_id,
        since: query.since,
        until: query.until,
        unread,
        liked,
        bookmarked,
      })

      const { hits, estimatedTotalHits } = await meiliSearch(query.q, { limit, offset, filter })
      const ids = hits.map((h) => h.id)

      const articles = getArticlesByIds(ids)
      const hasMore = offset + hits.length < estimatedTotalHits
      reply.send({ articles, has_more: hasMore })
    } catch (err) {
      log.error('Meilisearch query failed:', err)
      reply.send({ articles: [] })
    }
  })

  api.get('/api/articles/by-url', async (request, reply) => {
    const query = parseOrBadRequest(ByUrlQuery, request.query, reply)
    if (!query) return
    const article = getArticleByUrl(query.url)
    if (!article) {
      reply.status(404).send({ error: 'Article not found' })
      return
    }
    reply.send({ ...article, imageArchivingEnabled: isImageArchivingEnabled() })
  })

  api.post('/api/articles/check-urls', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(CheckUrlsBody, request.body, reply)
    if (!body) return
    const existing = getExistingArticleUrls(body.urls)
    reply.send({ existing: [...existing] })
  })

  api.post(
    '/api/articles/from-url',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(FromUrlBody, request.body, reply)
      if (!body) return

      // Check if article already exists
      const existing = getArticleByUrl(body.url)
      if (existing) {
        if (existing.feed_type === 'clip') {
          if (body.html) {
            const content = await fetchArticleContent(body.url, { providedHtml: body.html })
            if (existing.images_archived_at) {
              try {
                deleteArticleImages(existing.id)
              } catch (err) {
                request.log.error(err, 'Failed to delete archived images during clip refresh')
              }
              clearImagesArchived(existing.id)
            }
            updateArticleContent(existing.id, {
              lang: content.lang,
              full_text: content.fullText,
              full_text_translated: null,
              translated_lang: null,
              summary: null,
              excerpt: content.excerpt,
              og_image: content.ogImage,
              last_error: content.lastError,
            })
            const refreshed = getArticleById(existing.id)
            reply.status(200).send({ article: refreshed, refetched: true })
            return
          }
          // Already in clips — block
          reply.status(409).send({ error: 'Article already exists', article: existing })
          return
        }
        // Exists in RSS feed — prompt or force-move
        if (!body.force) {
          reply.status(409).send({
            error: 'Article exists in feed',
            article: existing,
            can_force: true,
          })
          return
        }
        // force=true → move article to clip feed
        const clipFeed = getClipFeed()
        if (!clipFeed) {
          reply.status(500).send({ error: 'Clip feed not found' })
          return
        }
        const moved = getDb().transaction(() => {
          getDb().prepare('UPDATE articles SET feed_id = ?, category_id = NULL WHERE id = ?').run(clipFeed.id, existing.id)
          return getArticleById(existing.id)
        })()
        if (body.html) {
          const content = await fetchArticleContent(body.url, { providedHtml: body.html })
          if (existing.images_archived_at) {
            try {
              deleteArticleImages(existing.id)
            } catch (err) {
              request.log.error(err, 'Failed to delete archived images during clip move refresh')
            }
            clearImagesArchived(existing.id)
          }
          updateArticleContent(existing.id, {
            lang: content.lang,
            full_text: content.fullText,
            full_text_translated: null,
            translated_lang: null,
            summary: null,
            excerpt: content.excerpt,
            og_image: content.ogImage,
            last_error: content.lastError,
          })
        }
        const movedArticle = getArticleById(existing.id) ?? moved
        // Sync clip move to Meilisearch (best-effort, outside transaction)
        const movedDoc = getDb().prepare(`
          SELECT id, feed_id, category_id, title,
                 COALESCE(full_text, '') AS full_text,
                 COALESCE(full_text_translated, '') AS full_text_translated,
                 lang,
                 COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
                 COALESCE(score, 0) AS score
          FROM articles WHERE id = ?
        `).get(existing.id) as MeiliArticleDoc | undefined
        if (movedDoc) syncArticleToSearch(movedDoc)
        reply.status(200).send({ article: movedArticle, moved: true, ...(body.html ? { refetched: true } : {}) })
        return
      }

      // Get clip feed
      const clipFeed = getClipFeed()
      if (!clipFeed) {
        reply.status(500).send({ error: 'Clip feed not found' })
        return
      }

      // Fetch content (same pipeline as RSS feeds)
      const content = body.html
        ? await fetchArticleContent(body.url, { providedHtml: body.html })
        : await fetchArticleContent(body.url)

      const title = body.title || content.title || new URL(body.url).hostname
      const articleId = insertArticle({
        feed_id: clipFeed.id,
        title,
        url: body.url,
        published_at: new Date().toISOString(),
        lang: content.lang,
        full_text: content.fullText,
        excerpt: content.excerpt,
        og_image: content.ogImage,
        last_error: content.lastError,
      })

      const article = getArticleById(articleId)
      reply.status(201).send({ article, created: true })
    },
  )

  api.post(
    '/api/articles/:id/refetch',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const article = getArticleById(params.id)
      if (!article) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }

      const updated = await refetchArticleContent(article, request)
      reply.send({ article: updated, refetched: true })
    },
  )

  api.post(
    '/api/articles/batch-refetch',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(BatchRefetchBody, request.body, reply)
      if (!body) return

      const results: Array<{ id: number; ok: boolean; error?: string }> = []
      for (const id of body.ids) {
        const article = getArticleById(id)
        if (!article) {
          results.push({ id, ok: false, error: 'Article not found' })
          continue
        }
        try {
          await refetchArticleContent(article, request)
          results.push({ id, ok: true })
        } catch (err) {
          request.log.error(err, `Failed to batch refetch article ${id}`)
          results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Refetch failed' })
        }
      }

      reply.send({
        success: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok).length,
        results,
      })
    },
  )

  api.patch(
    '/api/articles/:id/seen',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(SeenBody, request.body, reply)
      if (!body) return
      const result = markArticleSeen(params.id, body.seen)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.patch(
    '/api/articles/:id/bookmark',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(BookmarkBody, request.body, reply)
      if (!body) return
      const result = markArticleBookmarked(params.id, body.bookmarked)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.patch(
    '/api/articles/:id/like',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(LikeBody, request.body, reply)
      if (!body) return
      const result = markArticleLiked(params.id, body.liked)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.patch(
    '/api/articles/:id/comment',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(CommentBody, request.body, reply)
      if (!body) return
      const normalized = body.comment.trim()
      const result = updateArticleComment(params.id, normalized.length > 0 ? normalized : null)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.post(
    '/api/articles/batch-seen',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(BatchSeenBody, request.body, reply)
      if (!body) return
      const result = body.seen === false ? markArticlesSeenState(body.ids, false) : markArticlesSeen(body.ids)
      reply.send(result)
    },
  )

  api.post(
    '/api/articles/batch-delete',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(BatchDeleteBody, request.body, reply)
      if (!body) return
      for (const id of body.ids) {
        const article = getArticleById(id)
        if (article?.images_archived_at) {
          try {
            deleteArticleImages(id)
          } catch (err) {
            request.log.error(err, 'Failed to delete archived images')
          }
        }
      }
      reply.send(deleteArticles(body.ids))
    },
  )

  api.post(
    '/api/articles/:id/read',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const result = recordArticleRead(params.id)
      if (!result) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      reply.send(result)
    },
  )

  api.post(
    '/api/articles/:id/summarize',
    { preHandler: [requireJson] },
    createAiHandler({
      getCached: (article) => article.summary,
      streamFn: async (fullText, onDelta) => {
        const r = await streamSummarizeArticle(fullText, onDelta)
        return { text: r.summary, ...r }
      },
      nonStreamFn: async (fullText) => {
        const r = await summarizeArticle(fullText)
        return { text: r.summary, ...r }
      },
      applyResult: (articleId, text) => {
        updateArticleContent(articleId, { summary: text })
      },
      errorMessage: 'Summarization failed',
      errorCode: 'SUMMARIZATION_FAILED',
    }),
  )

  api.post(
    '/api/articles/:id/translate',
    { preHandler: [requireJson] },
    createAiHandler({
      getCached: (article) => {
        const userLang = getTranslateTargetLang()
        return article.translated_lang === userLang ? article.full_text_translated : null
      },
      validate: (article) => {
        const userLang = getTranslateTargetLang()
        return article.lang === userLang ? `Article is already in ${userLang}` : null
      },
      streamFn: async (fullText, onDelta) => {
        const r = await streamTranslateArticle(fullText, onDelta)
        return { text: r.fullTextTranslated, ...r }
      },
      nonStreamFn: async (fullText) => {
        const r = await translateArticle(fullText)
        return { text: r.fullTextTranslated, ...r }
      },
      applyResult: (articleId, text) => {
        const userLang = getTranslateTargetLang()
        updateArticleContent(articleId, { full_text_translated: text, translated_lang: userLang })
        updateScore(articleId)
      },
      errorMessage: 'Translation failed',
      errorCode: 'TRANSLATION_FAILED',
    }),
  )

  // --- Image archiving ---

  api.post(
    '/api/articles/:id/archive-images',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const article = getArticleById(params.id)
      if (!article) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      if (!article.full_text) {
        reply.status(400).send({ error: 'No full text available' })
        return
      }
      if (!isImageArchivingEnabled()) {
        reply.status(400).send({ error: 'Image archiving is not enabled' })
        return
      }
      if (article.images_archived_at) {
        reply.status(409).send({ error: 'Images already archived' })
        return
      }

      // Return 202 and process in background
      reply.status(202).send({ status: 'accepted' })

      // Background processing
      archiveArticleImages(article.id, article.full_text).catch(err => {
        request.log.error(err, 'archive-images failed')
      })
    },
  )

  api.get(
    '/api/articles/:id/similar',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const similar = getSimilarArticles(params.id)
      reply.send({ similar })
    },
  )

  api.delete(
    '/api/articles/:id',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const article = getArticleById(params.id)
      if (!article) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }
      if (article.feed_type !== 'clip') {
        reply.status(403).send({ error: 'Only clipped articles can be deleted' })
        return
      }
      // Clean up archived images if any
      if (article.images_archived_at) {
        try {
          deleteArticleImages(article.id)
        } catch (err) {
          request.log.error(err, 'Failed to delete archived images')
        }
      }
      deleteArticle(article.id)
      reply.status(204).send()
    },
  )

  // --- Serve archived images ---

  api.get(
    '/api/articles/images/:filename',
    async (request, reply) => {
      const { filename } = FilenameParams.parse(request.params)

      // Sanitize filename to prevent path traversal
      const sanitized = path.basename(filename)
      if (sanitized !== filename || filename.includes('..')) {
        reply.status(400).send({ error: 'Invalid filename' })
        return
      }

      const storagePath = getSetting('images.storage_path') || dataPath('articles', 'images')
      const filepath = path.join(storagePath, sanitized)

      if (!fs.existsSync(filepath)) {
        reply.status(404).send({ error: 'Image not found' })
        return
      }

      const ext = path.extname(sanitized).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.avif': 'image/avif',
      }
      const contentType = mimeMap[ext] || 'application/octet-stream'

      reply.header('Content-Type', contentType)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      reply.send(fs.createReadStream(filepath))
    },
  )
}
