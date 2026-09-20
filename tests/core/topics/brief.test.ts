import { describe, expect, it } from 'vitest'
import type { TopicDecisionCard } from '../../../src/core/topics/types'
import { buildTopicBrief } from '../../../src/core/topics/brief'

const card: TopicDecisionCard = {
  id: 'topic-1',
  question: '为什么市场上涨时，人仍然会焦虑？',
  angle: '比较“踏空”感受与目标期限不清两种解释。',
  readerValues: [
    { kind: 'anxiety-relief', benefit: '把模糊不安拆成可以检查的问题。', evidenceIds: ['e1'], judgment: 'inference' },
    { kind: 'knowledge', benefit: '认识两种可能机制。', evidenceIds: ['e1', 'e2'], judgment: 'inference' },
  ],
  rationale: '两组材料提供了不同解释。',
  claims: [{ text: '这适合作为解释型文章入口。', kind: 'editorial-inference', evidenceIds: ['e1'] }],
  evidence: [
    { id: 'e1', articleId: 'a1', paragraphId: 'g001:p001', contentHash: 'h1', quote: '一些人更频繁查看账户', role: 'support', validation: 'matched', sourceTitle: '上涨后的感受', sourceAccount: '合成账号甲', sourceUrl: 'https://example.invalid/a1' },
    { id: 'e2', articleId: 'a2', paragraphId: 'g002:p001', contentHash: 'h2', quote: '焦虑也可能来自目标不清', role: 'counterpoint', validation: 'matched', sourceTitle: '另一种解释', sourceAccount: '合成账号乙', sourceUrl: 'https://example.invalid/a2' },
  ],
  statistics: { relatedArticleCount: 2, sourceAccountCount: 2, contentGroupCount: 2, publishedDates: ['2026-09-19', '2026-09-20'] },
  evidenceConfidence: { level: 'medium', reasons: ['摘录可定位，但没有读者行为数据。'] },
  distributionEvidence: 'unverified',
  limitations: ['不同账号不等于独立事实验证。'],
  missingEvidence: ['需要读者访谈或研究。'],
  outline: ['从上涨仍焦虑的情境开篇。', '比较两种解释。', '给出可以自查的问题。'],
}

describe('选题简报', () => {
  it('从已校验卡片确定性组装完整 Markdown', () => {
    const brief = buildTopicBrief(card, {
      runId: 'run-1', createdAt: '2026-09-20T04:00:00.000Z',
      window: { preset: '24h', fromMs: Date.parse('2026-09-19T04:00:00Z'), toMs: Date.parse('2026-09-20T04:00:00Z'), asOfMs: Date.parse('2026-09-20T04:00:00Z'), timeZone: 'Asia/Shanghai' },
    })
    for (const text of [
      '# 为什么市场上涨时，人仍然会焦虑？',
      '比较“踏空”感受与目标期限不清两种解释。',
      '缓解焦虑', '把模糊不安拆成可以检查的问题。',
      '传播效果：未验证', '摘录可定位，但没有读者行为数据。',
      '上涨后的感受', '合成账号甲', '<https://example.invalid/a1>',
      '> 一些人更频繁查看账户', '不同账号不等于独立事实验证。',
      '需要读者访谈或研究。', '从上涨仍焦虑的情境开篇。',
    ]) expect(brief).toContain(text)
    expect(brief).not.toMatch(/爆款指数|预计阅读量|模型原始/)
  })

  it('把来源中的换行和 Markdown 控制字符转成安全可读文本', () => {
    const unsafe = structuredClone(card)
    unsafe.evidence[0].sourceTitle = '标题\n*注入列表*'
    unsafe.evidence[0].quote = '第一行\n第二行'
    unsafe.evidence[0].sourceUrl = 'javascript:alert(1)\n#标题'
    const brief = buildTopicBrief(unsafe, { runId: 'run-1', createdAt: '2026-09-20T04:00:00.000Z', window: { preset: '24h', fromMs: 1, toMs: 2, asOfMs: 2, timeZone: 'Asia/Shanghai' } })
    expect(brief).toContain('标题 \\*注入列表\\*')
    expect(brief).toContain('> 第一行\n> 第二行')
    expect(brief).not.toContain('<javascript:')
    expect(brief).toContain('javascript:alert(1) \\#标题')
  })
})
