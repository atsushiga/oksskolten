import { useState } from 'react'
import useSWR from 'swr'
import { Key, Plus, Trash2, Copy, Check } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useI18n } from '../../lib/i18n'
import { fetcher, apiPost, apiDelete } from '../../lib/fetcher'

interface ApiToken {
  id: number
  name: string
  key_prefix: string
  scopes: string
  last_used_at: string | null
  created_at: string
}

interface ApiTokenCreated extends ApiToken {
  key: string
}

export function ApiTokenSettings() {
  const { t, locale } = useI18n()
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Create form state
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<'read' | 'read,write'>('read')

  // Newly created key (shown once)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: tokens, mutate } = useSWR<ApiToken[]>('/api/settings/tokens', fetcher)

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

  async function handleCreate() {
    if (creating || !name.trim()) return
    setCreating(true)
    try {
      const result = await apiPost('/api/settings/tokens', { name: name.trim(), scopes }) as ApiTokenCreated
      setCreatedKey(result.key)
      setName('')
      setScopes('read')
      setShowForm(false)
      void mutate()
      showMessage(t('settings.tokenCreated'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Failed to create token', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: number) {
    if (deletingId !== null) return
    setDeletingId(id)
    const prev = tokens ?? []
    void mutate(prev.filter(tk => tk.id !== id), false)
    try {
      await apiDelete(`/api/settings/tokens/${id}`)
      showMessage(t('settings.tokenDeleted'), 'success')
    } catch (err: unknown) {
      void mutate(prev, false)
      showMessage(err instanceof Error ? err.message : 'Failed to delete token', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleCopy() {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'Z')
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  if (!tokens) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-text">{t('settings.apiTokens')}</h2>
        <button
          type="button"
          onClick={() => { setShowForm(v => !v); setCreatedKey(null); setCopied(false) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity select-none"
        >
          <Plus size={14} />
          {t('settings.createToken')}
        </button>
      </div>
      <p className="text-xs text-muted mb-4">{t('settings.apiTokensDesc')}</p>

      {/* Create form */}
      {showForm && (
        <div className="rounded-lg border border-border bg-bg-card p-4 mb-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-text mb-1">{t('settings.tokenName')}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('settings.tokenNamePlaceholder')}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate() }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text mb-1">{t('settings.tokenScopes')}</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm text-text cursor-pointer">
                <input
                  type="radio"
                  name="scopes"
                  checked={scopes === 'read'}
                  onChange={() => setScopes('read')}
                  className="accent-accent"
                />
                {t('settings.tokenScopeRead')}
              </label>
              <label className="flex items-center gap-1.5 text-sm text-text cursor-pointer">
                <input
                  type="radio"
                  name="scopes"
                  checked={scopes === 'read,write'}
                  onChange={() => setScopes('read,write')}
                  className="accent-accent"
                />
                {t('settings.tokenScopeReadWrite')}
              </label>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted hover:text-text hover:bg-hover transition-colors select-none"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || !name.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
            >
              {creating ? '...' : t('settings.tokenGenerate')}
            </button>
          </div>
        </div>
      )}

      {/* Newly created key banner */}
      {createdKey && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 mb-4">
          <p className="text-xs font-medium text-text mb-2">{t('settings.tokenCreatedCopy')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-bg rounded px-3 py-2 text-text select-all break-all">
              {createdKey}
            </code>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="shrink-0 p-2 rounded-lg text-muted hover:text-text hover:bg-hover transition-colors select-none"
            >
              {copied ? <Check size={16} className="text-accent" /> : <Copy size={16} />}
            </button>
          </div>
          <p className="text-xs text-muted mt-2">{t('settings.tokenOnceWarning')}</p>
        </div>
      )}

      {/* Token list */}
      {tokens.length > 0 ? (
        <div className="space-y-2">
          {tokens.map(tk => (
            <div
              key={tk.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Key size={18} className="text-muted shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">{tk.name}</p>
                  <p className="text-xs text-muted">
                    <span className="font-mono">{tk.key_prefix}...</span>
                    {' · '}
                    <span>{tk.scopes === 'read,write' ? t('settings.tokenScopeReadWrite') : t('settings.tokenScopeRead')}</span>
                    {' · '}
                    <span>{formatDate(tk.created_at)}</span>
                    {tk.last_used_at && (
                      <>
                        {' · '}
                        <span>{t('settings.tokenLastUsed')} {formatDate(tk.last_used_at)}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => void handleDelete(tk.id)}
                    disabled={deletingId === tk.id}
                    className="shrink-0 p-1.5 rounded-lg text-muted hover:text-error hover:bg-hover transition-colors disabled:opacity-50 select-none"
                  >
                    <Trash2 size={15} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('settings.tokenDelete')}</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      ) : !showForm && !createdKey ? (
        <p className="text-sm text-muted">{t('settings.noTokens')}</p>
      ) : null}

      {error && <p className="mt-3 text-sm text-error">{error}</p>}
      {success && <p className="mt-3 text-sm text-accent">{success}</p>}
    </section>
  )
}
