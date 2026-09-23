import { describe, expect, it } from 'vitest'
import {
  CLAIM_KINDS,
  CONFIDENCE_LEVELS,
  DISTRIBUTION_EVIDENCE_VALUE,
  EVIDENCE_ROLES,
  EXTRACTION_KINDS,
  MAX_CARDS,
  MAX_EXTRACTIONS,
  VALUE_KINDS,
} from '../../../src/core/topics/prompts/contract'
import { stageInstruction } from '../../../src/core/topics/prompts'

// 这些断言的存在理由：prompt 是发给模型的契约，校验器的每条硬约束都必须在文本里有
// 对应表述。M74（kind 枚举缺失 → 15 条提取全灭）与 M76（distributionEvidence 缺失 →
// 三张卡全灭）是同一个病根两次发作——fixture 桩测永远吐合法值，抓不到契约没送达。
// 所以这里对常量做遍历断言：以后新增枚举值而 prompt 模板漏改，测试立刻红。

describe('extract 指令的契约自含性', () => {
  const text = stageInstruction('extract')

  it('列出全部提取类型枚举值', () => {
    for (const kind of EXTRACTION_KINDS) expect(text).toContain(kind)
  })

  it('写明逐字摘录与 ID 来源要求', () => {
    expect(text).toContain('逐字')
    expect(text).toContain('连续')
    expect(text).toContain('groupId')
    expect(text).toContain('paragraphId')
    expect(text).toContain('snapshot')
  })

  it('写明每条必填字段与条数上限', () => {
    for (const field of ['id', 'quote', 'kind', 'summary', 'theme']) expect(text).toContain(field)
    expect(text).toContain(String(MAX_EXTRACTIONS))
  })
})

describe('propose 指令的契约自含性', () => {
  const text = stageInstruction('propose')

  it('列出全部取值枚举：读者价值、陈述类型、依据角色、把握等级', () => {
    for (const kind of VALUE_KINDS) expect(text).toContain(kind)
    for (const kind of CLAIM_KINDS) expect(text).toContain(kind)
    for (const role of EVIDENCE_ROLES) expect(text).toContain(role)
    for (const level of CONFIDENCE_LEVELS) expect(text).toContain(level)
  })

  it('写明 distributionEvidence 只能省略或填字面量 unverified', () => {
    // 本次报错的直接原因：模型不知道该字段只能填这个英文单词，于是自己发挥。
    expect(text).toContain('distributionEvidence')
    expect(text).toContain(DISTRIBUTION_EVIDENCE_VALUE)
  })

  it('禁止模型自报统计', () => {
    expect(text).toContain('statistics')
  })

  it('写明引用只能指向本轮输入的提取项与卡内依据', () => {
    expect(text).toContain('extractionId')
    expect(text).toContain('evidenceIds')
  })

  it('写明卡片上限与全部必填字段', () => {
    expect(text).toContain(String(MAX_CARDS))
    for (const field of [
      'id', 'question', 'angle', 'rationale', 'readerValues', 'claims', 'evidence',
      'evidenceConfidence', 'limitations', 'missingEvidence', 'outline',
    ]) expect(text).toContain(field)
  })
})

describe('两条指令的公共约束', () => {
  it('都要求只输出 JSON object（不给模型自由发挥的空间）', () => {
    expect(stageInstruction('extract')).toContain('只返回 JSON object')
    expect(stageInstruction('propose')).toContain('只返回 JSON object')
  })
})
