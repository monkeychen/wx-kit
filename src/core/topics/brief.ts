import type { TopicDecisionCard, TopicRunResult, TopicWindow } from './types'

/** 素材范围的人类可读表述；manual 没有起止时间（M75）。 */
function windowLabel(window: TopicWindow): string {
  if (window.preset === 'manual') return `手动选择的 ${window.articleIds.length} 篇文章`
  return `${new Date(window.fromMs).toISOString()} 至 ${new Date(window.toMs).toISOString()}`
}

const VALUE_LABELS = {
  knowledge: '知识',
  'information-gap': '信息差',
  resonance: '情绪共鸣',
  'anxiety-relief': '缓解焦虑',
  joy: '快乐',
} as const

const ROLE_LABELS = { support: '支持材料', counterpoint: '反方材料', background: '背景材料' } as const

function inline(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/([\\`*_[\]#])/g, '\\$1').trim()
}

function quote(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map(line => `> ${line}`).join('\n')
}

function sourceReference(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  try {
    const url = new URL(compact)
    if (url.protocol === 'http:' || url.protocol === 'https:') return `<${url.toString()}>`
  } catch { /* 非 URL 按普通文本展示 */ }
  return inline(compact)
}

export function buildTopicBrief(
  card: TopicDecisionCard,
  run: Pick<TopicRunResult, 'runId' | 'window' | 'createdAt'>,
): string {
  const values = card.readerValues.map(value =>
    `- **${VALUE_LABELS[value.kind]}**：${inline(value.benefit)}（编辑推断）`).join('\n')
  const evidence = card.evidence.map(item => [
    `### ${ROLE_LABELS[item.role]} · ${inline(item.sourceTitle)}`,
    `- 来源账号：${inline(item.sourceAccount)}`,
    `- 原文：${sourceReference(item.sourceUrl)}`,
    `- 定位：${item.paragraphId}`,
    '',
    quote(item.quote),
  ].join('\n')).join('\n\n')
  const list = (items: string[]) => items.map(item => `- ${inline(item)}`).join('\n') || '- 无'
  const outline = card.outline.map((item, index) => `${index + 1}. ${inline(item)}`).join('\n')
  return [
    `# ${inline(card.question)}`,
    '',
    `- 运行：${run.runId}`,
    `- 生成时间：${run.createdAt}`,
    `- 素材范围：${windowLabel(run.window)}`,
    '- 传播效果：未验证',
    '',
    '## 写作角度', '', inline(card.angle), '',
    '## 为什么考虑这个题目', '', inline(card.rationale), '',
    '## 读者可能获得什么', '', values, '',
    '## 依据把握', '', `- 等级：${card.evidenceConfidence.level}`, list(card.evidenceConfidence.reasons), '',
    '## 材料依据', '', evidence, '',
    '## 限制', '', list(card.limitations), '',
    '## 还需补充的证据', '', list(card.missingEvidence), '',
    '## 起笔结构', '', outline, '',
  ].join('\n')
}
