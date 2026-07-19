// session 跨机器导出/导入(M27):headless 环境无法扫码,登录态从已登录机器搬运。
// 纯文件逻辑、路径全注入,无 electron 运行时,可单测。session 文件即登录凭证——一律 0600。
import { readFile, writeFile } from 'node:fs/promises'
import type { MpSession } from '../../src/core/mp-types'

/** 校验导入内容的最小结构:token 非空字符串 + cookies 数组(每项 name/value 均为字符串)。 */
export function validateSessionShape(raw: unknown): { ok: true; session: MpSession } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '不是 JSON 对象' }
  const o = raw as Record<string, unknown>
  if (typeof o.token !== 'string' || !o.token) return { ok: false, error: '缺少有效 token 字段' }
  if (!Array.isArray(o.cookies)) return { ok: false, error: '缺少 cookies 数组' }
  for (const c of o.cookies) {
    const item = c as Record<string, unknown>
    if (typeof item?.name !== 'string' || typeof item?.value !== 'string') {
      return { ok: false, error: 'cookies 项须为 {name, value} 字符串对' }
    }
  }
  return { ok: true, session: { token: o.token, cookies: o.cookies as MpSession['cookies'], timestamp: typeof o.timestamp === 'number' ? o.timestamp : Date.now() } }
}

/** 把当前 session 文件复制到 outPath(0600)。源不存在即抛错。 */
export async function exportSession(sessionPath: string, outPath: string): Promise<void> {
  const content = await readFile(sessionPath, 'utf-8')
  await writeFile(outPath, content, { mode: 0o600 })
}

/** 读 filePath → 校验结构 → 写入 sessionPath(0600)。非法时抛错、不触碰既有 session。 */
export async function importSession(filePath: string, sessionPath: string): Promise<MpSession> {
  const content = await readFile(filePath, 'utf-8')
  let raw: unknown
  try { raw = JSON.parse(content) } catch { throw new Error('文件不是合法 JSON') }
  const r = validateSessionShape(raw)
  if (!r.ok) throw new Error(`session 结构无效:${r.error}`)
  await writeFile(sessionPath, JSON.stringify(r.session), { mode: 0o600 })
  return r.session
}
