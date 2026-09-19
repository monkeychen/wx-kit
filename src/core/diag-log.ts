// src/core/diag-log.ts
// M66 统一诊断日志:纯逻辑(脱敏/格式化/级别过滤)+ 落盘单例(JSON 行、5MB×3 轮转)。
//
// 设计定案(docs/plans/2026-09-19-m66-diag-log.md):
// - 落盘层放 core(零 electron import):埋点最深处在 core 边界(mocli runner),
//   放 electron/services 会被反向 import 违反分层;userData 路径由 GUI/CLI 入口传入。
// - 模块级可选单例:未 init 时 diag() 为 null,埋点一行 null 安全,不给业务签名加参数。
// - 脱敏红线:敏感 key/URL query 参数值 → «redacted:len»,宁可漏记不可泄密。
// - 日志永不拖垮业务:所有 IO 失败 catch 成 console.warn;轮转失败继续写(丢轮转不丢日志)。
// - 写入串行化(进程内 promise 链):并发 appendFile 的行交错保险。
import { mkdir, appendFile, stat, rename, unlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type DiagLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<DiagLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/** 敏感 key 清单(小写比较;命中即整个值打码)。宁多勿漏——漏记一个参数不致命,泄一段 cookie 是事故。 */
const SENSITIVE_KEYS = new Set([
  'cookie', 'wr_skey', 'wr_vid', 'wr_rt', 'token', 'key', 'apikey', 'api_key',
  'auth_key', 'authkey', 'sign', 'signature', 'ticket', 'secret', 'password',
  'passwd', 'authorization', 'access_token', 'refresh_token', 'session',
])

const redactedMarker = (v: string): string => `«redacted:${v.length}»`

const isObjLike = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** URL query 里的敏感参数值打码;路径与其余 query 原样。手工分割而非 URL 类,避免 re-encode 改变原形态。 */
function redactUrlString(url: string): string {
  const qi = url.indexOf('?')
  if (qi < 0) return url
  const hashIdx = url.indexOf('#', qi)
  const query = url.slice(qi + 1, hashIdx < 0 ? undefined : hashIdx)
  const rest = url.slice(0, qi)
  const tail = hashIdx < 0 ? '' : url.slice(hashIdx)
  const parts = query.split('&').map((kv) => {
    const eq = kv.indexOf('=')
    if (eq < 0) return kv
    const k = kv.slice(0, eq)
    const v = kv.slice(eq + 1)
    return SENSITIVE_KEYS.has(k.toLowerCase()) ? `${k}=${redactedMarker(v)}` : kv
  })
  return `${rest}?${parts.join('&')}${tail}`
}

const looksLikeUrl = (v: string): boolean => /^https?:\/\//.test(v)

/** 自由文本内嵌敏感赋值打码(外部进程输出等不可信文本):JSON 字段与 query/kv 两种形态。
 *  起因(2026-09-19 产物验收实录):mocli auth info 的 stdout JSON 里带 api_key 明文,
 *  stdout 首行摘要直接入日志造成泄漏——结构化 redact 管不到字符串内部。 */
const FREE_TEXT_JSON_RE = new RegExp(
  `"(${[...SENSITIVE_KEYS].join('|')})"\\s*:\\s*"([^"]*)"`, 'gi',
)
const FREE_TEXT_KV_RE = new RegExp(
  `\\b(${[...SENSITIVE_KEYS].join('|')})(?![\\w-])=([^\\s&"']+)`, 'gi',
)
const maskWith = (v: string): string => redactedMarker(v)

export function redactFreeText(s: string): string {
  return s
    .replace(FREE_TEXT_JSON_RE, (_m, k: string, v: string) => `"${k}":"${maskWith(v)}"`)
    .replace(FREE_TEXT_KV_RE, (_m, k: string, v: string) => `${k}=${maskWith(v)}`)
}

/** 深度脱敏:敏感 key 的值打码;URL 字符串打码其敏感 query 参数;循环引用环上对象原样返回。 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') {
    return looksLikeUrl(value) ? redactUrlString(value) : value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return value
    seen.add(value)
    return value.map((v) => redact(v, seen))
  }
  if (isObjLike(value)) {
    if (seen.has(value)) return value
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? redactedMarker(String(v)) : redact(v, seen)
    }
    return out
  }
  return value
}

/** 组装一行日志:JSON.stringify 丢弃 undefined 字段,fields 缺省时行内只有公共四键。 */
export function formatLogLine(
  level: DiagLevel, domain: string, event: string,
  fields?: Record<string, unknown>, msg?: string,
): string {
  return JSON.stringify({
    time: new Date().toISOString(),
    level, domain, event,
    ...(fields ? redact(fields) as Record<string, unknown> : undefined),
    ...(msg !== undefined ? { msg } : undefined),
  })
}

export function shouldLog(level: DiagLevel, minLevel: DiagLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel]
}

/** fs 注入面(测试 mock 用;真实默认 node:fs/promises)。 */
export interface DiagFs {
  stat: (p: string) => Promise<{ size: number }>
  rename: (from: string, to: string) => Promise<void>
  unlink: (p: string) => Promise<void>
  mkdir: (p: string, opts: { recursive: boolean }) => Promise<unknown>
  appendFile: (p: string, data: string) => Promise<void>
  readFile: (p: string) => Promise<string>
}

const realFs: DiagFs = {
  stat: async (p) => { const s = await stat(p); return { size: s.size } },
  rename: (f, t) => rename(f, t),
  unlink: (p) => unlink(p),
  mkdir: (p, o) => mkdir(p, o),
  appendFile: (p, d) => appendFile(p, d, 'utf8'),
  readFile: (p) => readFile(p, 'utf8'),
}

export interface DiagLog {
  debug: (domain: string, event: string, fields?: Record<string, unknown>, msg?: string) => void
  info: (domain: string, event: string, fields?: Record<string, unknown>, msg?: string) => void
  warn: (domain: string, event: string, fields?: Record<string, unknown>, msg?: string) => void
  error: (domain: string, event: string, fields?: Record<string, unknown>, msg?: string) => void
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const KEEP = 3   // main / main.1 / main.2

interface Sink {
  log: DiagLog
  chain: Promise<void>
  dir: string
}

let current: Sink | null = null

function createSink(opts: { dir: string; fs: DiagFs; minLevel: DiagLevel; maxBytes: number }): Sink {
  const { dir, fs, minLevel, maxBytes } = opts
  const path = join(dir, 'main.log')
  // 串行链:mkdir 先行,其后 append 逐条排队(行不交错)。chain 存在 sink 上,flush 取最新值。
  const sink: Sink = { log: null as unknown as DiagLog, chain: Promise.resolve(), dir }
  let chain: Promise<void> = fs.mkdir(dir, { recursive: true }).then(() => {}, () => {})

  const rotateBestEffort = async (): Promise<void> => {
    try {
      const s = await fs.stat(path)
      if (s.size <= maxBytes) return
    } catch { /* 文件不存在 → 无需轮转 */ return }
    try { await fs.unlink(join(dir, `main.${KEEP - 1}.log`)) } catch { /* 无旧档可删 */ }
    for (let i = KEEP - 2; i >= 1; i--) {
      try { await fs.rename(join(dir, `main.${i}.log`), join(dir, `main.${i + 1}.log`)) } catch { /* 尽力而为 */ }
    }
    try { await fs.rename(path, join(dir, 'main.1.log')) } catch { /* 轮转失败不丢日志:继续写当前文件 */ }
  }

  const write = (level: DiagLevel, domain: string, event: string, fields?: Record<string, unknown>, msg?: string): void => {
    if (!shouldLog(level, minLevel)) return
    const line = formatLogLine(level, domain, event, fields, msg)
    chain = chain
      .then(() => rotateBestEffort())
      .catch(() => {})
      .then(() => fs.appendFile(path, `${line}\n`))
      .catch((e) => { console.warn(`[diag-log] append failed (ignored): ${e instanceof Error ? e.message : e}`) })
    sink.chain = chain   // flush 取最新链
  }

  sink.log = {
    debug: (d, e, f, m) => write('debug', d, e, f, m),
    info: (d, e, f, m) => write('info', d, e, f, m),
    warn: (d, e, f, m) => write('warn', d, e, f, m),
    error: (d, e, f, m) => write('error', d, e, f, m),
  }
  sink.chain = chain
  sink.dir = dir
  return sink
}

/** 初始化落盘单例(幂等:重复调用返回现有实例)。GUI/CLI 入口各调一次。 */
export function initDiagLog(opts: { dir: string; fs?: DiagFs; minLevel?: DiagLevel; maxBytes?: number }): DiagLog {
  if (current) return current.log
  current = createSink({
    dir: opts.dir,
    fs: opts.fs ?? realFs,
    minLevel: opts.minLevel ?? 'info',
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
  })
  return current.log
}

/** 埋点访问口:未 init 返回 null(测试环境零开销)。 */
export function diag(): DiagLog | null {
  return current?.log ?? null
}

/** 当前日志文件路径(设置页展示/reveal 用);未 init 返回 null。 */
export function diagLogPath(): string | null {
  return current ? join(current.dir, 'main.log') : null
}

/** 等待写入链排空(CLI 进程 app.exit 前必须 flush,否则尾部日志被截断);未 init 是 no-op。 */
export function flushDiagLog(): Promise<void> {
  return current ? current.chain : Promise.resolve()
}

/** 仅测试用:清掉单例,隔离用例。 */
export function resetDiagLogForTest(): void {
  current = null
}
