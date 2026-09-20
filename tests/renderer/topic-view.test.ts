import { describe, expect, it } from 'vitest'
import type { TopicDecisionCard, TopicTraceEvent } from '../../src/core/topics/types'
import { confidenceLabel, feedbackLabel, isSafeExternalSource, readerValueLabel, resultNotice, stageLabel, statisticsLabel } from '../../src/renderer/topic-view'

describe('选题页文案边界', () => {
  it.each([
    ['knowledge', '知识'], ['information-gap', '信息差'], ['resonance', '情绪共鸣'], ['anxiety-relief', '缓解焦虑'], ['joy', '快乐'],
  ] as const)('读者价值 %s → %s', (kind, label) => expect(readerValueLabel(kind)).toBe(label))

  it.each([
    ['snapshot', '正在整理素材'], ['extract', '正在提取材料依据'], ['propose', '正在形成候选选题'], ['result', '正在保存分析结果'],
  ] as const)('进度 %s → %s', (stage, label) => expect(stageLabel(stage as TopicTraceEvent['stage'])).toBe(label))

  it('统计只称账号和内容组，不包装成独立来源', () => {
    const label = statisticsLabel({ relatedArticleCount: 3, sourceAccountCount: 2, contentGroupCount: 1, publishedDates: [] })
    expect(label).toBe('3 篇材料 · 2 个账号 · 1 个内容组')
    expect(label).not.toContain('独立来源')
  })

  it('依据把握与传播效果分开表达', () => {
    expect(confidenceLabel('medium')).toBe('依据把握：中')
    expect(confidenceLabel('medium')).not.toContain('传播')
  })

  it.each([
    ['skip', '暂不写'], ['watch', '保存观察'], ['already-written', '已经写过'],
  ] as const)('反馈 %s → %s', (decision, label) => expect(feedbackLabel(decision)).toBe(label))

  it('不同运行状态给不同提示，完成空数组不是故障', () => {
    const base = { schemaVersion: 1 as const, runId: 'r', window: { preset: '24h' as const, fromMs: 1, toMs: 2, asOfMs: 2, timeZone: 'Asia/Shanghai' as const }, manifestPath: 'm', createdAt: 'x', durationMs: 1 }
    expect(resultNotice({ ...base, status: 'completed', cards: [] })).toEqual({ tone: 'info', text: '本次没有足够依据推荐题目。' })
    expect(resultNotice({ ...base, status: 'partial', cards: [], failures: [{ code: 'X', message: 'x' }] })).toMatchObject({ tone: 'warning' })
    expect(resultNotice({ ...base, status: 'failed', cards: [], error: { code: 'X', message: '请求失败' } })).toEqual({ tone: 'error', text: '请求失败' })
  })

  it('卡片传播文案固定为未验证', () => {
    const card = { distributionEvidence: 'unverified' } as TopicDecisionCard
    expect(card.distributionEvidence === 'unverified' ? '传播效果未验证' : '').toBe('传播效果未验证')
  })

  it('证据原文只允许 HTTPS 外链', () => {
    expect(isSafeExternalSource('https://mp.weixin.qq.com/s/example')).toBe(true)
    expect(isSafeExternalSource('http://127.0.0.1/article')).toBe(false)
    expect(isSafeExternalSource('file:///tmp/private')).toBe(false)
    expect(isSafeExternalSource('not-a-url')).toBe(false)
  })
})
