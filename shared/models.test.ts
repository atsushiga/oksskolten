import { describe, expect, it } from 'vitest'
import { DEFAULT_MODELS, OPENAI_MODELS, getModelLabel, getModelPricing, getModelValues } from './models'

describe('OPENAI_MODELS', () => {
  it('includes GPT-5.4 mini and nano variants', () => {
    expect(getModelValues('openai')).toContain('gpt-5.4-mini')
    expect(getModelValues('openai')).toContain('gpt-5.4-nano')

    expect(getModelLabel('gpt-5.4-mini')).toBe('GPT-5.4 Mini')
    expect(getModelLabel('gpt-5.4-nano')).toBe('GPT-5.4 Nano')
    expect(getModelPricing('gpt-5.4-mini')).toEqual([0.75, 3])
    expect(getModelPricing('gpt-5.4-nano')).toEqual([0.20, 0.80])

    expect(OPENAI_MODELS[0]?.models.map(model => model.value)).toEqual(
      expect.arrayContaining(['gpt-5.4-mini', 'gpt-5.4-nano']),
    )
  })

  it('uses GPT-5.4 mini as the generic OpenAI default', () => {
    expect(DEFAULT_MODELS.openai).toBe('gpt-5.4-mini')
  })
})
