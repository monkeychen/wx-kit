// src/core/mowen/url.ts
// 墨问笔记地址识别（PRD v0.11.0 R2b）。纯函数，本里程碑只做识别；
// download-article 的 mowen 分支接线随 M61 正文通道一起落，避免半成品中间态。

// noteId 实测 20–24 位，但 noteRef 的子笔记 uuid 有 25 位形态（M61 真机），上限留到 32：
// 只排除「肉眼可辨的过短串」；完整 URL 侧另有 /detail/ 段校验兜底。
const NOTE_ID_RE = /^[A-Za-z0-9_-]{20,32}$/

/** 是否墨问笔记详情页 URL（note.mowen.cn/detail/<id>）。 */
export function isMowenNoteUrl(input: string): boolean {
  return extractMowenNoteId(input) !== null && input.includes('://')
}

/**
 * 从「完整详情页 URL（带/不带 query）」或「裸 noteId」提取笔记 id。
 * 其余输入（微信 URL、用户主页、过短 id、空串）→ null。
 */
export function extractMowenNoteId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (s.includes('://')) {
    try {
      const u = new URL(s)
      if (u.hostname !== 'note.mowen.cn') return null
      // 必须是 /detail/<id>；/user/<uid> 的 uid 同为 20+ 位字母数字，只看末段会误伤
      const segs = u.pathname.split('/').filter(Boolean)
      if (segs.length !== 2 || segs[0] !== 'detail') return null
      return NOTE_ID_RE.test(segs[1]) ? segs[1] : null
    } catch { return null }
  }
  return NOTE_ID_RE.test(s) ? s : null
}

/** 裸 noteId 归一为详情页 URL（下载记录 sourceUrl 的统一形态）。 */
export function normalizeMowenUrl(input: string): string | null {
  const id = extractMowenNoteId(input)
  return id ? `https://note.mowen.cn/detail/${id}` : null
}
