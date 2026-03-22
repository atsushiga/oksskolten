import type { ArticleListItem } from '../../shared/types'

type ArticleOverride = Partial<Pick<ArticleListItem, 'bookmarked_at' | 'liked_at' | 'seen_at' | 'read_at' | 'comment' | 'comment_updated_at'>>

const overrides = new Map<number, ArticleOverride>()

function emitChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('article-overrides-changed'))
}

export function setArticleOverride(articleId: number, override: ArticleOverride) {
  const current = overrides.get(articleId) ?? {}
  overrides.set(articleId, { ...current, ...override })
  emitChange()
}

export function clearArticleOverride(articleId: number, keys?: (keyof ArticleOverride)[]) {
  const current = overrides.get(articleId)
  if (!current) return
  if (!keys || keys.length === 0) {
    overrides.delete(articleId)
    emitChange()
    return
  }
  const next = { ...current }
  for (const key of keys) delete next[key]
  if (Object.keys(next).length === 0) overrides.delete(articleId)
  else overrides.set(articleId, next)
  emitChange()
}

export function getArticleOverride(articleId: number): ArticleOverride | undefined {
  return overrides.get(articleId)
}

export function applyArticleOverride<T extends ArticleListItem>(article: T): T {
  const override = overrides.get(article.id)
  return override ? { ...article, ...override } : article
}
