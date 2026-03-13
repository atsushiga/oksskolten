import { useState, useRef, useCallback } from 'react'
import { useI18n } from '../../lib/i18n'
import { themes as builtinThemes } from '../../data/themes'
import { PreviewCard } from '../../components/settings/preview-card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { parseThemeJson } from '../../lib/theme-json'
import type { Theme } from '../../data/themes'
import { toast } from 'sonner'
import { ThemeJsonDialog } from './theme-json-dialog'

interface ThemeSectionProps {
  isDark: boolean
  themeName: string
  setTheme: (name: string) => void
  customThemes: Theme[]
  setCustomThemes: (updater: (prev: Theme[]) => Theme[]) => void
}

export function ThemeSection({ isDark, themeName, setTheme, customThemes, setCustomThemes }: ThemeSectionProps) {
  const { t } = useI18n()
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null)
  const [themeDialogOpen, setThemeDialogOpen] = useState(false)
  const [deletingThemeName, setDeletingThemeName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      let parsed: unknown
      try { parsed = JSON.parse(reader.result) } catch { toast.error(t('themeJson.invalidJson')); return }
      const existingNames = new Set(customThemes.map(ct => ct.name))
      const result = parseThemeJson(parsed, existingNames)
      if ('error' in result) { toast.error(t(result.error.key as Parameters<typeof t>[0], result.error.params)); return }
      if (customThemes.length >= 20) { toast.error(t('settings.themeLimit')); return }
      setCustomThemes(prev => [...prev, result.theme])
      setTheme(result.theme.name)
      toast.success(t('settings.themeImported'))
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [customThemes, setCustomThemes, setTheme, t])

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('settings.colorTheme')}</h2>
      <p className="text-xs text-muted mb-3">{t('settings.themeDesc')}</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {builtinThemes.map(theme => {
          const c = theme.colors[isDark ? 'dark' : 'light']
          return (
            <PreviewCard
              key={theme.name}
              selected={themeName === theme.name}
              onClick={() => setTheme(theme.name)}
              label={theme.label}
            >
              <div style={{ background: c['--color-bg'] }} className="w-full h-full flex">
                <div style={{ background: c['--color-bg-sidebar'] }} className="w-[30%] h-full p-2 space-y-1.5">
                  <div style={{ background: c['--color-muted'] }} className="w-full h-1.5 rounded-full opacity-40" />
                  <div style={{ background: c['--color-muted'] }} className="w-3/4 h-1.5 rounded-full opacity-40" />
                </div>
                <div className="flex-1 p-2 space-y-2">
                  <div style={{ background: c['--color-muted'] }} className="w-full h-1.5 rounded-full opacity-30" />
                  <div style={{ background: c['--color-muted'] }} className="w-3/4 h-1.5 rounded-full opacity-30" />
                  <div className="flex-1" />
                  <div style={{ background: c['--color-accent'] }} className="w-2 h-2 rounded-full" />
                </div>
              </div>
            </PreviewCard>
          )
        })}

        {/* Custom themes in the same grid */}
        {customThemes.length > 0 && (
          <h3 className="col-span-full text-sm font-medium text-text mt-2">{t('settings.customThemes')}</h3>
        )}
        {customThemes.map(theme => {
          const c = theme.colors[isDark ? 'dark' : 'light']
          return (
            <div key={theme.name} className="relative group w-full">
              <PreviewCard
                selected={themeName === theme.name}
                onClick={() => setTheme(theme.name)}
                label={theme.label}
                className="w-full"
              >
                <div style={{ background: c['--color-bg'] }} className="w-full h-full flex">
                  <div style={{ background: c['--color-bg-sidebar'] }} className="w-[30%] h-full p-2 space-y-1.5">
                    <div style={{ background: c['--color-muted'] }} className="w-full h-1.5 rounded-full opacity-40" />
                    <div style={{ background: c['--color-muted'] }} className="w-3/4 h-1.5 rounded-full opacity-40" />
                  </div>
                  <div className="flex-1 p-2 space-y-2">
                    <div style={{ background: c['--color-muted'] }} className="w-full h-1.5 rounded-full opacity-30" />
                    <div style={{ background: c['--color-muted'] }} className="w-3/4 h-1.5 rounded-full opacity-30" />
                    <div className="flex-1" />
                    <div style={{ background: c['--color-accent'] }} className="w-2 h-2 rounded-full" />
                  </div>
                </div>
              </PreviewCard>
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="w-6 h-6 rounded-md bg-bg border border-border text-muted flex items-center justify-center hover:text-text transition-colors"
                  title={t('settings.editTheme')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingTheme(theme)
                    setThemeDialogOpen(true)
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="w-6 h-6 rounded-md bg-bg border border-border text-muted flex items-center justify-center hover:text-error transition-colors"
                  title={t('settings.deleteTheme')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeletingThemeName(theme.name)
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {deletingThemeName && (
        <ConfirmDialog
          title={t('settings.deleteTheme')}
          message={t('settings.deleteThemeConfirm')}
          danger
          onConfirm={() => {
            setCustomThemes(prev => prev.filter(ct => ct.name !== deletingThemeName))
            if (themeName === deletingThemeName) setTheme('default')
            if (editingTheme?.name === deletingThemeName) setEditingTheme(null)
            toast.success(t('settings.themeDeleted'))
            setDeletingThemeName(null)
          }}
          onCancel={() => setDeletingThemeName(null)}
        />
      )}

      {/* Import buttons */}
      <div className="mt-4 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileImport}
        />
        <button
          type="button"
          className="text-xs px-3 py-1.5 rounded-md border border-border text-text hover:bg-hover transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          {t('settings.importFromFile')}
        </button>
        <button
          type="button"
          className="text-xs px-3 py-1.5 rounded-md border border-border text-text hover:bg-hover transition-colors"
          onClick={() => { setEditingTheme(null); setThemeDialogOpen(true) }}
        >
          {t('settings.importFromText')}
        </button>
      </div>

      <ThemeJsonDialog
        open={themeDialogOpen}
        onOpenChange={setThemeDialogOpen}
        customThemes={customThemes}
        setCustomThemes={setCustomThemes}
        setTheme={setTheme}
        editingTheme={editingTheme}
        setEditingTheme={setEditingTheme}
      />
    </section>
  )
}
