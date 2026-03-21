import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { useI18n } from '../../lib/i18n'

interface ArticleCommentDialogProps {
  open: boolean
  title: string
  initialComment: string | null
  saving?: boolean
  onOpenChange: (open: boolean) => void
  onSave: (comment: string) => Promise<void> | void
}

export function ArticleCommentDialog({
  open,
  title,
  initialComment,
  saving = false,
  onOpenChange,
  onSave,
}: ArticleCommentDialogProps) {
  const { t } = useI18n()
  const [value, setValue] = useState(initialComment ?? '')

  useEffect(() => {
    if (open) setValue(initialComment ?? '')
  }, [initialComment, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('article.comment')}</DialogTitle>
          <DialogDescription className="line-clamp-2">{title}</DialogDescription>
        </DialogHeader>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('article.commentPlaceholder')}
          className="min-h-36 w-full resize-y rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text placeholder:text-muted/50 outline-none focus:border-accent"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('modal.cancel')}
          </Button>
          <Button variant="secondary" onClick={() => setValue('')} disabled={saving || value.length === 0}>
            {t('article.clearComment')}
          </Button>
          <Button onClick={() => void onSave(value)} disabled={saving}>
            {saving ? t('article.savingComment') : t('article.saveComment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
