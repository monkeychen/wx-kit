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

/**
 * 账号标识归一（容错包装）：v0.8.x 下载历史里是 base64 fakeid（如 MzE5ODk2NjUwOA==），
 * v0.10.0 起是 `MP_WXS_<数字>`。同一公众号两种形态会在订阅列表里呈现为「同名重复行」
 * （用户实测踩到），故所有入口统一归一到 MP_WXS_ 形态；无法归一的非法形态原样保留，
 * 不让脏数据炸掉列表。
 * 本函数放在这个零依赖的纯函数模块里，供渲染层直接 import——**别把它挪去任何带
 * node 内建 import 的模块**（如 subscriptions.ts）：渲染层一旦经由那种模块引用它，
 * node:fs 等会被 vite-plugin-electron-renderer 的 CJS shim 摇进渲染 bundle，沙箱页面
 * 无 require 直接 ReferenceError（M56 T4 实录）。base64 分支里的 `Buffer` 在沙箱
 * 渲染层不存在时抛 ReferenceError，会被下面的 catch 接住、按「非法形态」降级原样返回，
 * 不影响模块加载。
 */
export function normalizeAccountKey(fakeid: string): string {
  try { return normalizeAccountId(fakeid) } catch { return fakeid }
}

/** bookId → 数字段（如需给展示层用）。 */
export function digitsOfBookId(bookId: string): string {
  return normalizeAccountId(bookId).slice('MP_WXS_'.length)
}
