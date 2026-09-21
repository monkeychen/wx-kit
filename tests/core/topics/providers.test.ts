import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOG, reasoningBodyFields, resolveProviderModel, type TopicAiProviderId } from '../../../src/core/topics/providers'

describe('厂商目录不变量', () => {
  const ids = Object.keys(PROVIDER_CATALOG) as TopicAiProviderId[]

  it('包含 7 厂商 + 自定义，label 与原型一致', () => {
    expect(ids).toEqual(['zhipu', 'qwen', 'deepseek', 'kimi', 'minimax', 'openai', 'gemini', 'custom'])
    expect(ids.map(id => PROVIDER_CATALOG[id].label)).toEqual([
      '智谱', '千问', 'DeepSeek', 'Kimi', 'MiniMax', 'OpenAI', 'Google', '自定义',
    ])
  })

  it.each(ids)('%s：payg 端点是合法 https URL，defaultModel 在模型列表内', id => {
    const provider = PROVIDER_CATALOG[id]
    expect(provider.plans.payg).toBeDefined()
    for (const plan of Object.values(provider.plans)) {
      if (id === 'custom') {
        expect(plan.baseUrl).toBe('')
        continue
      }
      expect(() => new URL(plan.baseUrl)).not.toThrow()
      expect(plan.baseUrl).toMatch(/^https:/)
    }
    if (id === 'custom') {
      expect(provider.models).toEqual([])
      expect(provider.defaultModel).toBe('')
    } else {
      expect(provider.models.map(model => model.id)).toContain(provider.defaultModel)
    }
    expect(provider.keyPrefixHint.length).toBeGreaterThan(0)
  })

  it('订阅端点与按量端点不同（zhipu/qwen 双 plan）', () => {
    expect(PROVIDER_CATALOG.zhipu.plans.plan!.baseUrl).not.toBe(PROVIDER_CATALOG.zhipu.plans.payg.baseUrl)
    expect(PROVIDER_CATALOG.qwen.plans.plan!.baseUrl).not.toBe(PROVIDER_CATALOG.qwen.plans.payg.baseUrl)
    expect(PROVIDER_CATALOG.deepseek.plans.plan).toBeUndefined()
  })

  it('模型能力：effort 必须以 reasoning 为前提，模型 ID 厂商内唯一', () => {
    for (const provider of Object.values(PROVIDER_CATALOG)) {
      const seen = new Set<string>()
      for (const model of provider.models) {
        expect(seen.has(model.id)).toBe(false)
        seen.add(model.id)
        if (model.effort) expect(model.reasoning).toBe(true)
      }
    }
  })

  it('原型演示的默认模型链路成立（智谱 glm-5.3-flash 支持推理与等级）', () => {
    const model = resolveProviderModel('zhipu', 'glm-5.3-flash')
    expect(model).toMatchObject({ reasoning: true, effort: true })
    expect(resolveProviderModel('kimi', 'kimi-k2.7-code')).toMatchObject({ reasoning: true, effort: false })
    expect(resolveProviderModel('custom', 'anything')).toBeUndefined()
  })
})

describe('reasoningBodyFields：推理参数映射（文档未证实的行为不下发）', () => {
  it.each([
    ['zhipu', { reasoning: true, effort: 'high' }, { thinking: { type: 'enabled' } }],
    ['zhipu', { reasoning: false, effort: 'high' }, { thinking: { type: 'disabled' } }],
    ['qwen', { reasoning: true, effort: 'high' }, { enable_thinking: true }],
    ['qwen', { reasoning: false, effort: 'high' }, { enable_thinking: false }],
    ['openai', { reasoning: true, effort: 'medium' }, { reasoning_effort: 'medium' }],
    ['openai', { reasoning: true, effort: 'extra' }, { reasoning_effort: 'extra' }],
    ['openai', { reasoning: true, effort: 'max' }, { reasoning_effort: 'max' }],
    ['openai', { reasoning: false, effort: 'medium' }, {}],
    ['gemini', { reasoning: true, effort: 'low' }, { reasoning_effort: 'low' }],
    ['deepseek', { reasoning: true, effort: 'high' }, {}],
    ['kimi', { reasoning: true, effort: 'high' }, {}],
    ['minimax', { reasoning: false, effort: 'high' }, {}],
    ['custom', { reasoning: true, effort: 'high' }, {}],
  ] as const)('%s reasoning=%s → %j', (providerId, input, expected) => {
    expect(reasoningBodyFields(providerId, input)).toEqual(expected)
  })

  it('effort 不被支持的厂商（zhipu）即使配置了等级也不下发 reasoning_effort', () => {
    const fields = reasoningBodyFields('zhipu', { reasoning: true, effort: 'high' })
    expect(fields).not.toHaveProperty('reasoning_effort')
  })
})
