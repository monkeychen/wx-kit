// src/renderer/topic-manual-pick.ts
// M77：手动选稿弹层的纯变换——筛选（时间/来源/关键词）+ 排序 + 分组。
// 与 library-view / library-sort 同源：来源归并与排序直接复用现成纯函数，
// 这里只补「手动选稿」特有的部分（时间快捷段、已选保留计数、弹层分组标签）。
// 不引入 IO / Electron 运行时，可直接在 vitest 里断言。
import type { ArticleMeta } from '../core/types'
import { parsePublicationTime, shanghaiDate } from '../core/publication-time'
// 排序在 core/library-sort，由 library-view re-export——与文库页共用同一份顺序语义。
import { accountOptions, accountName, filterByAccount, groupByAccount, sortArticles, type AccountOption } from './library-view'

const DAY_MS = 86_400_000
const MOWEN_HOST = 'note.mowen.cn'

/** 来源下拉的「全部」哨兵值。 */
export const MANUAL_ALL_SOURCES = 'all'

export type ManualTimeRange = '7d' | '30d' | '90d' | 'year' | 'all'
export type ManualSortKey = 'new' | 'old' | 'source'

export const MANUAL_TIME_RANGES: Array<{ value: ManualTimeRange; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
  { value: 'year', label: '今年' },
  { value: 'all', label: '全部' },
]

export const MANUAL_SORTS: Array<{ value: ManualSortKey; label: string }> = [
  { value: 'new', label: '发布时间：最新在前' },
  { value: 'old', label: '发布时间：最早在前' },
  { value: 'source', label: '按公众号 / 作者分组' },
]

export interface ManualFilterState {
  time: ManualTimeRange
  sourceId: string
  keyword: string
  sort: ManualSortKey
  onlyPicked: boolean
}

/** 默认「近 30 天」：找素材绝大多数是近期行为，默认全量等于没有默认。 */
export const DEFAULT_MANUAL_FILTER: ManualFilterState = {
  time: '30d',
  sourceId: MANUAL_ALL_SOURCES,
  keyword: '',
  sort: 'new',
  onlyPicked: false,
}

export interface ManualSourceOption {
  id: string
  name: string
  count: number
  kind: 'wx' | 'mowen'
}

export interface ManualGroup {
  key: string
  label: string
  items: ArticleMeta[]
}

export interface ManualPickView {
  /** 命中当前时间 + 来源 + 关键词的文章（不含「仅看已选」）。 */
  hits: ArticleMeta[]
  /** 最终可见：命中 + 仅看已选过滤 + 排序。 */
  visible: ArticleMeta[]
  groups: ManualGroup[]
  /** 被时间条件挡掉的「时间未知」篇数——不静默丢，提示切到「全部」。 */
  unknownTimeCount: number
  /** 已选但不在 hits 里的篇数：选择跨筛选保留，得让人看见。 */
  hiddenSelectedCount: number
  sourceOptions: ManualSourceOption[]
}

/** 公众号还是墨问笔记：墨问条目落库后 sourceUrl 指向墨问笔记域。 */
export function sourceKind(article: ArticleMeta): 'wx' | 'mowen' {
  return typeof article.sourceUrl === 'string' && article.sourceUrl.includes(MOWEN_HOST) ? 'mowen' : 'wx'
}

/** 发表时间是否落在时间快捷段内。解析不出时间：只有「全部」才纳入（与 core 的
 *  unknown-publication-time 同一口径——不确定就不算在窗口里，但也不永久隐藏）。 */
export function withinManualTime(article: ArticleMeta, range: ManualTimeRange, asOfMs: number): boolean {
  const ms = parsePublicationTime(article.publishTime)
  if (ms == null) return range === 'all'
  if (range === 'all') return true
  if (range === 'year') return shanghaiDate(ms).slice(0, 4) === shanghaiDate(asOfMs).slice(0, 4)
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  return ms >= asOfMs - days * DAY_MS
}

export function matchesManualKeyword(article: ArticleMeta, keyword: string): boolean {
  const text = keyword.trim().toLowerCase()
  if (!text) return true
  // 只匹配标题与来源：正文匹配命中无法预期，用户更算不清漏了什么。
  return article.title.toLowerCase().includes(text) || accountName(article).toLowerCase().includes(text)
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 分组头的日期写法：今天 / 昨天 / 9月21日 周一 / 2025年12月3日 / 时间未知。 */
export function manualDateLabel(ms: number | null, asOfMs: number): string {
  if (ms == null) return '时间未知'
  const day = shanghaiDate(ms)
  const today = shanghaiDate(asOfMs)
  if (day === today) return '今天'
  if (day === shanghaiDate(asOfMs - DAY_MS)) return '昨天'
  const date = new Date(`${day}T00:00:00Z`)
  const week = WEEKDAYS[date.getUTCDay()]
  const [year, month, dateOfMonth] = day.split('-')
  if (year === today.slice(0, 4)) return `${Number(month)}月${Number(dateOfMonth)}日 · ${week}`
  return `${year}年${Number(month)}月${Number(dateOfMonth)}日`
}

function sortVisible(list: ArticleMeta[], sort: ManualSortKey): ArticleMeta[] {
  if (sort === 'source') {
    // 先按时间倒序，再按来源分组——组序即「该号最新一篇」的新旧，组内也是新的在前。
    return groupByAccount(sortArticles(list, 'publish', 'desc')).flatMap(group => group.items)
  }
  return sortArticles(list, 'publish', sort === 'old' ? 'asc' : 'desc')
}

/** 分组：按来源分组时组头是公众号/作者名，否则按日期（无时间的单独一组）。 */
export function buildManualGroups(list: ArticleMeta[], sort: ManualSortKey, asOfMs: number): ManualGroup[] {
  if (sort === 'source') {
    const groups = new Map<string, ManualGroup>()
    for (const article of list) {
      const key = accountName(article)
      const group = groups.get(key) ?? { key, label: key, items: [] }
      group.items.push(article)
      groups.set(key, group)
    }
    return [...groups.values()]
  }
  const groups = new Map<string, ManualGroup>()
  for (const article of list) {
    const ms = parsePublicationTime(article.publishTime)
    const key = ms == null ? 'unknown' : shanghaiDate(ms)
    const group = groups.get(key) ?? { key, label: manualDateLabel(ms, asOfMs), items: [] }
    group.items.push(article)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** 来源下拉：按公众号 / 墨问作者分组，计数跟随当前时间段（不跟随关键词与来源本身）。 */
export function manualSourceOptions(articles: readonly ArticleMeta[], time: ManualTimeRange, asOfMs: number): ManualSourceOption[] {
  const pool = articles.filter(article => withinManualTime(article, time, asOfMs))
  return accountOptions([...articles]).map(option => {
    const own = filterByAccount(pool, option)
    const sample = own[0] ?? articles.find(article => accountName(article) === option.name)
    return { id: option.id, name: option.name, count: own.length, kind: sample ? sourceKind(sample) : 'wx' }
  })
}

function findOption(articles: readonly ArticleMeta[], sourceId: string): AccountOption | null {
  if (sourceId === MANUAL_ALL_SOURCES) return null
  return accountOptions([...articles]).find(option => option.id === sourceId) ?? null
}

/**
 * 一次算完弹层要展示的全部派生数据。纯函数：不改输入、不读时钟之外的环境。
 * asOfMs 由调用方注入（组件里用 Date.now()），测试可固定。
 */
export function buildManualPickView(
  articles: readonly ArticleMeta[],
  state: ManualFilterState,
  options: { asOfMs: number; selectedIds?: readonly string[] },
): ManualPickView {
  const asOfMs = options.asOfMs
  const byTime = articles.filter(article => withinManualTime(article, state.time, asOfMs))
  const unknownTimeCount = state.time === 'all'
    ? 0
    : articles.filter(article => parsePublicationTime(article.publishTime) == null).length
  const option = findOption(articles, state.sourceId)
  const hits = filterByAccount(byTime, option).filter(article => matchesManualKeyword(article, state.keyword))
  const selected = new Set(options.selectedIds ?? [])
  const visible = sortVisible(
    hits.filter(article => !state.onlyPicked || selected.has(article.id)),
    state.sort,
  )
  const hitIds = new Set(hits.map(article => article.id))
  let hiddenSelectedCount = 0
  for (const id of selected) if (!hitIds.has(id)) hiddenSelectedCount += 1
  return {
    hits,
    visible,
    groups: buildManualGroups(visible, state.sort, asOfMs),
    unknownTimeCount,
    hiddenSelectedCount,
    sourceOptions: manualSourceOptions(articles, state.time, asOfMs),
  }
}

// —— M78「看一眼」：摘要解析（纯函数部分） ——

export interface ManualExcerpt {
  kind: 'digest' | 'content' | 'none'
  text: string
}

const EXCERPT_MAX = 200

/**
 * 行内「看一眼」的摘要来源：
 * ① meta 的 digest（作者自己写的摘要，三个下载渠道都有，无条件优先）；
 * ② 正文截断由 UI 层懒加载后回填（这里只负责把 md 文本裁成摘要形态）；
 * ③ 都没有 → none，UI 给如实文案，不装死。
 */
export function resolveExcerpt(article: Pick<ArticleMeta, 'digest'>, content?: string): ManualExcerpt {
  const digest = article.digest.trim()
  if (digest) return { kind: 'digest', text: digest }
  if (content != null) {
    const body = mdToExcerpt(content)
    if (body) return { kind: 'content', text: body.slice(0, EXCERPT_MAX) + (body.length > EXCERPT_MAX ? '…' : '') }
  }
  return { kind: 'none', text: '' }
}

/** md → 摘要形态：去 frontmatter、代码块/图片/链接语法，标题行并入正文，压平空白。 */
function mdToExcerpt(md: string): string {
  const withoutFrontmatter = md.replace(/^---\n[\s\S]*?\n---\n/, '')
  const lines: string[] = []
  let inCode = false
  for (const raw of withoutFrontmatter.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```')) { inCode = !inCode; continue }
    if (inCode || !line || line.startsWith('![')) continue
    lines.push(line.replace(/^#{1,6}\s*/, ''))
  }
  return lines
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
