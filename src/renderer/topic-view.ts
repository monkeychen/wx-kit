import type {
  ReaderValueKind,
  TopicFeedbackDecision,
  TopicRunResult,
  TopicStatistics,
  TopicTraceEvent,
} from '../core/topics/types'

const VALUE_LABELS: Record<ReaderValueKind, string> = {
  knowledge: '知识',
  'information-gap': '信息差',
  resonance: '情绪共鸣',
  'anxiety-relief': '缓解焦虑',
  joy: '快乐',
}

const FEEDBACK_LABELS: Record<TopicFeedbackDecision, string> = {
  skip: '暂不写',
  watch: '保存观察',
  'already-written': '已经写过',
}

export const readerValueLabel = (kind: ReaderValueKind): string => VALUE_LABELS[kind]
export const feedbackLabel = (decision: TopicFeedbackDecision): string => FEEDBACK_LABELS[decision]

export function isSafeExternalSource(value: string): boolean {
  try { return new URL(value).protocol === 'https:' }
  catch { return false }
}

export function stageLabel(stage: TopicTraceEvent['stage']): string {
  return ({
    snapshot: '正在整理素材', extract: '正在提取材料依据', 'validate-extract': '正在核对材料依据',
    propose: '正在形成候选选题', 'validate-propose': '正在核对候选选题', result: '正在保存分析结果',
  })[stage]
}

export function statisticsLabel(statistics: TopicStatistics): string {
  return `${statistics.relatedArticleCount} 篇材料 · ${statistics.sourceAccountCount} 个账号 · ${statistics.contentGroupCount} 个内容组`
}

export function confidenceLabel(level: 'high' | 'medium' | 'low'): string {
  return `依据把握：${({ high: '高', medium: '中', low: '低' })[level]}`
}

export function resultNotice(result: TopicRunResult): { tone: 'success' | 'info' | 'warning' | 'error'; text: string } {
  if (result.status === 'failed') return { tone: 'error', text: result.error.message }
  if (result.status === 'cancelled') return { tone: 'info', text: '已取消本次分析。' }
  if (result.status === 'insufficient-material') return { tone: 'info', text: result.reason }
  if (result.status === 'partial') return { tone: 'warning', text: `已生成 ${result.cards.length} 个候选，另有 ${result.failures.length} 项未通过校验。` }
  if (result.cards.length === 0) return { tone: 'info', text: '本次没有足够依据推荐题目。' }
  return { tone: 'success', text: `已生成 ${result.cards.length} 个候选。传播效果仍需发布后验证。` }
}
