import { useRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '../ui/dialog'
import { ArticleDetail } from './article-detail'

interface ArticleOverlayProps {
  articleUrl: string | null
  onClose: () => void
}

export function ArticleOverlay({ articleUrl, onClose }: ArticleOverlayProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog open={!!articleUrl} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPortal>
        <DialogOverlay className="duration-300" />
        <DialogPrimitive.Content
          ref={contentRef}
          className="fixed inset-y-0 right-0 z-[70] w-full md:w-2/3 bg-bg shadow-2xl overflow-y-auto overscroll-contain data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right duration-300"
          aria-describedby={undefined}
          data-keyboard-nav-passthrough=""
          data-article-scroll-container=""
        >
          <DialogTitle className="sr-only">Article</DialogTitle>
          {/* Close button */}
          <div
            className="sticky top-0 z-20 flex items-center border-b border-border bg-bg/90 backdrop-blur-sm"
            style={{
              height: 'calc(48px + var(--safe-area-inset-top))',
              paddingTop: 'var(--safe-area-inset-top)',
              paddingLeft: 'calc(1rem + env(safe-area-inset-left, 0px))',
              paddingRight: 'calc(1rem + env(safe-area-inset-right, 0px))',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-bg-card/80 text-text shadow-sm ring-1 ring-border/60 transition hover:bg-hover active:scale-[0.98] active:bg-hover"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {articleUrl && <ArticleDetail articleUrl={articleUrl} getScrollContainer={() => contentRef.current} />}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
