import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { fetcher, apiDelete, apiPatch, apiPost } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'

interface SiteAccessProfileData {
  id: string
  name: string
  enabled: boolean
  configured: boolean
  targetDomains: string[]
}

interface SiteAccessData {
  profiles: SiteAccessProfileData[]
}

interface EditableProfile {
  id?: string
  name: string
  enabled: boolean
  configured: boolean
  domains: string
  cookie: string
  testUrl: string
  testing: boolean
  testResult: { ok: boolean; message: string; details?: string | null; metrics?: string | null } | null
}

function formatDomains(domains: string[]): string {
  return domains.join('\n')
}

function parseDomains(input: string): string[] {
  return [...new Set(
    input
      .split(/[\n,\s]+/)
      .map(domain => domain.trim().toLowerCase())
      .filter(Boolean),
  )]
}

function makeEmptyProfile(): EditableProfile {
  return {
    name: '',
    enabled: true,
    configured: false,
    domains: '',
    cookie: '',
    testUrl: '',
    testing: false,
    testResult: null,
  }
}

function toEditable(profile: SiteAccessProfileData): EditableProfile {
  return {
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    configured: profile.configured,
    domains: formatDomains(profile.targetDomains),
    cookie: '',
    testUrl: '',
    testing: false,
    testResult: null,
  }
}

export function SiteAccessSettings() {
  const { t } = useI18n()
  const { data, mutate } = useSWR<SiteAccessData>('/api/settings/site-access', fetcher)
  const [profiles, setProfiles] = useState<EditableProfile[]>([])
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    setProfiles(data.profiles.length > 0 ? data.profiles.map(toEditable) : [makeEmptyProfile()])
  }, [data])

  if (!data) return null

  const serverProfiles = JSON.stringify(data.profiles.map(profile => ({
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    configured: profile.configured,
    domains: formatDomains(profile.targetDomains),
  })))
  const currentProfiles = JSON.stringify(profiles.map(profile => ({
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    configured: profile.configured,
    domains: profile.domains,
  })))
  const isDirty = serverProfiles !== currentProfiles || profiles.some(profile => profile.cookie.trim() !== '')

  function showMessage(msg: string, type: 'error' | 'success') {
    if (type === 'error') {
      setError(msg)
      setSuccess(null)
    } else {
      setSuccess(msg)
      setError(null)
    }
    setTimeout(() => { setError(null); setSuccess(null) }, 3000)
  }

  function updateProfile(index: number, patch: Partial<EditableProfile>) {
    setProfiles(current => current.map((profile, i) => i === index ? { ...profile, ...patch } : profile))
  }

  function addProfile() {
    setProfiles(current => [...current, makeEmptyProfile()])
  }

  function removeProfile(index: number) {
    setProfiles(current => current.length === 1 ? [makeEmptyProfile()] : current.filter((_, i) => i !== index))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      await apiPatch('/api/settings/site-access', {
        profiles: profiles
          .filter(profile => profile.name.trim() || profile.domains.trim() || profile.cookie.trim() || profile.configured)
          .map(profile => ({
            ...(profile.id ? { id: profile.id } : {}),
            name: profile.name,
            enabled: profile.enabled,
            cookie: profile.cookie || undefined,
            targetDomains: parseDomains(profile.domains),
          })),
      })
      void mutate()
      showMessage(t('siteAccess.saved'), 'success')
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(index: number) {
    const profile = profiles[index]
    updateProfile(index, { testing: true, testResult: null })
    try {
      const res = await apiPost('/api/settings/site-access/test', {
        profile: {
          ...(profile.id ? { id: profile.id } : {}),
          name: profile.name,
          enabled: profile.enabled,
          cookie: profile.cookie || undefined,
          targetDomains: parseDomains(profile.domains),
        },
        url: profile.testUrl || undefined,
      }) as {
        ok: boolean
        message: string
        status: number
        finalUrl?: string | null
        title?: string | null
        preview?: string | null
        htmlLength?: number
        previewLength?: number
        matchedDomain?: string | null
        profileName?: string | null
      }
      updateProfile(index, {
        testing: false,
        testResult: {
          ok: res.ok,
          message: `${res.message} (${res.status})`,
          details: res.title || res.preview || null,
          metrics: [
            res.profileName ? `profile=${res.profileName}` : null,
            res.matchedDomain ? `domain=${res.matchedDomain}` : null,
            res.finalUrl ? `final=${res.finalUrl}` : null,
            res.htmlLength != null ? `html=${res.htmlLength}` : null,
            res.previewLength != null ? `preview=${res.previewLength}` : null,
          ].filter(Boolean).join(' · '),
        },
      })
    } catch (err) {
      updateProfile(index, {
        testing: false,
        testResult: { ok: false, message: err instanceof Error ? err.message : 'Test failed' },
      })
    }
  }

  async function handleClear() {
    if (clearing) return
    setClearing(true)
    try {
      await apiDelete('/api/settings/site-access')
      setProfiles([makeEmptyProfile()])
      void mutate()
      showMessage(t('siteAccess.cleared'), 'success')
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setClearing(false)
    }
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-text mb-1">{t('siteAccess.title')}</h2>
          <p className="text-xs text-muted">{t('siteAccess.desc')}</p>
        </div>
        <button
          type="button"
          onClick={addProfile}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-text hover:bg-hover transition-colors select-none"
        >
          {t('siteAccess.addProfile')}
        </button>
      </div>

      <div className="space-y-4">
        {profiles.map((profile, index) => (
          <div key={profile.id ?? `new-${index}`} className="rounded-xl border border-border bg-bg-card p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1 select-none">{t('siteAccess.profileName')}</label>
                <input
                  type="text"
                  value={profile.name}
                  onChange={e => updateProfile(index, { name: e.target.value })}
                  placeholder={t('siteAccess.profileNamePlaceholder')}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <button
                type="button"
                onClick={() => removeProfile(index)}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-border text-text hover:bg-hover transition-colors select-none"
              >
                {t('siteAccess.removeProfile')}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text">{t('siteAccess.enabled')}</p>
                <p className="text-xs text-muted">{t('siteAccess.enabledDesc')}</p>
              </div>
              <button
                type="button"
                onClick={() => updateProfile(index, { enabled: !profile.enabled })}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  profile.enabled ? 'bg-accent' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    profile.enabled ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 select-none">{t('siteAccess.domains')}</label>
              <textarea
                value={profile.domains}
                onChange={e => updateProfile(index, { domains: e.target.value })}
                placeholder={t('siteAccess.domainsPlaceholder')}
                rows={4}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <p className="mt-1 text-xs text-muted">{t('siteAccess.domainsDesc')}</p>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 select-none">{t('siteAccess.cookie')}</label>
              <textarea
                value={profile.cookie}
                onChange={e => updateProfile(index, { cookie: e.target.value })}
                placeholder={t('siteAccess.cookiePlaceholder')}
                rows={4}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <p className="mt-1 text-xs text-muted">
                {profile.configured ? t('siteAccess.cookieConfigured') : t('siteAccess.cookieNotConfigured')}
              </p>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 select-none">{t('siteAccess.testUrl')}</label>
              <input
                type="text"
                value={profile.testUrl}
                onChange={e => updateProfile(index, { testUrl: e.target.value, testResult: null })}
                placeholder={t('siteAccess.testUrlPlaceholder')}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <p className="mt-1 text-xs text-muted">{t('siteAccess.testUrlDesc')}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTest(index)}
                disabled={profile.testing}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
              >
                {profile.testing ? t('siteAccess.testing') : t('siteAccess.test')}
              </button>
              {profile.testResult && (
                <div className={`text-xs ${profile.testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
                  <p>{profile.testResult.message}</p>
                  {profile.testResult.details && (
                    <p className="mt-1 text-muted">{profile.testResult.details}</p>
                  )}
                  {profile.testResult.metrics && (
                    <p className="mt-1 text-muted">{profile.testResult.metrics}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
          >
            {saving ? '...' : t('siteAccess.save')}
          </button>
          {data.profiles.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              disabled={clearing}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
            >
              {clearing ? '...' : t('siteAccess.clear')}
            </button>
          )}
        </div>
      </div>

      {(error || success) && (
        <p className={`mt-3 text-xs ${error ? 'text-red-500' : 'text-green-600'}`}>
          {error || success}
        </p>
      )}
    </section>
  )
}
