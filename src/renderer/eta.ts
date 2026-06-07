// src/renderer/eta.ts
/** 用已完成数 + 已耗时估算剩余时间，渲染成中文。未开始/已完成返回空串。 */
export function estimateRemaining(completed: number, total: number, elapsedMs: number): string {
  if (completed <= 0 || completed >= total) return ''
  const perItem = elapsedMs / completed
  const sec = Math.round((perItem * (total - completed)) / 1000)
  if (sec < 60) return `约剩 ${sec} 秒`
  return `约剩 ${Math.floor(sec / 60)} 分 ${sec % 60} 秒`
}
