// tests/core/diag-log.test.ts
// M66 统一诊断日志:纯逻辑(redact/format/shouldLog)+ 落盘单例(轮转/幂等/串行)。
// fs 走注入:mock fs 验轮转链,tmpdir 真文件系统验端到端。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  redact, formatLogLine, shouldLog, initDiagLog, diag, diagLogPath, resetDiagLogForTest,
  flushDiagLog, redactFreeText,
  type DiagFs,
} from '../../src/core/diag-log'

const REDACTED = (v: string) => `«redacted:${v.length}»`

describe('redact 脱敏', () => {
  it('敏感 key(含大小写变体/嵌套/数组)值替换为 «redacted:len»,非敏感原样', () => {
    const out = redact({
      cookie: 'wr_skey=abc123',
      WR_SKEY: 'x',   // 大小写不敏感命中 wr_skey(精确名匹配,不做包含匹配——keyboard 含 key 会误伤)
      noteUrlKey: 'keep',   // 非敏感名含敏感子串 → 不误伤
      auth_key: 'zzz',
      nested: { token: 't0', name: '池建强' },
      list: [{ api_key: 'k0' }, { note_id: 'n1' }],
      formats: ['md', 'html'],
    }) as Record<string, unknown>
    expect(out.cookie).toBe(REDACTED('wr_skey=abc123'))
    expect(out.WR_SKEY).toBe(REDACTED('x'))
    expect(out.noteUrlKey).toBe('keep')
    expect(out.auth_key).toBe(REDACTED('zzz'))
    expect((out.nested as Record<string, unknown>).token).toBe(REDACTED('t0'))
    expect((out.nested as Record<string, unknown>).name).toBe('池建强')
    expect((out.list as Record<string, unknown>[])[0].api_key).toBe(REDACTED('k0'))
    expect((out.list as Record<string, unknown>[])[1].note_id).toBe('n1')
    expect(out.formats).toEqual(['md', 'html'])
  })
  it('URL 字符串:query 敏感参数打码,普通参数与路径保留', () => {
    const out = redact({
      url: 'https://weread.qq.com/api/mp/articles?auth_key=SECRET&count=20#frag',
    }) as Record<string, unknown>
    expect(out.url).toBe('https://weread.qq.com/api/mp/articles?auth_key=' + REDACTED('SECRET') + '&count=20#frag')
  })
  it('循环引用不爆栈(环上对象原样保留)', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    const out = redact({ a, token: 'tk' }) as Record<string, unknown>
    expect(out.token).toBe(REDACTED('tk'))
    expect((out.a as Record<string, unknown>).name).toBe('a')
  })
  it('非敏感 URL 整体原样;非对象标量原样', () => {
    expect(redact({ url: 'https://note.mowen.cn/detail/abc?from=mocli', n: 3, b: true }))
      .toEqual({ url: 'https://note.mowen.cn/detail/abc?from=mocli', n: 3, b: true })
  })
})

describe('formatLogLine / shouldLog', () => {
  it('一行合法 JSON:{time,level,domain,event,msg,...fields}', () => {
    const line = formatLogLine('info', 'mocli', 'exit', { code: 0, ms: 12 }, 'ok')
    const j = JSON.parse(line)
    expect(j.level).toBe('info'); expect(j.domain).toBe('mocli'); expect(j.event).toBe('exit')
    expect(j.msg).toBe('ok'); expect(j.code).toBe(0); expect(j.ms).toBe(12)
    expect(typeof j.time).toBe('string')
  })
  it('fields 缺省不展开,不产生 undefined 字段', () => {
    const j = JSON.parse(formatLogLine('warn', 'subs', 'skip'))
    expect(j).toEqual({ time: j.time, level: 'warn', domain: 'subs', event: 'skip' })
  })
  it('level 过滤:debug<info<warn<error', () => {
    expect(shouldLog('debug', 'info')).toBe(false)
    expect(shouldLog('info', 'info')).toBe(true)
    expect(shouldLog('error', 'info')).toBe(true)
  })
})

/** mock fs:内存文件表,可注入任意尺寸/异常。 */
function mockFs(files: Record<string, string> = {}, sizeOf: (p: string) => number = () => 0): { fs: DiagFs } {
  return {
    fs: {
      stat: async (p: string) => ({ size: sizeOf(p) }),
      rename: async (from: string, to: string) => { files[to] = files[from] ?? ''; delete files[from] },
      unlink: async (p: string) => { delete files[p] },
      mkdir: async () => {},
      appendFile: async (p: string, data: string) => { files[p] = (files[p] ?? '') + data },
      readFile: async (p: string) => files[p] ?? '',
    },
  }
}

describe('initDiagLog 单例', () => {
  beforeEach(() => resetDiagLogForTest())
  afterEach(() => resetDiagLogForTest())

  it('未 init:diag() 为 null、diagLogPath() 为 null,埋点 null 安全', () => {
    expect(diag()).toBeNull()
    expect(diagLogPath()).toBeNull()
  })
  it('幂等:重复 init 返回同一实例,不重建', () => {
    const { fs } = mockFs()
    initDiagLog({ dir: '/tmp/x', fs })
    const a = diag()
    initDiagLog({ dir: '/tmp/y', fs })
    expect(diag()).toBe(a)
  })
  it('info 落一行合法 JSON;debug 被 minLevel=info 拒', async () => {
    const { fs } = mockFs()
    initDiagLog({ dir: '/tmp/x', fs })
    diag()!.info('mocli', 'exit', { code: 0 }, 'ok')
    diag()!.debug('mocli', 'noise')
    await flushDiagLog()
    const written = await fs.readFile('/tmp/x/main.log')
    const lines = written.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).event).toBe('exit')
  })
  it('轮转:超 maxBytes 触发 rename 链(main.2 删、main.1→main.2、main→main.1)', async () => {
    const { fs } = mockFs(
      { '/d/main.log': 'old-cur', '/d/main.1.log': 'old-1', '/d/main.2.log': 'old-2' },
      (p) => (p === '/d/main.log' ? 6_000_000 : 0),
    )
    initDiagLog({ dir: '/d', fs, maxBytes: 5_000_000 })
    diag()!.info('startup', 'snapshot')
    await flushDiagLog()
    // 链位移后新行写进全新的 main.log
    expect(await fs.readFile('/d/main.2.log')).toBe('old-1')
    expect(await fs.readFile('/d/main.1.log')).toBe('old-cur')
    expect((await fs.readFile('/d/main.log')).includes('snapshot')).toBe(true)
  })
  it('轮转 rename 抛错不吞写入(继续 appendFile 当前文件)', async () => {
    const files: Record<string, string> = { '/d/main.log': 'x' }
    let renameCalls = 0
    const fs: DiagFs = {
      stat: async () => ({ size: 6_000_000 }),
      rename: async () => { renameCalls++; throw new Error('ebusy') },
      unlink: async () => {},
      mkdir: async () => {},
      appendFile: async (p, d) => { files[p] = (files[p] ?? '') + d },
      readFile: async (p) => files[p] ?? '',
    }
    initDiagLog({ dir: '/d', fs, maxBytes: 5_000_000 })
    diag()!.info('startup', 'snapshot')
    await flushDiagLog()
    expect(renameCalls).toBeGreaterThan(0)
    expect(files['/d/main.log'].includes('snapshot')).toBe(true)
  })
  it('appendFile 抛错不外泄(埋点永不拖垮业务)', async () => {
    const fs: DiagFs = {
      stat: async () => ({ size: 0 }),
      rename: async () => {}, unlink: async () => {}, mkdir: async () => {},
      appendFile: async () => { throw new Error('disk full') },
      readFile: async () => '',
    }
    initDiagLog({ dir: '/d', fs })
    expect(() => diag()!.error('download', 'fail', {}, 'x')).not.toThrow()
    await flushDiagLog()
  })
})

describe('端到端(tmpdir 真 fs)', () => {
  afterEach(() => resetDiagLogForTest())

  it('init 后写 3 行,读回逐行合法 JSON 且字段齐全;diagLogPath 指向 main.log', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diag-'))
    try {
      initDiagLog({ dir })
      const log = diag()!
      log.info('startup', 'snapshot', { platform: 'darwin', PATH: '/usr/bin:/bin' }, 'boot')
      log.warn('mocli', 'not-found', { bin: 'mocli' })
      log.error('download', 'fail', { url: 'https://mp.weixin.qq.com/s/abc' })
      await flushDiagLog()
      expect(diagLogPath()).toBe(join(dir, 'main.log'))
      const raw = await readFile(join(dir, 'main.log'), 'utf8')
      const lines = raw.trim().split('\n')
      expect(lines).toHaveLength(3)
      for (const l of lines) expect(() => JSON.parse(l)).not.toThrow()
      expect(JSON.parse(lines[0]).PATH).toBe('/usr/bin:/bin')
      // 真 fs 上轮转文件尺寸由 stat 提供:写小量不触发轮转
      expect((await stat(join(dir, 'main.log'))).size).toBeGreaterThan(0)
    } finally {
      resetDiagLogForTest()
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('轮转后旧文件保留、新文件从当前行开始(真 fs)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diag-rot-'))
    try {
      initDiagLog({ dir, maxBytes: 200 })
      const log = diag()!
      for (let i = 0; i < 30; i++) log.info('stress', 'line', { i })
      await flushDiagLog()
      const cur = await readFile(join(dir, 'main.log'), 'utf8')
      const old1 = await readFile(join(dir, 'main.1.log'), 'utf8')
      expect(cur.trim().split('\n').length).toBeGreaterThan(0)
      expect(old1.trim().split('\n').length).toBeGreaterThan(0)
      // 每行仍合法
      for (const l of [...cur.trim().split('\n'), ...old1.trim().split('\n')]) expect(() => JSON.parse(l)).not.toThrow()
    } finally {
      resetDiagLogForTest()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// 防 tree-shake 误报:writeFile 仅在 mock 场景外未用,显式引用保持 import 有意义
void writeFile

describe('flushDiagLog(进程退出前截断防护)', () => {
  afterEach(() => resetDiagLogForTest())

  it('flush 后所有已排队行必然已落盘;未 init 时 flush 是 no-op', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diag-flush-'))
    try {
      await flushDiagLog()   // 未 init 不抛
      initDiagLog({ dir })
      for (let i = 0; i < 50; i++) diag()!.info('flush', 'line', { i })
      await flushDiagLog()
      const lines = (await readFile(join(dir, 'main.log'), 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(50)
    } finally {
      resetDiagLogForTest()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('redactFreeText(外部进程输出等不可信文本的内嵌打码)', () => {
  it('JSON 形态敏感字段值打码——mocli stdout 泄漏实录的防线', () => {
    const raw = '{"code":0,"status":"OK","reply":{"auth":{"api_key":"MQ4Qz4IBOWP1234ACE5q47opaE","mo_uid":"u1"},'
    expect(redactFreeText(raw)).toBe('{"code":0,"status":"OK","reply":{"auth":{"api_key":"«redacted:26»","mo_uid":"u1"},')
  })
  it('query 形态与 key=value 形态打码;普通文本(错误消息)原样', () => {
    expect(redactFreeText('fetch https://x.cn/a?auth_key=SECRET&n=1 ok'))
      .toBe('fetch https://x.cn/a?auth_key=«redacted:6»&n=1 ok')
    expect(redactFreeText('env: node: No such file or directory')).toBe('env: node: No such file or directory')
    expect(redactFreeText('token=abc123 header')).toBe('token=«redacted:6» header')
  })
})
