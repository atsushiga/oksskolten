import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskModelSection } from './task-model-section'

const swrMock = vi.fn()

vi.mock('swr', () => ({
  default: (...args: unknown[]) => swrMock(...args),
}))

function makeSettings(overrides: Partial<Parameters<typeof TaskModelSection>[0]['settings']> = {}) {
  return {
    chatProvider: 'anthropic',
    setChatProvider: vi.fn(),
    chatModel: 'claude-haiku-4-5-20251001',
    setChatModel: vi.fn(),
    summaryProvider: 'anthropic',
    setSummaryProvider: vi.fn(),
    summaryModel: 'claude-haiku-4-5-20251001',
    setSummaryModel: vi.fn(),
    translateProvider: '',
    setTranslateProvider: vi.fn(),
    translateModel: '',
    setTranslateModel: vi.fn(),
    translateTargetLang: 'ja',
    setTranslateTargetLang: vi.fn(),
    ...overrides,
  } as Parameters<typeof TaskModelSection>[0]['settings']
}

const t = (key: string) => key

describe('TaskModelSection', () => {
  beforeEach(() => {
    swrMock.mockReset()
    swrMock.mockImplementation((key: string) => {
      if (key === '/api/settings/api-keys/anthropic') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/gemini') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/openai') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/google-translate') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/deepl') return { data: { configured: true } }
      if (key === '/api/chat/claude-code-status') return { data: { loggedIn: false } }
      if (key === '/api/settings/deepl/usage') return { data: { monthlyChars: 0, freeTierRemaining: 500000 } }
      return { data: undefined }
    })
  })

  it('chooses configured deepl when switching into translate service mode', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const settings = makeSettings()

    render(<TaskModelSection settings={settings} t={t} />)

    const modeButtons = screen.getAllByRole('button', { name: 'integration.modeTranslateService' })
    await user.click(modeButtons[0])

    expect(settings.setTranslateProvider).toHaveBeenCalledWith('deepl')
    expect(settings.setTranslateModel).toHaveBeenCalledWith('')
  })

  it('keeps translate-service selection model-less when choosing deepl explicitly', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const settings = makeSettings({ translateProvider: 'google-translate' })

    swrMock.mockImplementation((key: string) => {
      if (key === '/api/settings/api-keys/anthropic') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/gemini') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/openai') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/google-translate') return { data: { configured: true } }
      if (key === '/api/settings/api-keys/deepl') return { data: { configured: true } }
      if (key === '/api/chat/claude-code-status') return { data: { loggedIn: false } }
      if (key === '/api/settings/google-translate/usage') return { data: { monthlyChars: 0, freeTierRemaining: 500000 } }
      if (key === '/api/settings/deepl/usage') return { data: { monthlyChars: 0, freeTierRemaining: 500000 } }
      return { data: undefined }
    })

    render(<TaskModelSection settings={settings} t={t} />)

    const deeplButtons = screen.getAllByRole('button', { name: 'provider.deepl' })
    await user.click(deeplButtons[0])

    expect(settings.setTranslateProvider).toHaveBeenCalledWith('deepl')
    expect(settings.setTranslateModel).toHaveBeenCalledWith('')
  })

  it('uses task-specific OpenAI defaults when OpenAI is selected', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const settings = makeSettings()

    swrMock.mockImplementation((key: string) => {
      if (key === '/api/settings/api-keys/anthropic') return { data: { configured: true } }
      if (key === '/api/settings/api-keys/gemini') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/openai') return { data: { configured: true } }
      if (key === '/api/settings/api-keys/google-translate') return { data: { configured: false } }
      if (key === '/api/settings/api-keys/deepl') return { data: { configured: false } }
      if (key === '/api/chat/claude-code-status') return { data: { loggedIn: false } }
      return { data: undefined }
    })

    render(<TaskModelSection settings={settings} t={t} />)

    const openaiButtons = screen.getAllByRole('button', { name: 'provider.openai' })
    await user.click(openaiButtons[0])
    await user.click(openaiButtons[1])
    await user.click(openaiButtons[2])

    expect(settings.setChatProvider).toHaveBeenCalledWith('openai')
    expect(settings.setChatModel).toHaveBeenCalledWith('gpt-5.4-mini')
    expect(settings.setSummaryProvider).toHaveBeenCalledWith('openai')
    expect(settings.setSummaryModel).toHaveBeenCalledWith('gpt-5.4-nano')
    expect(settings.setTranslateProvider).toHaveBeenCalledWith('openai')
    expect(settings.setTranslateModel).toHaveBeenCalledWith('gpt-5.4-mini')
  })
})
