import { parsePublicationTime } from '../publication-time'
import type { ArticleMeta } from '../types'
import type { TopicArticleSelection, TopicPublicationDecision, TopicWindow, TopicWindowInput } from './types'

const DAY_MS = 86_400_000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const HOURS = { '24h': 24, '3d': 72, '7d': 168 } as const

function parseDateInput(value: string): number {
  const time = typeof value === 'string' && DATE_ONLY.test(value) ? parsePublicationTime(value) : null
  if (time == null) throw new RangeError('日期必须是存在的 YYYY-MM-DD 自然日')
  return time
}

/** 所有边界均为毫秒时间戳，结束边界排除；now 注入后整轮固定。 */
export function resolveTopicWindow(input: TopicWindowInput = { preset: '24h' }, asOfMs: number = Date.now()): TopicWindow {
  if (!Number.isFinite(asOfMs) || !Number.isFinite(new Date(asOfMs).getTime())) {
    throw new RangeError('分析时刻无效')
  }
  if (!input || typeof input !== 'object') throw new RangeError('请选择有效的素材范围')
  const common = { asOfMs, timeZone: 'Asia/Shanghai' as const }
  if (input.preset === 'custom') {
    const fromMs = parseDateInput(input.from)
    const lastDay = parseDateInput(input.to)
    if (fromMs > lastDay) throw new RangeError('结束日期不能早于开始日期')
    return { preset: 'custom', fromMs, toMs: lastDay + DAY_MS, ...common }
  }
  if (input.preset !== '24h' && input.preset !== '3d' && input.preset !== '7d') {
    throw new RangeError('范围只接受最近 24 小时、3 天、7 天或自定义日期')
  }
  const fromMs = asOfMs - HOURS[input.preset] * 3_600_000
  if (!Number.isFinite(new Date(fromMs).getTime())) throw new RangeError('素材范围超出可表示的日期')
  return { preset: input.preset, fromMs, toMs: asOfMs, ...common }
}

/** 日期精度表示整天的不确定区间，不把日期猜成精确的零点。 */
export function classifyTopicPublication(publishTime: string, window: TopicWindow): TopicPublicationDecision {
  const time = parsePublicationTime(publishTime)
  if (time == null) return { included: false, reason: 'unknown-publication-time' }
  if (time > window.asOfMs) return { included: false, reason: 'future-publication-time' }

  if (DATE_ONLY.test(publishTime.trim())) {
    const end = time + DAY_MS
    if (end <= window.fromMs || time >= window.toMs) return { included: false, reason: 'outside-window' }
    if (time < window.fromMs || end > window.toMs) return { included: false, reason: 'uncertain-publication-time' }
    return { included: true, precision: 'day', publishedAtMs: time }
  }

  if (time < window.fromMs || time >= window.toMs) return { included: false, reason: 'outside-window' }
  return { included: true, precision: 'instant', publishedAtMs: time }
}

/** 只按原文时间选择，不触发订阅/下载、不读取文件、不改动传入元数据。 */
export function selectTopicArticles(articles: readonly ArticleMeta[], window: TopicWindow): TopicArticleSelection {
  const result: TopicArticleSelection = { articles: [], excluded: [] }
  for (const article of articles) {
    const decision = classifyTopicPublication(article.publishTime, window)
    if (decision.included) result.articles.push(article)
    else result.excluded.push({ id: article.id, publishTime: article.publishTime, reason: decision.reason })
  }
  return result
}
