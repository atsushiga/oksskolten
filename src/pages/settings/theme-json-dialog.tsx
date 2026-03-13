import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../lib/i18n'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { parseThemeJson, themeToJson } from '../../lib/theme-json'
import type { Theme } from '../../data/themes'
import { toast } from 'sonner'
import Editor from 'react-simple-code-editor'
import hljs from 'highlight.js/lib/core'
import jsonLang from 'highlight.js/lib/languages/json'

hljs.registerLanguage('json', jsonLang)

const PLACEHOLDER_THEME_JSON = JSON.stringify({
  name: 'my-theme',
  label: 'My Theme',
  colors: {
    light: {
      background: '#ffffff',
      'background.sidebar': '#f0f0f2',
      'background.subtle': '#f7f7f7',
      'background.avatar': '#d8d8dc',
      text: '#111111',
      'text.muted': '#6b7280',
      accent: '#2563eb',
      'accent.text': '#ffffff',
      error: '#dc2626',
      border: '#e5e7eb',
      hover: 'rgba(0, 0, 0, 0.04)',
      overlay: 'rgba(0, 0, 0, 0.3)',
    },
    dark: { '...': '...' },
  },
}, null, 2)

const PLACEHOLDER_THEME_HTML = `<span class="text-muted opacity-40">${hljs.highlight(PLACEHOLDER_THEME_JSON, { language: 'json' }).value}</span>`

const SAMPLE_THEME_JSON = JSON.stringify({
  name: 'everforest',
  label: 'Everforest',
  indicatorStyle: 'line',
  colors: {
    light: {
      background: '#fdf6e3',
      'background.sidebar': '#f4eed4',
      'background.subtle': '#efebc8',
      'background.avatar': '#e0dab8',
      text: '#5c6a72',
      'text.muted': '#829181',
      accent: '#8da101',
      'accent.text': '#fdf6e3',
      error: '#f85552',
      border: '#e0dab8',
      hover: 'rgba(0, 0, 0, 0.04)',
      overlay: 'rgba(0, 0, 0, 0.25)',
    },
    dark: {
      background: '#2d353b',
      'background.sidebar': '#272e33',
      'background.subtle': '#343f44',
      'background.avatar': '#475258',
      text: '#d3c6aa',
      'text.muted': '#859289',
      accent: '#a7c080',
      'accent.text': '#2d353b',
      error: '#e67e80',
      border: '#475258',
      hover: 'rgba(255, 255, 255, 0.05)',
      overlay: 'rgba(0, 0, 0, 0.5)',
    },
  },
}, null, 2)

export function ThemeJsonDialog({
  open,
  onOpenChange,
  customThemes,
  setCustomThemes,
  setTheme,
  editingTheme,
  setEditingTheme,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customThemes: Theme[]
  setCustomThemes: (updater: (prev: Theme[]) => Theme[]) => void
  setTheme: (name: string) => void
  editingTheme: Theme | null
  setEditingTheme: (theme: Theme | null) => void
}) {
  const { t } = useI18n()
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isEditing = editingTheme !== null

  // Populate text area when editing or reset when opening for import
  useEffect(() => {
    if (open) {
      setJsonText(editingTheme ? JSON.stringify(themeToJson(editingTheme), null, 2) : '')
      setError(null)
    }
  }, [open, editingTheme])

  const handleClose = useCallback(() => {
    onOpenChange(false)
    setEditingTheme(null)
  }, [onOpenChange, setEditingTheme])

  const doSave = useCallback(() => {
    setError(null)
    if (!isEditing && customThemes.length >= 20) {
      setError(t('settings.themeLimit'))
      return
    }
    let parsed: unknown
    try { parsed = JSON.parse(jsonText) } catch { setError(t('themeJson.invalidJson')); return }
    const existingNames = new Set(
      customThemes
        .filter(ct => !isEditing || ct.name !== editingTheme?.name)
        .map(ct => ct.name),
    )
    const result = parseThemeJson(parsed, existingNames)
    if ('error' in result) { setError(t(result.error.key as Parameters<typeof t>[0], result.error.params)); return }
    if (isEditing) {
      setCustomThemes(prev => prev.map(ct => ct.name === editingTheme?.name ? result.theme : ct))
      toast.success(t('settings.themeUpdated'))
    } else {
      setCustomThemes(prev => [...prev, result.theme])
      toast.success(t('settings.themeImported'))
    }
    setTheme(result.theme.name)
    handleClose()
  }, [jsonText, customThemes, setCustomThemes, setTheme, isEditing, editingTheme, handleClose, t])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v) }}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? `${t('settings.editTheme')}: ${editingTheme.label}`
              : t('settings.importTheme')
            }
          </DialogTitle>
        </DialogHeader>

        <div className="w-full h-64 sm:h-96 rounded-md border border-border bg-bg-input overflow-auto">
          <Editor
            value={jsonText}
            onValueChange={v => { setJsonText(v); setError(null) }}
            highlight={code =>
              code
                ? hljs.highlight(code, { language: 'json' }).value
                : PLACEHOLDER_THEME_HTML
            }
            padding={12}
            className="text-xs font-mono text-text min-h-full"
            textareaClassName="theme-json-editor-textarea"
            style={{ minHeight: '100%' }}
          />
        </div>

        {error && <p className="text-xs text-error">{error}</p>}

        <div className="flex items-center gap-2">
          {!isEditing && (
            <button
              type="button"
              className="text-xs px-4 py-2 rounded-md border border-border text-muted hover:text-text hover:bg-hover transition-colors"
              onClick={() => { setJsonText(SAMPLE_THEME_JSON); setError(null) }}
            >
              {t('settings.sampleButton')}
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            className="text-xs px-4 py-2 rounded-md border border-border text-muted hover:text-text hover:bg-hover transition-colors"
            onClick={handleClose}
          >
            {t('settings.cancel')}
          </button>
          <button
            type="button"
            className="text-xs px-4 py-2 rounded-md bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50"
            disabled={!jsonText.trim()}
            onClick={doSave}
          >
            {isEditing ? t('settings.updateButton') : t('settings.importButton')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
