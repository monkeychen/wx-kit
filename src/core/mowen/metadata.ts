// src/core/mowen/metadata.ts
// mocli 发现链路（PRD v0.11.0 R2 发现层 + M60）：搜用户、用户主页清单、自己的笔记清单、当前身份。
// 契约（2026-09-11 真机钉死）：stdout 单行 JSON {code, status, reply|reason|msg}；
// 判定失败以 JSON code 为准（退出码非零也输出 JSON），两者任一非零 → MocliFailed。
import type { MocliRunner, MowenUser, MowenNoteListItem } from './types'
import { MocliFailed } from './errors'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown): boolean => v === true

/** 解析 mocli 输出：JSON code 非 0 → MocliFailed（携带透传的 reason/msg）。
 *  真机实测（M60）：失败时 mocli 把错误 JSON 写到 **stderr**，成功才走 stdout——两个流都要看。 */
export function parseMocliJson(stdout: string, stderr = ''): Record<string, unknown> {
  let json: unknown
  try { json = JSON.parse(stdout) } catch {
    // stdout 不是 JSON → 尝试 stderr（mocli 失败通道）
    try { json = JSON.parse(stderr) } catch {
      throw new MocliFailed('BAD_OUTPUT', 'mocli 输出不是合法 JSON（可能是版本过旧或被外层工具污染）')
    }
  }
  if (!isObj(json)) throw new MocliFailed('BAD_OUTPUT', 'mocli 输出结构异常')
  const code = json.code
  if (code !== 0) {
    throw new MocliFailed(str(json.reason) || 'UNKNOWN', str(json.msg) || `mocli 返回 code=${String(code)}`)
  }
  return json
}

function replyOf(json: Record<string, unknown>): Record<string, unknown> {
  return isObj(json.reply) ? json.reply : {}
}

export async function searchUsers(run: MocliRunner, keyword: string): Promise<MowenUser[]> {
  const r = await run(['user', 'search', '--keyword', keyword])
  const reply = replyOf(parseMocliJson(r.stdout, r.stderr))
  const uids = Array.isArray(reply.uids) ? reply.uids.map(str).filter(Boolean) : []
  const users = isObj(reply.users) ? reply.users : {}
  const out: MowenUser[] = []
  for (const uid of uids) {
    const u = users[uid]
    if (!isObj(u)) continue
    out.push({ uid: str(u.uid) || uid, name: str(u.name), intro: str(u.intro), homeUrl: str(u.home_url) })
  }
  return out
}

function mapNoteItem(id: string, n: Record<string, unknown>): MowenNoteListItem {
  const flag = isObj(n.flag) ? n.flag : {}
  const content = isObj(n.content) ? n.content : {}
  const stat = isObj(n.stat) ? n.stat : {}
  return {
    noteId: str(n.note_id) || id,
    uid: str(n.uid),
    title: str(n.title),
    brief: str(n.brief),
    url: str(n.url),
    publicAt: num(n.public_at),
    withFee: bool(flag.with_fee),
    withImage: bool(flag.with_image),
    withText: bool(flag.with_text),
    wordCount: num(content.word_count),
    viewCount: num(stat.view),
    favorCount: num(stat.favor),
  }
}

/** note_ids 顺序为准映射 notes map → 清单项数组（homepage/mine/search 共用）。 */
export function mapNoteList(reply: Record<string, unknown>): MowenNoteListItem[] {
  const ids = Array.isArray(reply.note_ids) ? reply.note_ids.map(str).filter(Boolean) : []
  const notes = isObj(reply.notes) ? reply.notes : {}
  const out: MowenNoteListItem[] = []
  for (const id of ids) {
    const n = notes[id]
    out.push(isObj(n) ? mapNoteItem(id, n) : { noteId: id, uid: '', title: '', brief: '', url: '', publicAt: null, withFee: false, withImage: false, withText: false, wordCount: null, viewCount: null, favorCount: null })
  }
  return out
}

export interface MowenListOptions {
  filter?: 'all' | 'album' | 'fee' | 'popular'
  mineFilter?: 'priv' | 'fee' | 'pub' | 'cond-pub'
  recent?: string      // 1h / 24h / 3d / 7d / 15d（mocli 侧校验）
  count?: number
}

function listArgs(sub: string, opts: MowenListOptions, useMineFilter: boolean): string[] {
  const args = ['notes', sub]
  const f = useMineFilter ? opts.mineFilter : opts.filter
  if (f && f !== 'all') args.push('--filter', f)
  if (opts.recent) args.push('--recent', opts.recent)
  if (opts.count != null) args.push('--count', String(opts.count))
  return args
}

export async function listUserNotes(run: MocliRunner, uid: string, opts: MowenListOptions = {}): Promise<MowenNoteListItem[]> {
  const r = await run(['notes', 'homepage', '--uid', uid, ...listArgs('homepage', opts, false).slice(2)])
  return mapNoteList(replyOf(parseMocliJson(r.stdout, r.stderr)))
}

export async function listMyNotes(run: MocliRunner, opts: MowenListOptions = {}): Promise<MowenNoteListItem[]> {
  const r = await run(listArgs('mine', opts, true))
  return mapNoteList(replyOf(parseMocliJson(r.stdout, r.stderr)))
}

export async function authInfo(run: MocliRunner): Promise<{ moUid: string }> {
  const r = await run(['auth', 'info'])
  const reply = replyOf(parseMocliJson(r.stdout, r.stderr))
  const auth = isObj(reply.auth) ? reply.auth : {}
  return { moUid: str(auth.mo_uid) }
}
