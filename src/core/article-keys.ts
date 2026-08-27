// src/core/article-keys.ts
// 从文章页静态 HTML 的脚本变量里提取身份键（2026-08-26 用真实页面实测存在）：
//   var biz = "MzYzNDg1MDcyNQ=="   —— 公众号 __biz（base64），微信读书 bookId 的编码源
//   var mid = "2247486019"          —— 本次群发 id（文章主键前半）
//   var idx = "1"                   —— 群发内序号（文章主键后半）
// 用途：
//   · 短链无 hint 时补出 mid_idx 判重（手动粘贴与微信读书列表条目两条路都归一到微信主键）
//   · 「粘贴文章链接识别公众号」：biz → base64 解码 → MP_WXS_<数字> bookId
// 空串形态（var mid = ""）真实存在，一律视为缺失。
export interface ArticleKeys {
  biz?: string
  mid?: string
  idx?: string
}

export function extractArticleKeys(html: string): ArticleKeys {
  const keys: ArticleKeys = {}
  const biz = /var\s+biz\s*=\s*"([A-Za-z0-9+/=]+)"/.exec(html)
  if (biz?.[1]) keys.biz = biz[1]
  const mid = /var\s+mid\s*=\s*"(\d+)"/.exec(html)
  if (mid?.[1]) keys.mid = mid[1]
  // 注意锚定 `var idx`：页面里还有 var msg_daily_idx 这类变量，不能误读
  const idx = /var\s+idx\s*=\s*"(\d+)"/.exec(html)
  if (idx?.[1]) keys.idx = idx[1]
  return keys
}
