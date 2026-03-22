import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import useSWR from 'swr'
import { renderMarkdown } from '../../lib/markdown'
import { sanitizeHtml } from '../../lib/sanitize'
import { fetcher, apiPatch, apiPost } from '../../lib/fetcher'
import { queueSeenIds } from '../../lib/offlineQueue'
import { useSWRConfig } from 'swr'
import { trackRead } from '../../lib/readTracker'
import { useArticleActions } from '../../hooks/use-article-actions'
import { useI18n } from '../../lib/i18n'
import { useRewriteInternalLinks } from '../../hooks/use-rewrite-internal-links'
import { ImageLightbox } from '../ui/image-lightbox'
import { ChatFab } from '../chat/chat-fab'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { useChatInline, ChatInlinePanel } from '../chat/chat-inline'
import { useMetrics } from '../../hooks/use-metrics'
import { useSummarize } from '../../hooks/use-summarize'
import { useTranslate } from '../../hooks/use-translate'
import { formatDetailDate } from '../../lib/dateFormat'
import { patchArticleCacheValue } from '../../lib/article-cache'
import { bumpArticleListInvalidationVersion } from '../../lib/article-sync'
import { useAppLayout } from '../../app'
import { Skeleton } from '../ui/skeleton'
import { Callout } from '../ui/callout'
import { Button } from '../ui/button'
import { useIsTouchDevice } from '../../hooks/use-is-touch-device'
import { ArticleToolbar } from './article-toolbar'
import { ArticleSummarySection } from './article-summary-section'
import { ArticleTranslationBanner } from './article-translation-banner'
import { ArticleContentBody } from './article-content-body'
import { ArticleSimilarBanner } from './article-similar-banner'
import { ChevronUp } from 'lucide-react'
import type { ArticleDetail as ArticleDetailData } from '../../../shared/types'

interface ArticleDetailProps {
  articleUrl: string
}

export function ArticleDetail({ articleUrl }: ArticleDetailProps) {
  const { settings: { internalLinks, chatPosition, translateTargetLang } } = useAppLayout()
  const navigate = useNavigate()
  const { t, tError, isKeyNotSetError, locale } = useI18n()
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`
  const { data: article, error, mutate } = useSWR<ArticleDetailData>(articleKey, fetcher)
  const { mutate: globalMutate } = useSWRConfig()
  const isTouchDevice = useIsTouchDevice()

  const isUserLang = article?.lang === (translateTargetLang || locale)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentEditorOpen, setCommentEditorOpen] = useState(false)
  const [showScrollToTop, setShowScrollToTop] = useState(false)

  const articleRef = useRef<HTMLElement>(null)

  const metrics = useMetrics()
  const { summary, summarizing, streamingText, handleSummarize, summaryHtml, streamingHtml, error: summarizeError } = useSummarize(article, metrics)
  // Only pass translation to the hook if it matches the current locale; stale translations are treated as absent
  const isTranslationCurrent = article?.translated_lang === (translateTargetLang || locale)
  const translateInput = useMemo(() =>
    article ? { id: article.id, full_text_translated: isTranslationCurrent ? article.full_text_translated : null } : undefined,
    [article, isTranslationCurrent],
  )
  const { viewMode, setViewMode, translating, translatingText, fullTextTranslated, handleTranslate, translatingHtml, error: translateError } = useTranslate(translateInput, metrics)
  const {
    isBookmarked, isLiked, isSeen, archivingImages, refetching, deleteConfirmOpen, setDeleteConfirmOpen,
    toggleBookmark, toggleLike, toggleSeen, handleArchiveImages, handleRefetch, handleDelete,
  } = useArticleActions(article, articleKey)
  const chat = useChatInline(article?.id ?? 0)
  const previousArticleStateRef = useRef<Pick<ArticleDetailData, 'id' | 'bookmarked_at' | 'liked_at' | 'comment' | 'comment_updated_at' | 'seen_at' | 'read_at'> | null>(null)

  const syncArticleCaches = useCallback((articleId: number, patch: Parameters<typeof patchArticleCacheValue>[2]) => {
    void globalMutate(
      (key: unknown) => typeof key === 'string' && key.startsWith('/api/articles'),
      (current: unknown) => patchArticleCacheValue(current, articleId, patch),
      { revalidate: false },
    )
  }, [globalMutate])

  // Sync translation/summary back into SWR cache so it persists across navigations
  useEffect(() => {
    if (fullTextTranslated && article && article.full_text_translated !== fullTextTranslated) {
      void mutate({ ...article, full_text_translated: fullTextTranslated, translated_lang: locale }, false)
    }
  }, [fullTextTranslated]) // eslint-disable-line react-hooks/exhaustive-deps -- only sync when translated text changes; article/mutate are refs to current data

  useEffect(() => {
    if (summary && article && article.summary !== summary) {
      void mutate({ ...article, summary }, false)
    }
  }, [summary]) // eslint-disable-line react-hooks/exhaustive-deps -- only sync when summary changes; article/mutate are refs to current data

  useEffect(() => {
    setCommentDraft(article?.comment ?? '')
    setCommentEditorOpen(!!article?.comment)
  }, [article?.comment])

  useEffect(() => {
    if (!article) return
    const previous = previousArticleStateRef.current
    if (previous && previous.id === article.id && (
      previous.bookmarked_at !== article.bookmarked_at
      || previous.liked_at !== article.liked_at
      || previous.comment !== article.comment
      || previous.comment_updated_at !== article.comment_updated_at
      || previous.seen_at !== article.seen_at
      || previous.read_at !== article.read_at
    )) {
      syncArticleCaches(article.id, {
        bookmarked_at: article.bookmarked_at,
        liked_at: article.liked_at,
        comment: article.comment,
        comment_updated_at: article.comment_updated_at,
        seen_at: article.seen_at,
        read_at: article.read_at,
      })
    }
    previousArticleStateRef.current = {
      id: article.id,
      bookmarked_at: article.bookmarked_at,
      liked_at: article.liked_at,
      comment: article.comment,
      comment_updated_at: article.comment_updated_at,
      seen_at: article.seen_at,
      read_at: article.read_at,
    }
  }, [article, syncArticleCaches])

  // Record article read on mount
  const viewedRef = useRef<number | null>(null)
  useEffect(() => {
    if (article && viewedRef.current !== article.id) {
      viewedRef.current = article.id
      const isFirstSeen = article.seen_at == null
      if (isFirstSeen) {
        trackRead(article.id)
      }
      apiPost(`/api/articles/${article.id}/read`)
        .then(() => globalMutate((key: string) => typeof key === 'string' && key.startsWith('/api/feeds')))
        .catch(async () => {
          if (isFirstSeen) {
            await queueSeenIds([article.id])
          }
        })
    }
  }, [article, globalMutate])

  const content = useMemo(() => {
    if (!article) return ''
    let md = ''
    if (viewMode === 'translated' && !isUserLang) {
      md = fullTextTranslated || ''
    } else {
      md = article.full_text || ''
    }
    if (!md) return `<p class="text-muted">${t('article.noContent')}</p>`
    return sanitizeHtml(renderMarkdown(md))
  }, [article, viewMode, isUserLang, fullTextTranslated, t])

  const displayedCharCount = useMemo(() => {
    if (!article) return 0
    const source = viewMode === 'translated' && !isUserLang
      ? (fullTextTranslated || '')
      : (article.full_text || '')
    return Array.from(source).length
  }, [article, viewMode, isUserLang, fullTextTranslated])

  const { rewrittenHtml: displayContent } = useRewriteInternalLinks(
    content,
    articleUrl,
    internalLinks === 'on',
  )

  // Event delegation: single listener on <article> handles all image clicks & errors
  const hasArticle = !!article
  useEffect(() => {
    const container = articleRef.current
    if (!container) return

    const handleClick = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest('.prose img') as HTMLImageElement | null
      if (img) {
        setLightboxSrc(img.currentSrc || img.src)
        return
      }

      const anchor = (e.target as HTMLElement).closest('.prose a') as HTMLAnchorElement | null
      if (anchor) {
        e.preventDefault()
        if (anchor.hasAttribute('data-internal-link')) {
          const path = anchor.getAttribute('href')
          if (path) void navigate(path)
        } else {
          const href = anchor.getAttribute('href')
          if (href) window.open(href, '_blank', 'noopener,noreferrer')
        }
      }
    }

    const handleError = (e: Event) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'IMG' && el.closest('.prose')) {
        el.classList.add('error')
      }
    }

    container.addEventListener('click', handleClick)
    container.addEventListener('error', handleError, true)

    return () => {
      container.removeEventListener('click', handleClick)
      container.removeEventListener('error', handleError, true)
    }
  }, [hasArticle, navigate])

  useEffect(() => {
    if (!isTouchDevice) return
    const handleScroll = () => setShowScrollToTop(window.scrollY > 320)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [isTouchDevice])

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 md:px-10 py-12 text-center">
        <p className="text-muted">{t('article.notFound')}</p>
      </div>
    )
  }

  if (!article) {
    return (
      <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/6 mt-4" />
        <Skeleton className="h-8 w-1/2 mt-6" />
        <div className="space-y-3 mt-8">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    )
  }

  const hasTranslation = !!fullTextTranslated
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })
  const handleToggleBookmark = () => {
    if (article) {
      syncArticleCaches(article.id, { bookmarked_at: isBookmarked ? null : new Date().toISOString() })
      bumpArticleListInvalidationVersion()
    }
    toggleBookmark()
  }
  const handleToggleLike = () => {
    if (article) {
      syncArticleCaches(article.id, { liked_at: isLiked ? null : new Date().toISOString() })
      bumpArticleListInvalidationVersion()
    }
    toggleLike()
  }
  const handleToggleSeen = () => {
    if (article) {
      syncArticleCaches(article.id, {
        seen_at: isSeen ? null : (article.seen_at ?? new Date().toISOString()),
        read_at: isSeen ? null : article.read_at,
      })
      bumpArticleListInvalidationVersion()
    }
    toggleSeen()
  }

  const saveComment = async () => {
    if (!article) return
    setCommentSaving(true)
    try {
      const result = await apiPatch(`/api/articles/${article.id}/comment`, { comment: commentDraft }) as { comment: string | null; comment_updated_at: string | null }
      await mutate({ ...article, comment: result.comment, comment_updated_at: result.comment_updated_at }, false)
      syncArticleCaches(article.id, { comment: result.comment, comment_updated_at: result.comment_updated_at })
      bumpArticleListInvalidationVersion()
      void globalMutate((key: string) => typeof key === 'string' && (
        key.startsWith('/api/feeds') || key.includes('/api/articles')
      ))
    } finally {
      setCommentSaving(false)
    }
  }

  return (
    <>
    <article ref={articleRef} className="article-card max-w-2xl mx-auto px-6 md:px-10 py-8">
      {/* Title */}
      <h1 className="mb-1.5 text-[28px] font-bold leading-[1.3] break-words [overflow-wrap:anywhere]">
        {article.title}
      </h1>

      {/* Date */}
      <p className="text-sm text-muted mb-3">
        {formatDetailDate(article.published_at, locale)}
        <span className="mx-2">•</span>
        {t('article.characterCount', { count: new Intl.NumberFormat(locale).format(displayedCharCount) })}
      </p>

      {/* Toolbar */}
      <ArticleToolbar
        article={article}
        chatPosition={chatPosition}
        chatOpen={chat.open}
        onChatToggle={chat.toggle}
        isUserLang={isUserLang}
        hasTranslation={hasTranslation}
        translating={translating}
        onTranslate={handleTranslate}
        summary={summary}
        summarizing={summarizing}
        onSummarize={handleSummarize}
        isBookmarked={!!isBookmarked}
        isLiked={isLiked}
        isSeen={isSeen}
        showCommentEditor={commentEditorOpen}
        archivingImages={archivingImages}
        refetching={refetching}
        onToggleBookmark={handleToggleBookmark}
        onToggleLike={handleToggleLike}
        onToggleCommentEditor={() => setCommentEditorOpen(open => !open)}
        onToggleSeen={handleToggleSeen}
        onArchiveImages={handleArchiveImages}
        onRefetch={handleRefetch}
        onDelete={() => setDeleteConfirmOpen(true)}
      />

      {commentEditorOpen && (
        <section className="mb-6 rounded-xl border border-border bg-bg-card p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-text">{t('article.comment')}</h2>
            {article.comment_updated_at && (
              <span className="text-xs text-muted">{formatDetailDate(article.comment_updated_at, locale)}</span>
            )}
          </div>
          <textarea
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            placeholder={t('article.commentPlaceholder')}
            className="min-h-28 w-full resize-y rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text placeholder:text-muted/50 outline-none focus:border-accent"
          />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setCommentDraft('')} disabled={commentSaving || commentDraft.length === 0}>
              {t('article.clearComment')}
            </Button>
            <Button onClick={() => void saveComment()} disabled={commentSaving}>
              {commentSaving ? t('article.savingComment') : t('article.saveComment')}
            </Button>
          </div>
        </section>
      )}

      {/* Inline Chat Panel */}
      {chatPosition === 'inline' && chat.open && (
        <ChatInlinePanel articleId={article.id} onClose={chat.close} />
      )}

      {/* Summary */}
      <ArticleSummarySection
        summary={summary}
        summarizing={summarizing}
        streamingText={streamingText}
        summaryHtml={summaryHtml}
        streamingHtml={streamingHtml}
        summarizeError={summarizeError}
        metricsText={metrics.metrics && !translating ? metrics.formatMetrics() : null}
      />

      {/* Similar articles */}
      {article.similar_count != null && article.similar_count > 0 && (
        <ArticleSimilarBanner articleId={article.id} similarCount={article.similar_count} />
      )}

      {/* Translate error */}
      {translateError && !translating && (
        <Callout variant="error">
          <p className="text-sm text-error">
            {tError(translateError)}
            {isKeyNotSetError(translateError) && (
              <>
                <Link to="/settings/integration" className="underline text-accent">{t('error.goToSettings')}</Link>
                {t('error.setApiKeyFromSettings')}
              </>
            )}
          </p>
        </Callout>
      )}

      {/* Translation metrics */}
      {metrics.metrics && !summarizing && !translating && hasTranslation && (
        <p className="text-xs text-muted mb-4">
          {metrics.formatMetrics()}
        </p>
      )}

      {/* Language banner */}
      {!isUserLang && hasTranslation && (
        <ArticleTranslationBanner
          viewMode={viewMode}
          onToggle={() => setViewMode(viewMode === 'translated' ? 'original' : 'translated')}
        />
      )}

      {/* Content */}
      <ArticleContentBody
        translating={translating}
        translatingText={translatingText}
        translatingHtml={translatingHtml}
        displayContent={displayContent}
      />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </article>
    {chatPosition === 'fab' && article && <ChatFab key={article.id} articleId={article.id} />}
    {isTouchDevice && showScrollToTop && (
      <Button
        type="button"
        size="icon"
        className={`fixed right-6 z-40 h-11 w-11 rounded-full shadow-lg md:hidden ${chatPosition === 'fab' ? 'bottom-[calc(5.5rem+var(--safe-area-inset-bottom))]' : 'bottom-[calc(1.5rem+var(--safe-area-inset-bottom))]'}`}
        onClick={scrollToTop}
        aria-label={t('article.scrollToTop')}
      >
        <ChevronUp className="h-5 w-5" />
      </Button>
    )}
    {deleteConfirmOpen && (
      <ConfirmDialog
        title={t('article.delete')}
        message={t('article.deleteConfirm')}
        confirmLabel={t('article.delete')}
        danger
        onConfirm={() => { setDeleteConfirmOpen(false); handleDelete() }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    )}
    </>
  )
}
