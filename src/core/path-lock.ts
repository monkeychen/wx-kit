// src/core/path-lock.ts
// 按 key（用文件绝对路径）串行化「读-改-写」。模块级而非实例级——因为每个 IPC handler 都新建
// Library/History 实例，实例级锁挡不住跨实例并发；同一文件的并发写会读旧值→各自写→丢更新。
const chains = new Map<string, Promise<unknown>>()

export async function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)          // 不论前一个成功/失败，都接着跑 fn
  const tail = run.catch(() => {})        // 存一个永不 reject 的尾，避免毒化后续
  chains.set(key, tail)
  try {
    return await run
  } finally {
    if (chains.get(key) === tail) chains.delete(key)  // 没有后续排队则清理，避免 Map 无限增长
  }
}
