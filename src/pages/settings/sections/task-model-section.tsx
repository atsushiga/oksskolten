import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '../../../lib/fetcher'
import {
  ANTHROPIC_MODELS,
  GEMINI_MODELS,
  OPENAI_MODELS,
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  LLM_API_PROVIDERS,
  TRANSLATE_SERVICE_PROVIDERS,
  LLM_TASK_PROVIDERS,
} from '../../../data/aiModels'
import type { ModelGroup } from '../../../data/aiModels'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from '@/components/ui/select'
import type { Settings } from '../../../hooks/use-settings'
import type { TranslateFn } from '../../../lib/i18n'

type TFunc = TranslateFn
type MessageKey = Parameters<TFunc>[0]

interface TaskConfig {
  taskKey: 'chat' | 'summary' | 'translate'
  labelKey: MessageKey
  providerValue: string
  setProvider: (v: string) => void
  modelValue: string
  setModel: (v: string) => void
  defaultModel: string
  hasTranslateServices?: boolean
}

const SWR_KEY_OPTS = { revalidateOnFocus: false } as const

export function TaskModelSection({ settings, t }: { settings: Settings; t: TFunc }) {
  // Call useSWR at top level for each provider (hooks must not be called in loops)
  const anthropicKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/anthropic`, fetcher, SWR_KEY_OPTS)
  const geminiKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/gemini`, fetcher, SWR_KEY_OPTS)
  const openaiKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/openai`, fetcher, SWR_KEY_OPTS)
  const googleTranslateKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/google-translate`, fetcher, SWR_KEY_OPTS)
  const deeplKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/deepl`, fetcher, SWR_KEY_OPTS)
  const { data: claudeCodeStatus } = useSWR<{ loggedIn?: boolean; error?: string }>(
    '/api/chat/claude-code-status', fetcher, SWR_KEY_OPTS,
  )

  const llmKeyStatuses = [anthropicKey, geminiKey, openaiKey]
  const translateKeyStatuses = [googleTranslateKey, deeplKey]

  const claudeCodeReady = !!claudeCodeStatus?.loggedIn
  const configuredKeys = useMemo(() => {
    const map: Record<string, boolean> = {}
    LLM_API_PROVIDERS.forEach((p, i) => { map[p] = !!llmKeyStatuses[i].data?.configured })
    TRANSLATE_SERVICE_PROVIDERS.forEach((p, i) => { map[p] = !!translateKeyStatuses[i].data?.configured })
    map['claude-code'] = claudeCodeReady
    return map
    // Recompute only when any key's configured status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    anthropicKey.data?.configured, geminiKey.data?.configured, openaiKey.data?.configured,
    googleTranslateKey.data?.configured, deeplKey.data?.configured, claudeCodeReady,
  ])
  const hasAnyLlmKey = LLM_API_PROVIDERS.some(p => configuredKeys[p]) || claudeCodeReady
  const hasAnyTranslateKey = TRANSLATE_SERVICE_PROVIDERS.some(p => configuredKeys[p])
  const hasAnyKey = hasAnyLlmKey || hasAnyTranslateKey
  const keysLoading = llmKeyStatuses.some(s => !s.data) || translateKeyStatuses.some(s => !s.data)

  const tasks: TaskConfig[] = [
    {
      taskKey: 'chat',
      labelKey: 'integration.task.chat',
      providerValue: settings.chatProvider || '',
      setProvider: (v) => {
        settings.setChatProvider(v)
        settings.setChatModel(getDefaultTaskModel('chat', v))
      },
      modelValue: settings.chatModel || '',
      setModel: settings.setChatModel,
      defaultModel: 'claude-haiku-4-5-20251001',
    },
    {
      taskKey: 'summary',
      labelKey: 'integration.task.summary',
      providerValue: settings.summaryProvider || '',
      setProvider: (v) => {
        settings.setSummaryProvider(v)
        settings.setSummaryModel(getDefaultTaskModel('summary', v))
      },
      modelValue: settings.summaryModel || '',
      setModel: settings.setSummaryModel,
      defaultModel: 'claude-haiku-4-5-20251001',
    },
    {
      taskKey: 'translate',
      labelKey: 'integration.task.translate',
      providerValue: settings.translateProvider || '',
      setProvider: (v) => {
        settings.setTranslateProvider(v)
        settings.setTranslateModel(getDefaultTaskModel('translate', v))
      },
      modelValue: settings.translateModel || '',
      setModel: settings.setTranslateModel,
      defaultModel: 'claude-sonnet-4-6',
      hasTranslateServices: true,
    },
  ]

  // Show brief "Saved" feedback on any task provider/model change
  const [showSaved, setShowSaved] = useState(false)
  const prevValues = useRef(tasks.map(t => `${t.providerValue}:${t.modelValue}`).join('|'))
  const currentValues = tasks.map(t => `${t.providerValue}:${t.modelValue}`).join('|')
  useEffect(() => {
    if (prevValues.current !== currentValues) {
      prevValues.current = currentValues
      setShowSaved(true)
      const timer = setTimeout(() => setShowSaved(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [currentValues])

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-semibold text-text">{t('integration.taskSettings')}</h2>
        <span
          className={`text-xs text-accent transition-opacity duration-300 ${
            showSaved ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('settings.saved')}
        </span>
      </div>
      <p className="text-xs text-muted mb-4">{t('integration.taskSettingsDesc')}</p>
      <div className={`space-y-3 ${!keysLoading && !hasAnyKey ? 'opacity-50 pointer-events-none' : ''}`}>
        {tasks.map(task => (
          <TaskModelRow key={task.labelKey} task={task} t={t} configuredKeys={configuredKeys} hasAnyTranslateKey={hasAnyTranslateKey} />
        ))}
      </div>
      {!keysLoading && !hasAnyKey && (
        <p className="text-xs text-muted mt-2">{t('integration.taskSettingsNoKeys')}</p>
      )}

    </section>
  )
}

/* ── Helpers ── */

function getModelGroups(provider: string): ModelGroup[] {
  if (provider === 'gemini') return GEMINI_MODELS
  if (provider === 'openai') return OPENAI_MODELS
  return ANTHROPIC_MODELS
}

function isTranslateService(provider: string): boolean {
  return (TRANSLATE_SERVICE_PROVIDERS as readonly string[]).includes(provider)
}

function getDefaultProvider(
  providers: readonly string[],
  configuredKeys: Record<string, boolean>,
  fallback: string,
): string {
  return providers.find((provider) => configuredKeys[provider]) || fallback
}

function getDefaultModel(provider: string): string {
  if (isTranslateService(provider)) return ''
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic
}

function getDefaultTaskModel(task: TaskConfig['taskKey'], provider: string): string {
  if (provider === 'openai') {
    if (task === 'summary') return 'gpt-5.4-nano'
    return 'gpt-5.4-mini'
  }
  return getDefaultModel(provider)
}

/* ── Task Model Row ── */

function TaskModelRow({ task, t, configuredKeys, hasAnyTranslateKey }: { task: TaskConfig; t: TFunc; configuredKeys: Record<string, boolean>; hasAnyTranslateKey: boolean }) {
  const hasTranslateServices = !!task.hasTranslateServices
  const currentIsTranslateService = isTranslateService(task.providerValue)
  const defaultLlmProvider = getDefaultProvider(LLM_TASK_PROVIDERS, configuredKeys, 'anthropic')
  const defaultTranslateProvider = getDefaultProvider(TRANSLATE_SERVICE_PROVIDERS, configuredKeys, TRANSLATE_SERVICE_PROVIDERS[0])

  if (!hasTranslateServices) {
    return (
      <div className="p-3 rounded-lg bg-bg-card border border-border space-y-2">
        <span className="block text-xs font-medium text-text select-none">{t(task.labelKey)}</span>
        <ProviderButtons providers={LLM_TASK_PROVIDERS} selected={task.providerValue} onSelect={task.setProvider} t={t} configuredKeys={configuredKeys} />
        <ModelSelect provider={task.providerValue} modelValue={task.modelValue} setModel={task.setModel} t={t} />
      </div>
    )
  }

  return (
    <div className="p-3 rounded-lg bg-bg-card border border-border space-y-2">
      <span className="block text-xs font-medium text-text select-none">{t(task.labelKey)}</span>
      <div className="flex rounded-md bg-bg-subtle p-0.5">
        <button
          type="button"
          onClick={() => { if (!task.providerValue || currentIsTranslateService) task.setProvider(defaultLlmProvider) }}
          className={`flex-1 px-1.5 py-1 text-[11px] rounded transition-colors select-none ${
            task.providerValue && !currentIsTranslateService
              ? 'bg-accent text-accent-text font-medium shadow-sm'
              : 'text-muted hover:text-text'
          }`}
        >
          {t('integration.modeLLM')}
        </button>
        <button
          type="button"
          onClick={() => { if (hasAnyTranslateKey && (!task.providerValue || !currentIsTranslateService)) task.setProvider(defaultTranslateProvider) }}
          disabled={!hasAnyTranslateKey}
          className={`flex-1 px-1.5 py-1 text-[11px] rounded transition-colors select-none ${
            task.providerValue && currentIsTranslateService
              ? 'bg-accent text-accent-text font-medium shadow-sm'
              : !hasAnyTranslateKey
                ? 'text-muted/40 cursor-not-allowed'
                : 'text-muted hover:text-text'
          }`}
        >
          {t('integration.modeTranslateService')}
        </button>
      </div>
      {currentIsTranslateService ? (
        <>
          <ProviderButtons providers={TRANSLATE_SERVICE_PROVIDERS} selected={task.providerValue} onSelect={task.setProvider} t={t} configuredKeys={configuredKeys} />
          {task.providerValue === 'google-translate' && <GoogleTranslateNote t={t} />}
          {task.providerValue === 'deepl' && <DeeplNote t={t} />}
        </>
      ) : (
        <>
          <ProviderButtons providers={LLM_TASK_PROVIDERS} selected={task.providerValue} onSelect={task.setProvider} t={t} configuredKeys={configuredKeys} />
          <ModelSelect provider={task.providerValue} modelValue={task.modelValue} setModel={task.setModel} t={t} />
        </>
      )}
    </div>
  )
}

/* ── Shared sub-components ── */

function ProviderButtons({ providers, selected, onSelect, t, configuredKeys }: { providers: readonly string[]; selected: string; onSelect: (v: string) => void; t: TFunc; configuredKeys: Record<string, boolean> }) {
  if (providers.length === 0) return null
  return (
    <div className="flex rounded-md bg-bg-subtle p-0.5">
      {providers.map(p => {
        const isConfigured = !!configuredKeys[p]
        return (
          <button
            key={p}
            type="button"
            onClick={() => { if (isConfigured) onSelect(p) }}
            disabled={!isConfigured}
            className={`flex-1 px-1.5 py-1 text-[11px] rounded transition-colors select-none ${
              selected === p
                ? 'bg-accent text-accent-text font-medium shadow-sm'
                : !isConfigured
                  ? 'text-muted/40 cursor-not-allowed'
                  : 'text-muted hover:text-text'
            }`}
          >
            {t(PROVIDER_LABELS[p])}
          </button>
        )
      })}
    </div>
  )
}

function ModelSelect({ provider, modelValue, setModel, t }: { provider: string; modelValue: string; setModel: (v: string) => void; t: TFunc }) {
  if (!provider) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder={t('integration.selectProviderFirst')} />
        </SelectTrigger>
        <SelectContent />
      </Select>
    )
  }
  return (
    <Select value={modelValue || undefined} onValueChange={setModel}>
      <SelectTrigger>
        <SelectValue placeholder={t('integration.selectModel')} />
      </SelectTrigger>
      <SelectContent>
        {getModelGroups(provider).map(group => (
          <SelectGroup key={group.group}>
            <SelectLabel>{group.group}</SelectLabel>
            {group.models.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label} ({m.value})</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

function GoogleTranslateNote({ t }: { t: TFunc }) {
  const { data } = useSWR<{ monthlyChars: number; freeTierRemaining: number }>(
    '/api/settings/google-translate/usage',
    fetcher,
    { revalidateOnFocus: false },
  )
  const monthlyK = data ? (data.monthlyChars / 1000).toFixed(0) : '—'
  return (
    <div className="rounded-md bg-bg-subtle px-3 py-2 text-xs text-muted select-none">
      <p>{t('integration.googleTranslateNote')}</p>
      <p className="mt-1.5 text-[11px] text-muted/70">{t('integration.googleTranslateFreeTier')}</p>
      <p className="mt-1 text-[11px] text-muted/70">{t('integration.googleTranslateUsage', { used: `${monthlyK}K`, limit: '500K' })}</p>
    </div>
  )
}

function DeeplNote({ t }: { t: TFunc }) {
  const { data } = useSWR<{ monthlyChars: number; freeTierRemaining: number }>(
    '/api/settings/deepl/usage',
    fetcher,
    { revalidateOnFocus: false },
  )
  const monthlyK = data ? (data.monthlyChars / 1000).toFixed(0) : '—'
  return (
    <div className="rounded-md bg-bg-subtle px-3 py-2 text-xs text-muted select-none">
      <p>{t('integration.deeplNote')}</p>
      <p className="mt-1.5 text-[11px] text-muted/70">{t('integration.deeplFreeTier')}</p>
      <p className="mt-1 text-[11px] text-muted/70">{t('integration.deeplUsage', { used: `${monthlyK}K`, limit: '500K' })}</p>
    </div>
  )
}
