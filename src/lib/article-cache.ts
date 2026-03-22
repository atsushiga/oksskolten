import type { ArticleDetail, ArticleListItem } from '../../shared/types'

type ArticlePatch<T extends ArticleListItem = ArticleListItem> = Partial<T> | ((article: T) => T | null)

function isArticleLike(value: unknown): value is ArticleListItem {
  return typeof value === 'object' && value !== null && 'id' in value && typeof (value as { id?: unknown }).id === 'number'
}

function applyPatch<T extends ArticleListItem>(article: T, patch: ArticlePatch<T>): T | null {
  if (typeof patch === 'function') {
    return patch(article)
  }
  return { ...article, ...patch }
}

export function patchArticleCacheValue(
  current: unknown,
  articleId: number,
  patch: ArticlePatch,
): unknown {
  if (!current) return current

  if (Array.isArray(current)) {
    return current.map(page => {
      if (!page || typeof page !== 'object' || !('articles' in page) || !Array.isArray(page.articles)) {
        return page
      }
      return {
        ...page,
        articles: page.articles
          .map((article: ArticleListItem) => article.id === articleId ? applyPatch(article, patch) : article)
          .filter((article: ArticleListItem | null): article is ArticleListItem => article !== null),
      }
    })
  }

  if (typeof current === 'object' && current !== null && 'articles' in current && Array.isArray(current.articles)) {
    return {
      ...current,
      articles: current.articles
        .map((article: ArticleListItem) => article.id === articleId ? applyPatch(article, patch) : article)
        .filter((article: ArticleListItem | null): article is ArticleListItem => article !== null),
    }
  }

  if (isArticleLike(current) && current.id === articleId) {
    return applyPatch(current as ArticleDetail, patch)
  }

  return current
}
