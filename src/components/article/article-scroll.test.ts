import { describe, it, expect, vi } from 'vitest'
import { getArticleScrollTop, scrollArticleToTop } from './article-scroll'

describe('article scroll helpers', () => {
  it('reads scrollTop from the article container when provided', () => {
    const scrollContainer = document.createElement('div')

    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 400,
      writable: true,
      configurable: true,
    })

    expect(getArticleScrollTop(scrollContainer)).toBe(400)
  })

  it('scrolls the article container to the top when provided', () => {
    const scrollContainer = document.createElement('div')

    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 400,
      writable: true,
      configurable: true,
    })

    const scrollTo = vi.fn((options?: ScrollToOptions) => {
      scrollContainer.scrollTop = typeof options === 'object' ? (options.top ?? 0) : 0
    })

    Object.defineProperty(scrollContainer, 'scrollTo', {
      value: scrollTo,
      writable: true,
      configurable: true,
    })

    scrollArticleToTop(scrollContainer)

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(scrollContainer.scrollTop).toBe(0)
  })

  it('falls back to window scrolling when no article container is provided', () => {
    const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    scrollArticleToTop(null)

    expect(windowScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    windowScrollTo.mockRestore()
  })
})
