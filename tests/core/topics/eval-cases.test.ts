import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ArticleMeta } from '../../../src/core/types'
import type { TopicTimeExclusion, TopicWindowInput } from '../../../src/core/topics/types'
import { resolveTopicWindow, selectTopicArticles } from '../../../src/core/topics/time-window'

interface EvaluationCase {
  id: string
  name: string
  asOf: string
  window: TopicWindowInput
  materials: Array<{ article: ArticleMeta; content: string }>
  expected: { includedIds: string[]; excluded: Array<{ id: string; reason: TopicTimeExclusion }> }
}

// 此处仅执行材料筛选契约；semanticChecks 留给真实模型与人工评审，不冒充已通过。
const suite = JSON.parse(readFileSync(new URL('../../fixtures/topic-decisions/cases.json', import.meta.url), 'utf8')) as {
  cases: EvaluationCase[]
}

describe('固定选题评估材料的发表时间口径', () => {
  for (const sample of suite.cases) {
    it(`${sample.id}: ${sample.name}`, () => {
      const window = resolveTopicWindow(sample.window, Date.parse(sample.asOf))
      if (window.preset === 'manual') throw new Error('评估材料只用时间窗口')
      const result = selectTopicArticles(sample.materials.map(m => m.article), window)
      expect(result.articles.map(m => m.id)).toEqual(sample.expected.includedIds)
      expect(result.excluded.map(m => ({ id: m.id, reason: m.reason }))).toEqual(sample.expected.excluded)
    })
  }
})
