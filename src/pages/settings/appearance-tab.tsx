import { useEffect, useRef } from 'react'
import { useI18n } from '../../lib/i18n'
import { highlightThemeFamilies } from '../../data/highlightThemes'
import { articleFonts, FONT_SAMPLE_EN, FONT_SAMPLE_LOCALIZED, getSystemFontLabel } from '../../data/articleFonts'
import { layouts, type LayoutName } from '../../data/layouts'
import { PreviewCard } from '../../components/settings/preview-card'
import { useAppLayout } from '../../app'
import { Separator } from '@/components/ui/separator'
import { PixelDreamPuff, PixelSleepyGiant } from '../../components/ui/mascot'
import type { MascotChoice } from '../../hooks/use-mascot'
import { ThemeSection } from './theme-section'

/** Derive preview colors from a theme's color definitions */
function previewColorsFromTheme(colors: Record<string, string>) {
  return {
    bg: colors['--color-bg'],
    sidebar: colors['--color-bg-sidebar'],
    line: colors['--color-border'],
    lineDark: colors['--color-muted'],
    lineMuted: colors['--color-border'],
    thumb: colors['--color-bg-subtle'] ?? colors['--color-bg'],
    bar: colors['--color-bg-subtle'] ?? colors['--color-bg'],
    accent: colors['--color-accent'],
  }
}

export function AppearanceTab() {
  const { settings } = useAppLayout()
  const {
    isDark, colorMode, setColorMode,
    themeName, setTheme, themes,
    highlightThemeOverride, setHighlightTheme,
    articleFont, setArticleFont,
    layout, setLayout,
    mascot, setMascot,
    autoMarkRead,
    customThemes, setCustomThemes,
  } = settings
  const { t, locale } = useI18n()
  const currentTheme = themes.find(th => th.name === themeName) ?? themes[0]
  const previewLight = previewColorsFromTheme(currentTheme.colors.light)
  const previewDark = previewColorsFromTheme(currentTheme.colors.dark)
  const preloadLinksRef = useRef<HTMLLinkElement[]>([])

  const layoutLabelKeys: Record<LayoutName, Parameters<typeof t>[0]> = {
    list: 'settings.layoutList',
    card: 'settings.layoutCard',
    magazine: 'settings.layoutMagazine',
    compact: 'settings.layoutCompact',
  }

  // Preload all Google Fonts on mount for preview display
  useEffect(() => {
    const links: HTMLLinkElement[] = []
    for (const font of articleFonts) {
      if (font.googleFontsUrl) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = font.googleFontsUrl
        link.dataset.fontPreview = font.value
        document.head.appendChild(link)
        links.push(link)
      }
    }
    preloadLinksRef.current = links
    return () => {
      for (const link of preloadLinksRef.current) {
        link.remove()
      }
      preloadLinksRef.current = []
    }
  }, [])

  return (
    <>
      {/* Layout */}
      <section>
        <h2 className="text-base font-semibold text-text mb-1">{t('settings.layout')}</h2>
        <p className="text-xs text-muted mb-3">{t('settings.layoutDesc')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {layouts.map(l => {
            const c = isDark ? previewDark : previewLight
            return (
              <PreviewCard
                key={l.name}
                selected={layout === l.name}
                onClick={() => setLayout(l.name as typeof layout)}
                label={t(layoutLabelKeys[l.name as LayoutName])}
              >
                <div style={{ background: c.bg }} className="w-full h-full px-9 py-2 overflow-hidden">
                  {l.name === 'list' && (
                    <div className="space-y-2">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="flex items-center gap-1.5">
                          <div className="flex-1 space-y-1">
                            <div style={{ background: c.lineDark }} className="w-full h-1.5 rounded-full" />
                            <div style={{ background: c.lineMuted }} className="w-3/4 h-1 rounded-full" />
                          </div>
                          <div style={{ background: c.thumb }} className="w-4 h-4 rounded shrink-0" />
                        </div>
                      ))}
                    </div>
                  )}
                  {l.name === 'card' && (
                    <div className="grid grid-cols-2 gap-1.5">
                      {[0, 1, 2, 3].map(i => (
                        <div key={i}>
                          <div style={{ background: c.thumb }} className="w-full h-4 rounded-sm" />
                          <div style={{ background: c.lineDark }} className="w-full h-1 rounded-full mt-1" />
                          <div style={{ background: c.lineMuted }} className="w-3/4 h-1 rounded-full mt-0.5" />
                        </div>
                      ))}
                    </div>
                  )}
                  {l.name === 'magazine' && (
                    <div>
                      <div style={{ background: c.thumb }} className="w-full h-8 rounded-sm" />
                      <div style={{ background: c.lineDark }} className="w-full h-1.5 rounded-full mt-1" />
                      <div style={{ background: c.lineMuted }} className="w-2/3 h-1 rounded-full mt-0.5 mb-1.5" />
                      <div className="grid grid-cols-2 gap-1">
                        {[0, 1].map(i => (
                          <div key={i} className="flex gap-1">
                            <div style={{ background: c.thumb }} className="w-3 h-3 rounded-sm shrink-0" />
                            <div className="flex-1 space-y-0.5">
                              <div style={{ background: c.lineDark }} className="w-full h-1 rounded-full" />
                              <div style={{ background: c.lineMuted }} className="w-2/3 h-1 rounded-full" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {l.name === 'compact' && (
                    <div className="space-y-1.5">
                      {[0, 1, 2, 3, 4].map(i => (
                        <div key={i} className="flex items-center gap-1">
                          <div style={{ background: c.lineDark }} className="flex-1 h-1 rounded-full" />
                          <div style={{ background: c.lineMuted }} className="w-3 h-1 rounded-full shrink-0" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </PreviewCard>
            )
          })}
        </div>
      </section>

      <Separator />

      {/* Color mode */}
      <section>
        <h2 className="text-base font-semibold text-text mb-1">{t('settings.colorMode')}</h2>
        <p className="text-xs text-muted mb-3">{t('settings.colorModeDesc')}</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {([
            { value: 'light' as const, label: t('settings.colorModeLight') },
            { value: 'dark' as const, label: t('settings.colorModeDark') },
            { value: 'system' as const, label: t('settings.colorModeAuto') },
          ]).map(mode => (
            <PreviewCard
              key={mode.value}
              selected={colorMode === mode.value}
              onClick={() => setColorMode(mode.value)}
              label={mode.label}
            >
              {mode.value === 'light' && (
                <div style={{ background: previewLight.bg }} className="w-full h-full flex">
                  <div style={{ background: previewLight.sidebar }} className="w-[30%] h-full p-2 space-y-1.5">
                    <div style={{ background: previewLight.line }} className="w-full h-1.5 rounded-full" />
                    <div style={{ background: previewLight.line }} className="w-3/4 h-1.5 rounded-full" />
                  </div>
                  <div className="flex-1 p-2 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <div style={{ background: previewLight.lineDark }} className="w-full h-1.5 rounded-full" />
                      <div style={{ background: previewLight.thumb }} className="w-4 h-4 rounded shrink-0" />
                    </div>
                    <div style={{ background: previewLight.lineMuted }} className="w-3/4 h-1.5 rounded-full" />
                    <div style={{ background: previewLight.lineMuted }} className="w-1/2 h-1.5 rounded-full" />
                    <div className="flex-1" />
                    <div style={{ background: previewLight.bar }} className="w-full h-5 rounded mt-auto flex items-center justify-end pr-1.5">
                      <div style={{ background: previewLight.accent }} className="w-2 h-2 rounded-full" />
                    </div>
                  </div>
                </div>
              )}
              {mode.value === 'dark' && (
                <div style={{ background: previewDark.bg }} className="w-full h-full flex">
                  <div style={{ background: previewDark.sidebar }} className="w-[30%] h-full p-2 space-y-1.5">
                    <div style={{ background: previewDark.line }} className="w-full h-1.5 rounded-full" />
                    <div style={{ background: previewDark.line }} className="w-3/4 h-1.5 rounded-full" />
                  </div>
                  <div className="flex-1 p-2 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <div style={{ background: previewDark.lineDark }} className="w-full h-1.5 rounded-full" />
                      <div style={{ background: previewDark.lineMuted }} className="w-4 h-4 rounded shrink-0" />
                    </div>
                    <div style={{ background: previewDark.lineMuted }} className="w-3/4 h-1.5 rounded-full" />
                    <div style={{ background: previewDark.lineMuted }} className="w-1/2 h-1.5 rounded-full" />
                    <div className="flex-1" />
                    <div style={{ background: previewDark.bar }} className="w-full h-5 rounded mt-auto flex items-center justify-end pr-1.5">
                      <div style={{ background: previewDark.accent }} className="w-2 h-2 rounded-full" />
                    </div>
                  </div>
                </div>
              )}
              {mode.value === 'system' && (
                <div className="w-full h-full flex">
                  <div style={{ background: previewLight.bg }} className="w-1/2 flex">
                    <div style={{ background: previewLight.sidebar }} className="w-[30%] h-full p-1.5 space-y-1">
                      <div style={{ background: previewLight.line }} className="w-full h-1.5 rounded-full" />
                      <div style={{ background: previewLight.line }} className="w-3/4 h-1.5 rounded-full" />
                    </div>
                    <div className="flex-1 p-1.5 space-y-1">
                      <div style={{ background: previewLight.lineDark }} className="w-full h-1.5 rounded-full" />
                      <div style={{ background: previewLight.lineMuted }} className="w-3/4 h-1.5 rounded-full" />
                      <div className="flex-1" />
                      <div style={{ background: previewLight.bar }} className="w-full h-4 rounded-sm mt-auto" />
                    </div>
                  </div>
                  <div style={{ background: previewDark.bg }} className="w-1/2 flex">
                    <div style={{ background: previewDark.sidebar }} className="w-[30%] h-full p-1.5 space-y-1">
                      <div style={{ background: previewDark.line }} className="w-full h-1.5 rounded-full" />
                      <div style={{ background: previewDark.line }} className="w-3/4 h-1.5 rounded-full" />
                    </div>
                    <div className="flex-1 p-1.5 space-y-1">
                      <div style={{ background: previewDark.lineDark }} className="w-full h-1.5 rounded-full" />
                      <div style={{ background: previewDark.lineMuted }} className="w-3/4 h-1.5 rounded-full" />
                      <div className="flex-1" />
                      <div style={{ background: previewDark.bar }} className="w-full h-4 rounded-sm mt-auto flex items-center justify-end pr-1">
                        <div style={{ background: previewDark.accent }} className="w-1.5 h-1.5 rounded-full" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </PreviewCard>
          ))}
        </div>
      </section>

      <Separator />

      {/* Theme */}
      <ThemeSection
        isDark={isDark}
        themeName={themeName}
        setTheme={setTheme}
        customThemes={customThemes}
        setCustomThemes={setCustomThemes}
      />

      <Separator />

      {/* Article font */}
      <section>
        <h2 className="text-base font-semibold text-text mb-1">{t('settings.articleFont')}</h2>
        <p className="text-xs text-muted mb-3">{t('settings.articleFontDesc')}</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {articleFonts.map(font => {
            const localizedSample = FONT_SAMPLE_LOCALIZED[locale]
            return (
              <PreviewCard
                key={font.value}
                selected={articleFont === font.value}
                onClick={() => setArticleFont(font.value)}
                label={font.value === 'system' ? getSystemFontLabel() : font.label}
              >
                <div style={{ fontFamily: font.family }} className="w-full h-full bg-bg-card p-3 flex flex-col justify-center overflow-hidden">
                  <span className="text-[13px] leading-snug text-text truncate">
                    {FONT_SAMPLE_EN}
                  </span>
                  {localizedSample && (
                    <span className="text-[12px] leading-snug text-muted truncate mt-0.5">
                      {localizedSample}
                    </span>
                  )}
                  <span className="text-[10px] text-muted mt-1">{font.category}</span>
                </div>
              </PreviewCard>
            )
          })}
        </div>
      </section>

      <Separator />

      {/* Code highlight */}
      <section>
        <h2 className="text-base font-semibold text-text mb-1">{t('settings.highlightTheme')}</h2>
        <p className="text-xs text-muted mb-3">{t('settings.highlightThemeDesc')}</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {/* Auto card */}
          {(() => {
            const autoFamily = highlightThemeFamilies.find(f => f.value === currentTheme.highlight)
            const p = autoFamily
              ? autoFamily.preview[isDark ? 'dark' : 'light']
              : highlightThemeFamilies[0].preview[isDark ? 'dark' : 'light']
            return (
              <PreviewCard
                selected={!highlightThemeOverride}
                onClick={() => setHighlightTheme(null)}
                label={t('settings.highlightThemeAuto')}
              >
                <div style={{ background: p.bg }} className="w-full h-full px-2 pt-4 font-mono text-[11px] leading-relaxed overflow-hidden">
                  <span style={{ color: p.keyword }}>const</span>
                  <span style={{ color: p.text }}> fn = </span>
                  <span style={{ color: p.string }}>"hello"</span>
                  <br />
                  <span style={{ color: p.comment }}>// comment</span>
                </div>
              </PreviewCard>
            )
          })()}

          {/* Theme family cards */}
          {highlightThemeFamilies.map(f => {
            const p = f.preview[isDark ? 'dark' : 'light']
            return (
              <PreviewCard
                key={f.value}
                selected={highlightThemeOverride === f.value}
                onClick={() => setHighlightTheme(f.value)}
                label={f.label}
              >
                <div style={{ background: p.bg }} className="w-full h-full px-2 pt-4 font-mono text-[11px] leading-relaxed overflow-hidden">
                  <span style={{ color: p.keyword }}>const</span>
                  <span style={{ color: p.text }}> fn = </span>
                  <span style={{ color: p.string }}>"hello"</span>
                  <br />
                  <span style={{ color: p.comment }}>// comment</span>
                </div>
              </PreviewCard>
            )
          })}

          {/* None card */}
          <PreviewCard
            selected={highlightThemeOverride === 'none'}
            onClick={() => setHighlightTheme('none')}
            label={t('settings.highlightThemeNone')}
          >
            <div className="w-full h-full p-2 bg-bg-subtle font-mono text-[11px] leading-relaxed overflow-hidden">
              <span className="text-text">const</span>
              <span className="text-text"> fn = </span>
              <span className="text-text">"hello"</span>
              <br />
              <span className="text-muted">// comment</span>
            </div>
          </PreviewCard>
        </div>
      </section>

      <Separator />

      {/* Mascot */}
      <section>
        <h2 className="text-base font-semibold text-text mb-1">{t('settings.mascot')}</h2>
        <p className="text-xs text-muted mb-3">{t('settings.mascotDesc')}</p>
        {autoMarkRead === 'off' && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-bg-subtle px-3 py-2.5 mb-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0 mt-px">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p className="text-xs text-muted">{t('settings.mascotRequiresAutoMark')}</p>
          </div>
        )}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {([
            { value: 'off' as MascotChoice, label: t('settings.mascotOff'), Preview: null },
            { value: 'dream-puff' as MascotChoice, label: t('settings.mascotDreamPuff'), Preview: PixelDreamPuff },
            { value: 'sleepy-giant' as MascotChoice, label: t('settings.mascotSleepyGiant'), Preview: PixelSleepyGiant },
          ]).map(option => (
            <PreviewCard
              key={option.value}
              selected={autoMarkRead === 'off' ? option.value === 'off' : mascot === option.value}
              onClick={() => { if (autoMarkRead !== 'off') setMascot(option.value) }}
              disabled={autoMarkRead === 'off'}
              label={option.label}
            >
              <div className="w-full h-full bg-bg-card flex items-center justify-center">
                {option.Preview ? (
                  <div className="scale-[0.6]">
                    <option.Preview />
                  </div>
                ) : (
                  <span className="text-xs text-muted/40">—</span>
                )}
              </div>
            </PreviewCard>
          ))}
        </div>
      </section>

    </>
  )
}
