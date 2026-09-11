// src/core/mowen/note-show.ts
// 墨问正文主通道：POST note.mowen.cn/api/note/wxa/v1/note/show（匿名，无凭证）。
// 契约 2026-09-11/12 真机钉死：
// - 200 → {detail:{noteBase{content},noteFile{images{uuid:{url,scale.w_1200}}}|null,...},user.base}
// - 付费/不可见 → HTTP 400 {reason:"ASSET_NOT_FOUND", metadata:{skuId}}
// - 正文图片是 <img uuid="...">（无 src），URL 按 noteFile.images 映射。
// 不走 mp request gateway：保护闸语义只对微信，墨问是独立平台。
import { MowenNoteUnavailable, MowenShowFailed } from './errors'
import { str, num, arrOf } from './json-helpers'

export interface NoteShowResult {
  uuid: string
  title: string
  digest: string
  contentHtml: string        // 原始 content（img 仍是 uuid 形态，重写在 adapter）
  publicAt: number | null    // unix 秒
  authorUid: string
  authorName: string
  images: Map<string, string>  // img uuid → w_1200 签名 URL（约 7 天时效，URL 不入库）
  audios: string[]             // 远程音频 URL（嵌入不落地，PRD 非目标）
  refNoteIds: string[]         // noteRef 引用的子笔记 uuid（合集/引用块，顺序保留）
  warnings: string[]
}

export { MowenNoteUnavailable, MowenShowFailed }

export interface NoteShowDeps {
  fetchJson: (url: string, init: { method: 'POST'; body: string; headers: Record<string, string> }) => Promise<{ status: number; text: string }>
}

const SHOW_URL = 'https://note.mowen.cn/api/note/wxa/v1/note/show'
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

export async function fetchNoteShow(uuid: string, deps: NoteShowDeps): Promise<NoteShowResult> {
  const res = await deps.fetchJson(SHOW_URL, {
    method: 'POST',
    body: JSON.stringify({ uuid }),
    headers: { 'Content-Type': 'application/json' },
  })
  if (res.status !== 200) {
    if (res.status === 400 && res.text.includes('ASSET_NOT_FOUND')) throw new MowenNoteUnavailable()
    throw new MowenShowFailed(res.status, res.text)
  }
  let json: unknown
  try { json = JSON.parse(res.text) } catch {
    throw new MowenShowFailed(200, 'response is not JSON')
  }
  const root = isObj(json) ? json : {}
  const detail = isObj(root.detail) ? root.detail : {}
  const noteBase = isObj(detail.noteBase) ? detail.noteBase : {}
  const user = isObj(root.user) ? root.user : {}
  const userBase = isObj(user.base) ? user.base : {}

  // 图片映射：uuid → scale.w_1200（清晰度与体积平衡，PRD 钉死规格）
  const images = new Map<string, string>()
  const noteFile = detail.noteFile
  const fileImages = isObj(noteFile) && isObj(noteFile.images) ? noteFile.images : {}
  for (const [k, v] of Object.entries(fileImages)) {
    if (!isObj(v)) continue
    const scale = isObj(v.scale) ? v.scale : {}
    const url = str(scale.w_1200) || str(v.url)
    if (url) images.set(k, url)
  }

  const warnings: string[] = []
  // 正文中的 uuid 缺映射（被删图/风控）→ 不炸但要说
  for (const m of str(noteBase.content).matchAll(/<img\s+uuid="([^"]+)"/g)) {
    if (!images.has(m[1])) warnings.push(`图片映射缺失（uuid=${m[1]}），该图未下载`)
  }

  return {
    uuid: str(noteBase.uuid) || uuid,
    title: str(noteBase.title),
    digest: str(noteBase.digest),
    contentHtml: str(noteBase.content),
    publicAt: num(noteBase.publicAt),
    authorUid: str(userBase.uid),
    authorName: str(userBase.name),
    images,
    audios: arrOf(noteFile, 'audios').filter(isObj).map((a) => str(a.url)).filter(Boolean),
    refNoteIds: Array.isArray(detail.noteRef) ? detail.noteRef.map(str).filter(Boolean) : [],
    warnings,
  }
}
