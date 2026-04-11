import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('./article-detail', () => ({
  ArticleDetail: ({ articleUrl }: { articleUrl: string }) => <div>{articleUrl}</div>,
}))

import { ArticleOverlay } from './article-overlay'

describe('ArticleOverlay', () => {
  it('marks the dialog content as the article scroll container', () => {
    render(<ArticleOverlay articleUrl="https://example.com/posts/1" onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-article-scroll-container')).toBe('')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()

    render(<ArticleOverlay articleUrl="https://example.com/posts/1" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
