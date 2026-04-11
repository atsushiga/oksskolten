export function getArticleScrollTop(scrollContainer: HTMLElement | null): number {
  return scrollContainer?.scrollTop ?? window.scrollY
}

export function scrollArticleToTop(scrollContainer: HTMLElement | null): void {
  if (scrollContainer) {
    if (typeof scrollContainer.scrollTo === 'function') {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      scrollContainer.scrollTop = 0
    }
    return
  }

  window.scrollTo({ top: 0, behavior: 'smooth' })
}
