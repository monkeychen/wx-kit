// src/core/paths.ts
const ILLEGAL = /[/\\:*?"<>|]/g

export function sanitizeName(raw: string): string {
  let s = (raw ?? '').replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim()
  if (!s) return 'untitled'
  if (s.length > 80) s = s.slice(0, 80)
  return s
}

export function articleDirName(publishDate: string, title: string): string {
  const t = sanitizeName(title)
  const d = (publishDate ?? '').trim()
  return d ? `${d}_${t}` : t
}

/** 给定基名与"是否已占用"判定，返回未占用的名字（base, base-2, base-3 ...） */
export function dedupeDirName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base
  let i = 2
  while (taken(`${base}-${i}`)) i++
  return `${base}-${i}`
}
