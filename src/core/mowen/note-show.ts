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
  /** 服务端视频标记（v0.12.2 R1，detail.noteFlag.hasVideo）：解析器据此判
   *  「标记有视频但没解析出入口」并告警——不静默丢。 */
  hasVideo: boolean
  warnings: string[]
}

export { MowenNoteUnavailable, MowenShowFailed }

export interface NoteShowDeps {
  fetchJson: (url: string, init: { method: 'POST'; body: string; headers: Record<string, string> }) => Promise<{ status: number; text: string }>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

/** note/show 端点。`WXKIT_MOWEN_BASE` 仅供 e2e 把请求指到本地 mock（默认生产域名）。
 *  这里只能用 env 换 base、不能用 Electron 的 webRequest 拦截——本请求走 Node 的 fetch
 *  （defaultFetchJson），不经 Chromium 会话，拦不到。 */
function mowenUrl(path: string): string {
  const base = (process.env.WXKIT_MOWEN_BASE ?? 'https://note.mowen.cn').replace(/\/$/, '')
  return `${base}${path}`
}

/** note/show 的图片池对**图集不保证完整**（真机 2026-09-17：图集声明 3 张、池只给 2 张，
 *  被引子笔记 6ipCTiFtt0yQRXNeSDA1w 实录）。墨问网页端的补法是第二个匿名接口
 *  gallery/infos，POST {noteUuid, gids}，返回 {gids, gallerys, images}——缺的那张的
 *  URL（含 scale.w_1200）在这里。本函数在池缺图时按同款协议补拉。 */
async function fetchGalleryInfos(uuid: string, gids: string[], deps: NoteShowDeps): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const res = await deps.fetchJson(mowenUrl('/api/note/wxa/v1/gallery/infos'), {
    method: 'POST',
    body: JSON.stringify({ noteUuid: uuid, gids }),
    headers: { 'Content-Type': 'application/json' },
  })
  if (res.status !== 200) throw new Error(`gallery/infos HTTP ${res.status}`)
  const json: unknown = JSON.parse(res.text)
  const images = isObj(json) && isObj(json.images) ? json.images : {}
  for (const [k, v] of Object.entries(images)) {
    if (!isObj(v)) continue
    const scale = isObj(v.scale) ? v.scale : {}
    const url = str(scale.w_1200) || str(v.url)
    if (url) out.set(k, url)
  }
  return out
}

export async function fetchNoteShow(uuid: string, deps: NoteShowDeps): Promise<NoteShowResult> {
  const res = await deps.fetchJson(mowenUrl('/api/note/wxa/v1/note/show'), {
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
  const noteFlag = isObj(detail.noteFlag) ? detail.noteFlag : {}
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
  // 图集展开：多图笔记的图片是 <gallery uuid="G"></gallery> 占位（真机 2026-09-13 池建强
  // CatBar 笔记钉死），图片清单在 noteGallery.gallerys[G].fileUuids（有序）。原地展开为
  // <img uuid> 序列，复用下方 uuid 重写/缺映射告警/下载既有链路；gid 无定义则保留原标签 +
  // 告警（与缺映射同策略：不静默丢）。
  const galleries = new Map<string, string[]>()
  const noteGallery = isObj(detail.noteGallery) ? detail.noteGallery : {}
  const gallerys = isObj(noteGallery.gallerys) ? noteGallery.gallerys : {}
  for (const [gid, g] of Object.entries(gallerys)) {
    if (!isObj(g) || !Array.isArray(g.fileUuids)) continue
    galleries.set(gid, g.fileUuids.map(str).filter(Boolean))
  }
  // 图集池缺图 → gallery/infos 补拉（墨问网页端同款两段式；失败退回缺图告警，不炸笔记）
  const galleryMissing = [...galleries.values()].flat().some((f) => !images.has(f))
  if (galleries.size > 0 && galleryMissing) {
    try {
      const extra = await fetchGalleryInfos(uuid, [...galleries.keys()], deps)
      for (const [k, url] of extra) images.set(k, url)
    } catch {
      warnings.push('图集图片补拉失败（gallery/infos），缺图未下载')
    }
  }
  const contentHtml = str(noteBase.content).replace(
    /<gallery\s+uuid="([^"]+)"\s*>\s*<\/gallery>/g,
    (whole, gid: string) => {
      const fileUuids = galleries.get(gid)
      if (!fileUuids) {
        warnings.push(`图集定义缺失（gid=${gid}），图集内容未下载`)
        return whole
      }
      return fileUuids.map((f) => `<img uuid="${f}">`).join('')
    },
  )
  // 正文中的 uuid 缺映射（被删图/风控/图集声明了但池里没有）→ 不炸但要说
  for (const m of contentHtml.matchAll(/<img\s+uuid="([^"]+)"/g)) {
    if (!images.has(m[1])) warnings.push(`图片映射缺失（uuid=${m[1]}），该图未下载`)
  }

  return {
    uuid: str(noteBase.uuid) || uuid,
    title: str(noteBase.title),
    digest: str(noteBase.digest),
    contentHtml,
    publicAt: num(noteBase.publicAt),
    authorUid: str(userBase.uid),
    authorName: str(userBase.name),
    images,
    audios: arrOf(noteFile, 'audios').filter(isObj).map((a) => str(a.url)).filter(Boolean),
    refNoteIds: Array.isArray(detail.noteRef) ? detail.noteRef.map(str).filter(Boolean) : [],
    hasVideo: !!noteFlag.hasVideo,
    warnings,
  }
}
