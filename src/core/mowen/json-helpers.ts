// src/core/mowen/json-helpers.ts
// mocli / note-show 响应解析共用的小工具。metadata.ts 里的同名局部函数逐步收拢到这里。
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
/** 数字或数字字符串 → number（真机实测 publicAt/createdAt 是字符串形态 '1789088785'）。 */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}
export const bool = (v: unknown): boolean => v === true

/** 安全取对象下某键的数组（缺省/类型不符 → 空数组）。 */
export function arrOf(obj: unknown, key: string): unknown[] {
  return isObj(obj) && Array.isArray(obj[key]) ? obj[key] : []
}
