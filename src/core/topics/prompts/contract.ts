// 选题输出契约的单一真相源（M76）。
//
// 这一层存在的原因：prompt 与校验器曾是两份手写副本——校验器加一条约束，prompt 里
// 不一定有对应表述，模型只能猜，猜错即整批失败（M74 的 kind 枚举、M76 的
// distributionEvidence）。现在常量只有这一份：validate.ts 用它校验，prompts/index.ts
// 用它生成指令文本。已声明的约束不可能漏进 prompt。
//
// 新增枚举值或调整护栏只改这里——校验与提示词同步生效，prompts.test.ts 会兜底。

import type { TopicExtractionKind } from '../model'
import type { ReaderValueKind, TopicClaim, TopicDecisionCard, TopicEvidence } from '../types'

export const EXTRACTION_KINDS: readonly TopicExtractionKind[] = [
  'fact-claim', 'opinion', 'question', 'emotion', 'change', 'counterpoint',
]
export const VALUE_KINDS: readonly ReaderValueKind[] = [
  'knowledge', 'information-gap', 'resonance', 'anxiety-relief', 'joy',
]
export const CLAIM_KINDS: readonly TopicClaim['kind'][] = [
  'source-fact-claim', 'source-opinion', 'editorial-inference',
]
export const EVIDENCE_ROLES: readonly TopicEvidence['role'][] = ['support', 'counterpoint', 'background']
export const CONFIDENCE_LEVELS: readonly TopicDecisionCard['evidenceConfidence']['level'][] = ['high', 'medium', 'low']

/** 首版没有可读的传播数据，该字段只允许这一个字面量（或省略）。 */
export const DISTRIBUTION_EVIDENCE_VALUE = 'unverified'

export const MAX_EXTRACTIONS = 200
export const MAX_CARDS = 3

/** 供 validate 做 O(1) 查找；集合由上面的数组派生，不重复声明。 */
export const asSet = <T>(values: readonly T[]): Set<T> => new Set(values)
