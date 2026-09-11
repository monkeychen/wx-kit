// src/core/mowen/mowen-to-article.ts
// note/show 结果 → wx-kit 统一的 ParsedArticle（进 exporter/阅读器/文库的同一条路）。
// 图片：<img uuid> 无 src（真机钉死），按 noteFile.images 映射重写为 w_1200 签名 URL；
// 后续「下载→重写→落盘」复用 exporter 既有链路（buildImageMap/rewriteImageRefs）。
// 合集引用：refNoteIds 非空时尾部追加「引用笔记」块（防信息丢失）；父响应里没有子标题，
// 链接文案用 uuid 前 8 位占位——不为标题对每条引用加 note/show 往返。
import type { ParsedArticle } from '../types'
import type { NoteShowResult } from './note-show'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

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

function buildRefsBlock(refNoteIds: string[]): string {
  const items = refNoteIds.map((id) => {
    const short = id.slice(0, 8)
    return `<li>引用笔记 · ${short} · <a href="https://note.mowen.cn/detail/${id}">note.mowen.cn/detail/${short}…</a></li>`
  }).join('')
  return `<section class="mowen-refs"><p><strong>引用笔记（${refNoteIds.length} 篇）</strong></p><ul>${items}</ul></section>`
}

export function noteShowToParsedArticle(r: NoteShowResult): ParsedArticle {
  const { html: withLocalImg, urls } = rewriteUuidImages(r.contentHtml, r.images)

  // 音频嵌入（PRD：不落地，失效即失效）；追加在正文尾部
  let html = withLocalImg
  if (r.audios.length) {
    const audios = r.audios.map((u) => `<p><audio controls src="${u}"></audio></p>`).join('')
    html = html + audios
  }

  const warnings = [...r.warnings]
  if (r.refNoteIds.length) {
    html = html + buildRefsBlock(r.refNoteIds)
    warnings.push(`该笔记含 ${r.refNoteIds.length} 篇引用子笔记；正文尾部已附引用链接。递归下载子笔记请使用「展开引用子笔记」（CLI --expand-refs）。`)
  }

  return {
    title: r.title,
    author: r.authorName,
    account: r.authorName,   // 目录按作者建（墨问没有「公众号」概念）
    publishTime: r.publicAt != null ? formatCnTime(r.publicAt) : '',
    digest: r.digest,
    coverUrl: '',
    contentHtml: html,
    imageUrls: urls,
    videos: [],
    itemShowType: null,
    warnings,
  }
}

export { isObj }
