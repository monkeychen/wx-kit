// src/core/mowen/mowen-to-article.ts
// note/show 结果 → wx-kit 统一的 ParsedArticle（进 exporter/阅读器/文库的同一条路）。
// 图片：<img uuid> 无 src（真机钉死），按 noteFile.images 映射重写为 w_1200 签名 URL；
// 后续「下载→重写→落盘」复用 exporter 既有链路（buildImageMap/rewriteImageRefs）。
// 引用（v0.11.2 R1）：正文 <note uuid> 占位标签（真机钉死：原生不带标题，与 <img uuid> 同模式）
// 原地替换为 blockquote 引用卡片（标题/摘要/作者/链接，对齐墨问 App 内联形态）；
// 旧尾部「引用笔记」追加块退场（同信息两处重复）；refNoteIds 未在正文出现的文末补卡防信息丢失。
import type { ParsedArticle } from '../types'
import type { VideoEntry } from '../parse-video'
import type { NoteShowResult } from './note-show'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

/** 引用子笔记元信息（downloadMowenNote 拉取；state 区分成功/付费/失败，失败不伪装） */
export interface RefNoteMeta {
  uuid: string
  title?: string
  digest?: string
  authorName?: string
  publicAt?: number | null
  state: 'ok' | 'paid' | 'failed'
}

/** unix 秒 → 北京时间 'YYYY-MM-DD HH:mm'（与微信 parse-article 同一展示口径） */
function formatCnTime(sec: number): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(sec * 1000))
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function rewriteUuidImages(html: string, images: Map<string, string>): { html: string; urls: string[] } {
  const urls: string[] = []
  const out = html.replace(/<img\s+uuid="([^"]+)"\s*\/?>/g, (whole, uuid: string) => {
    const url = images.get(uuid)
    if (!url) return whole   // 缺映射保留原标签（fetchNoteShow 已给 warning）
    urls.push(url)
    return `<img src="${url}">`
  })
  return { html: out, urls }
}

const REF_URL = (uuid: string) => `https://note.mowen.cn/detail/${uuid}`

/** 引用卡片：blockquote 语义（阅读器原生缩进样式，turndown 转 `> ` 引用块，md 导出标题不丢）。
 *  付费/失败如实标注——标题拿不到就说拿不到，不伪装成功也不留空白。 */
function refCard(m: RefNoteMeta): string {
  const url = REF_URL(m.uuid)
  if (m.state === 'ok') {
    const author = m.authorName ? ` · ${escapeHtml(m.authorName)}` : ''
    const digest = m.digest ? `<p>${escapeHtml(m.digest)}</p>` : ''
    return `<blockquote class="mowen-ref-card"><p><a href="${url}">《${escapeHtml(m.title ?? '')}》</a>${author}</p>${digest}</blockquote>`
  }
  const label = m.state === 'paid' ? '引用付费笔记（标题不可见）' : '引用笔记（标题获取失败）'
  return `<blockquote class="mowen-ref-card"><p>${label}：<a href="${url}">${url}</a></p></blockquote>`
}

/** 正文 <note uuid> 标签替换 + refNoteIds 兜底追加。
 *  - 标签有 meta → 卡片；无 meta（含未拉取/防御场景）→ failed 卡，不留裸标签（阅读器会静默吞掉）
 *  - 正文标签不在 refNoteIds（防御）→ failed 卡 + warning
 *  - refNoteIds 不在正文出现 → 文末追加卡片（旧尾部块的防丢失职责，只补缺的不整块复制） */
function applyRefCards(html: string, refNoteIds: string[], metas: Map<string, RefNoteMeta>, warnings: string[]): string {
  const refSet = new Set(refNoteIds)
  const inBody = (uuid: string) => html.includes(`<note uuid="${uuid}"`)
  let out = html.replace(/<note\s+uuid="([^"]+)"\s*>\s*<\/note>/g, (_whole, uuid: string) => {
    if (!refSet.has(uuid)) warnings.push(`正文引用标签 ${uuid.slice(0, 8)} 不在引用清单（noteRef），按获取失败渲染`)
    return refCard(metas.get(uuid) ?? { uuid, state: 'failed' })
  })
  const missing = refNoteIds.filter((id) => !inBody(id))
  if (missing.length) {
    out += missing.map((id) => refCard(metas.get(id) ?? { uuid: id, state: 'failed' })).join('')
    warnings.push(`${missing.length} 篇引用笔记未在正文出现，已追加至文末`)
  }
  return out
}

export function noteShowToParsedArticle(r: NoteShowResult, refMetas?: Map<string, RefNoteMeta>): ParsedArticle {
  // 封面取正文首图（墨问没有独立封面字段泛用形态，noteCover 实测多为空数组）；
  // exporter 的 cover 分支靠 coverUrl 触发——此前硬编码空串让 --formats cover 成为死参数。
  const { html: withLocalImg, urls } = rewriteUuidImages(r.contentHtml, r.images)

  // 音频嵌入（PRD：不落地，失效即失效）；追加在正文尾部
  let html = withLocalImg
  if (r.audios.length) {
    const audios = r.audios.map((u) => `<p><audio controls src="${u}"></audio></p>`).join('')
    html = html + audios
  }

  // 视频入口（v0.12.2 R1）：正文 <channel-video feed-id> 是微信视频号嵌入（spike 2026-09-30
  // 钉死：note/show 不返回视频数据、没有直链接口），唯一可行解是拼视频号页永久链接。
  // 原地替换为跳转链接段落——此前不认这个标签，视频在正文里静默消失。
  const warnings = [...r.warnings]
  const videoEntries: VideoEntry[] = []
  html = html.replace(/<channel-video\b[^>]*>/g, (whole) => {
    const m = whole.match(/feed-id="([^"]+)"/)
    if (!m) {
      warnings.push('视频标签缺 feed-id，视频入口未生成')
      return '<p>（此处含一个视频，但未能解析出观看入口）</p>'
    }
    const url = `https://channels.weixin.qq.com/${m[1]}`
    videoEntries.push({
      videoId: m[1], formatId: 'channels-embed',
      width: 0, height: 0, filesize: 0, durationMs: 0,
      fallbackUrl: url,
      inline: true,   // 正文原位置已替换为链接段落,导出器不再追加(否则同一视频两个入口)
    })
    return `<p><a href="${url}">▶ 视频号视频（点击去观看）</a></p>`
  })
  html = html.replace(/<\/channel-video>/g, '')
  // 服务端标记有视频但一个入口都没解析出来：如实告警，不静默丢（与图集缺图同策略）
  if (r.hasVideo && !videoEntries.length) {
    warnings.push('服务端标记该笔记含视频（noteFlag.hasVideo），但正文未解析出视频入口')
  }

  if (r.refNoteIds.length) {
    html = applyRefCards(html, r.refNoteIds, refMetas ?? new Map(), warnings)
    warnings.push(`该笔记含 ${r.refNoteIds.length} 篇引用子笔记，正文已内联引用卡片；递归下载子笔记请使用「展开引用子笔记」（CLI --expand-refs）。`)
  } else if (/<note\s+uuid=/.test(r.contentHtml)) {
    // refNoteIds 空但正文有引用标签（防御：接口形态变化）——也不能留裸标签
    html = applyRefCards(html, [], new Map(), warnings)
  }

  return {
    title: r.title,
    author: r.authorName,
    account: r.authorName,   // 目录按作者建（墨问没有「公众号」概念）
    publishTime: r.publicAt != null ? formatCnTime(r.publicAt) : '',
    digest: r.digest,
    coverUrl: urls[0] ?? '',
    contentHtml: html,
    imageUrls: urls,
    videos: videoEntries,
    itemShowType: null,
    warnings,
  }
}

export { isObj }
