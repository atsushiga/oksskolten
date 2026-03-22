const ARTICLE_LIST_INVALIDATION_KEY = 'article-list-invalidation-version'

function getWindowSafe(): Window | null {
  return typeof window === 'undefined' ? null : window
}

export function getArticleListInvalidationVersion(): number {
  const win = getWindowSafe()
  if (!win) return 0
  const raw = win.sessionStorage.getItem(ARTICLE_LIST_INVALIDATION_KEY)
  const parsed = raw ? Number(raw) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function bumpArticleListInvalidationVersion(): number {
  const win = getWindowSafe()
  if (!win) return 0
  const next = Date.now()
  win.sessionStorage.setItem(ARTICLE_LIST_INVALIDATION_KEY, String(next))
  win.dispatchEvent(new CustomEvent('article-list-invalidated', { detail: next }))
  return next
}
