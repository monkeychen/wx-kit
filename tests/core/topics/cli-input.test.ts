import { describe, expect, it } from 'vitest'
import { TopicCliInputError, resolveTopicCliModelConfig, resolveTopicWindowArgs } from '../../../src/core/topics/cli-input'

const AS_OF = Date.parse('2026-09-20T04:00:00Z')

describe('topics CLI 时间参数', () => {
  it('默认 24h 并复用同一时间窗口契约', () => {
    expect(resolveTopicWindowArgs({}, AS_OF)).toEqual({
      preset: '24h', fromMs: Date.parse('2026-09-19T04:00:00Z'), toMs: AS_OF,
      asOfMs: AS_OF, timeZone: 'Asia/Shanghai',
    })
  })

  it.each(['3d', '7d'] as const)('支持固定范围 %s', range => {
    expect(resolveTopicWindowArgs({ range }, AS_OF).preset).toBe(range)
  })

  it('custom 同时要求 from/to 并包含结束日', () => {
    expect(resolveTopicWindowArgs({ range: 'custom', from: '2026-09-18', to: '2026-09-19' }, AS_OF))
      .toMatchObject({ preset: 'custom', fromMs: Date.parse('2026-09-17T16:00:00Z'), toMs: Date.parse('2026-09-19T16:00:00Z') })
  })

  it.each([
    { range: 'custom' },
    { range: 'custom', from: '2026-09-18' },
    { range: 'custom', to: '2026-09-19' },
    { range: '24h', from: '2026-09-18' },
    { range: 'automatic' },
  ])('拒绝有歧义的时间参数 %#', opts => {
    expect(() => resolveTopicWindowArgs(opts, AS_OF)).toThrow(TopicCliInputError)
  })
})

describe('topics CLI 模型配置', () => {
  it('命令参数优先，Key 只从固定环境变量读取', () => {
    expect(resolveTopicCliModelConfig({ baseUrl: 'https://flag.invalid/v1', model: 'flag-model' }, {
      WXKIT_AI_BASE_URL: 'https://env.invalid/v1', WXKIT_AI_MODEL: 'env-model', WXKIT_AI_API_KEY: 'key-from-env',
    })).toEqual({ baseUrl: 'https://flag.invalid/v1', model: 'flag-model', apiKey: 'key-from-env' })
  })

  it('base URL 和 model 可完全来自环境变量', () => {
    expect(resolveTopicCliModelConfig({}, {
      WXKIT_AI_BASE_URL: 'https://env.invalid/v1', WXKIT_AI_MODEL: 'env-model', WXKIT_AI_API_KEY: 'key-from-env',
    })).toEqual({ baseUrl: 'https://env.invalid/v1', model: 'env-model', apiKey: 'key-from-env' })
  })

  it.each([
    [{ model: 'm' }, { WXKIT_AI_API_KEY: 'secret-value' }, 'MISSING_AI_BASE_URL'],
    [{ baseUrl: 'https://x.invalid/v1' }, { WXKIT_AI_API_KEY: 'secret-value' }, 'MISSING_AI_MODEL'],
    [{ baseUrl: 'https://x.invalid/v1', model: 'm' }, {}, 'MISSING_AI_API_KEY'],
  ] as const)('缺配置返回稳定错误且不泄漏 Key：%s', (opts, env, code) => {
    try {
      resolveTopicCliModelConfig(opts, env)
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(TopicCliInputError)
      expect((error as TopicCliInputError).code).toBe(code)
      expect((error as Error).message).not.toContain('secret-value')
    }
  })
})
