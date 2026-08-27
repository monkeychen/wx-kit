// src/core/weread/book-id.ts
// 公众号在微信读书里的 bookId 形态是 `MP_WXS_<数字>`。数字段与文章页/长链里的
// `__biz`（base64）互为编码关系，也与 MP 后台时代的 fakeid 同源：
//   MzYzNDg1MDcyNQ== ⇄ 3634850725 ⇄ MP_WXS_3634850725（2026-08-26 用真实文章页实测）
// 老订阅数据（subscriptions.json 里存 base64 fakeid）由此可无损换算，无需迁移文件。
/** base64 解码（容忍缺 padding），结果必须是纯数字（公众号数字 ID），否则抛错。 */
export function digitsFromBiz(biz: string): string {
  const raw = (biz ?? '').trim()
  if (!raw) throw new Error('biz 为空')
  let decoded: string
  try { decoded = Buffer.from(raw, 'base64').toString('utf-8').trim() } catch {
    throw new Error(`biz 不是有效 Base64: ${biz}`)
  }
  if (!/^\d+$/.test(decoded)) throw new Error(`biz 解码结果不是数字公众号 ID: ${decoded}`)
  return decoded
}

/** 数字 ID → `__biz` 形态（带 padding）。 */
export function bizFromDigits(digits: string): string {
  if (!/^\d+$/.test(digits)) throw new Error(`公众号数字 ID 应为纯数字: ${digits}`)
  return Buffer.from(digits, 'utf-8').toString('base64')
}

/**
 * 把「任何历史形态的账号标识」统一成微信读书 bookId（`MP_WXS_<数字>`）：
 *   · 已是 `MP_WXS_<数字>` → 原样
 *   · 纯数字 → 补前缀
 *   · base64 fakeid（老订阅/老下载历史）→ 解码补前缀
 * 非法输入抛错——订阅数据写错形态比报错糟得多。
 */
export function normalizeAccountId(raw: string): string {
  const s = (raw ?? '').trim()
  if (s.startsWith('MP_WXS_')) {
    const digits = s.slice('MP_WXS_'.length)
    if (!/^\d+$/.test(digits)) throw new Error(`bookId 的 MP_WXS_ 后必须是数字: ${s}`)
    return s
  }
  if (/^\d+$/.test(s)) return `MP_WXS_${s}`
  return `MP_WXS_${digitsFromBiz(s)}`
}

/** bookId → 数字段（如需给展示层用）。 */
export function digitsOfBookId(bookId: string): string {
  return normalizeAccountId(bookId).slice('MP_WXS_'.length)
}
