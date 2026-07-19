// tests/cli/cli-contract.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdirSync as _mkdirSync, writeFileSync as _writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '../../electron/services/settings'

// mock 掉 electron 绑定的服务，让 runCli 在纯 node 下可测
vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('../../electron/services/mp-auth', () => ({
  getSession: vi.fn(() => null), clearSession: vi.fn(), login: vi.fn(),
}))

import { runCli } from '../../src/cli'
import * as auth from '../../electron/services/mp-auth'

let stdout = ''
beforeEach(() => {
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdout += s; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  ;(auth.getSession as ReturnType<typeof vi.fn>).mockReturnValue(null)
})

describe('CLI auth gating', () => {
  it('search without session → AUTH_REQUIRED, exit 2', async () => {
    const code = await runCli(['search', '猫笔刀'])
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })

  it('crawl without session → AUTH_REQUIRED, exit 2', async () => {
    const code = await runCli(['crawl', '猫笔刀', '--count', '5'])
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })

  it('auth-status without session → valid:false', async () => {
    const code = await runCli(['auth-status'])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, valid: false })
  })
})

describe('CLI library list', () => {
  it('lists articles from a library root as JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-lib-'))
    mkdirSync(join(root, 'acc'), { recursive: true })
    writeFileSync(join(root, 'library.json'), JSON.stringify({
      version: 1,
      articles: [
        { id: 'x', title: 'T', account: 'acc', publishTime: '', sourceUrl: '', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(root, 'acc') },
      ],
    }))
    const code = await runCli(['library', 'list', '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, items: [{ id: 'x', title: 'T' }] })
  })
})

describe('CLI library rebuild', () => {
  it('rebuilds library.json from meta.json and reports counts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-rebuild-'))
    const art = join(root, 'acc', 'art1'); _mkdirSync(art, { recursive: true })
    _writeFileSync(join(art, 'meta.json'), JSON.stringify({
      id: 'z', title: 'T', author: '', account: 'acc', publishTime: '', sourceUrl: '',
      digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: art,
    }))
    const code = await runCli(['library', 'rebuild', '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, scanned: 1, rebuilt: 1, skipped: 0 })
  })
})

describe('CLI library export', () => {
  const seed = () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-export-'))
    const dir1 = join(root, 'acc', 'a1')
    writeFileSync(join(root, 'library.json'), JSON.stringify({
      version: 1,
      articles: [
        { id: 'a1', title: 'T1', author: 'au', account: 'acc', publishTime: '2026-06-01', sourceUrl: 'https://x/1', digest: '', coverUrl: '', downloadTime: '2026-06-20T00:00:00.000Z', formats: ['md'], dir: dir1 },
        { id: 'a2', title: 'T2', author: 'au', account: 'other', publishTime: '2026-06-02', sourceUrl: 'https://x/2', digest: '', coverUrl: '', downloadTime: '2026-06-21T00:00:00.000Z', formats: ['md'], dir: join(root, 'other', 'a2') },
      ],
    }))
    return { root, dir1 }
  }

  it('exports selected ids as a JSON manifest with contentPath', async () => {
    const { root, dir1 } = seed()
    const code = await runCli(['library', 'export', '--ids', 'a1', '--out', root])
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out).toMatchObject({ ok: true, count: 1 })
    expect(out.articles[0]).toMatchObject({ id: 'a1', title: 'T1', contentPath: join(dir1, 'content.md') })
  })

  it('errors (exit 1) when no selector is given', async () => {
    const { root } = seed()
    const code = await runCli(['library', 'export', '--out', root])
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'NO_SELECTOR' } })
  })
})

describe('CLI library root falls back to settings.libraryRoot', () => {
  it('library list without --out reads settings.libraryRoot', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'wxk-ud-'))
    const lib = mkdtempSync(join(tmpdir(), 'wxk-lib-'))
    await new SettingsService(userData, '/unused').save({ libraryRoot: lib })
    writeFileSync(join(lib, 'library.json'), JSON.stringify({
      version: 1, articles: [{ id: 'k', title: 'K', account: 'a', publishTime: '', sourceUrl: '', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(lib, 'a') }],
    }))
    const code = await runCli(['library', 'list'], { userDataDir: userData })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, items: [{ id: 'k' }] })
  })
})

describe('CLI settings get/set', () => {
  it('get returns full settings; get <key> returns one', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli-'))
    await runCli(['settings', 'get'], { userDataDir: ud })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, settings: { subscriptionScheduleMode: 'daily' } })
    stdout = ''
    await runCli(['settings', 'get', 'subscriptionScheduleMode'], { userDataDir: ud })
    expect(JSON.parse(stdout)).toEqual({ ok: true, key: 'subscriptionScheduleMode', value: 'daily' })
  })
  it('set writes a valid key and echoes full settings', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli2-'))
    const code = await runCli(['settings', 'set', 'subscriptionIntervalHours', '4'], { userDataDir: ud })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, settings: { subscriptionIntervalHours: 4 } })
  })
  it('set rejects invalid key/value with exit 2', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli3-'))
    const code = await runCli(['settings', 'set', 'subscriptionScheduleMode', 'weekly'], { userDataDir: ud })
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
  })
})

describe('CLI library search', () => {
  const seed = () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-search-'))
    writeFileSync(join(root, 'library.json'), JSON.stringify({
      version: 1, articles: [
        { id: 'a1', title: '深度学习入门', account: 'AI', publishTime: '', sourceUrl: '', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(root, 'AI', 'a1') },
        { id: 'a2', title: '红楼梦杂谈', account: '文学', publishTime: '', sourceUrl: '', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(root, '文学', 'a2') },
      ],
    }))
    return root
  }
  it('returns title-matching articles', async () => {
    const code = await runCli(['library', 'search', '学习', '--out', seed()])
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.ok).toBe(true); expect(out.items).toHaveLength(1); expect(out.items[0].id).toBe('a1')
  })
  it('further filters by --account', async () => {
    const root = seed()
    await runCli(['library', 'search', '', '--account', '文学', '--out', root])
    const out = JSON.parse(stdout)
    expect(out.items.map((i: { id: string }) => i.id)).toEqual(['a2'])
  })
})

describe('CLI library remove', () => {
  it('removes by ids and marks history items deleted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-rm-'))
    const dir = join(root, 'AI', 'a1'); mkdirSync(dir, { recursive: true })
    writeFileSync(join(root, 'library.json'), JSON.stringify({
      version: 1, articles: [{ id: 'a1', title: 'T', account: 'AI', publishTime: '', sourceUrl: 'https://x/1', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir }],
    }))
    writeFileSync(join(root, 'history.json'), JSON.stringify({
      version: 1, events: [{ id: 'e1', time: Date.now(), source: { kind: 'url', count: 1 }, formats: ['md'], total: 1, succeeded: 1, skipped: 0, failed: 0, items: [{ id: 'a1', url: 'https://x/1', title: 'T', dir, status: 'ok' }] }],
    }))
    const code = await runCli(['library', 'remove', '--ids', 'a1', '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, removed: 1 })
    const lib = JSON.parse(readFileSync(join(root, 'library.json'), 'utf-8'))
    expect(lib.articles).toHaveLength(0)
    const hist = JSON.parse(readFileSync(join(root, 'history.json'), 'utf-8'))
    expect(hist.events[0].items[0]).toMatchObject({ deleted: true })
  })
  it('errors with exit 2 when --ids missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-rm2-'))
    const code = await runCli(['library', 'remove', '--out', root])
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'NO_SELECTOR' } })
  })
})

describe('CLI subscription list', () => {
  it('lists accounts merged from subscriptions + history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-subs-'))
    writeFileSync(join(root, 'subscriptions.json'), JSON.stringify({
      version: 1, lastRunAt: null, checkLog: [],
      accounts: [{ fakeid: 'f1', nickname: 'A', subscribed: true, watermark: 10, lastCheckedAt: null, newRefs: [] }],
    }))
    const code = await runCli(['subscription', 'list', '--out', root])
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.ok).toBe(true)
    expect(out.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ fakeid: 'f1', subscribed: true })]))
  })
})

describe('CLI subscription check-now', () => {
  it('without session returns ok with note no-session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-chk-'))
    const code = await runCli(['subscription', 'check-now', '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, note: 'no-session', newFound: 0 })
  })
  it('check-now persists no-session entry to subscriptions-check.log under userDataDir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-chk2-'))
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-cli-ud-'))
    const code = await runCli(['subscription', 'check-now', '--out', root], { userDataDir })
    expect(code).toBe(0)
    const logContent = readFileSync(join(userDataDir, 'subscriptions-check.log'), 'utf-8')
    expect(logContent).toContain('no-session')
  })
})

describe('CLI settings get unknown key', () => {
  it('get <unknown-key> → exit 2, CLI_ERROR', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli-unk-'))
    const code = await runCli(['settings', 'get', 'nonExistentKey'], { userDataDir: ud })
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
  })
})

describe('CLI help & version', () => {
  it('--version prints bare version to stdout, exit 0', async () => {
    const code = await runCli(['--version'], { version: '9.9.9' })
    expect(code).toBe(0)
    expect(stdout).toBe('9.9.9\n')
  })
  it('-v is an alias for --version', async () => {
    const code = await runCli(['-v'], { version: '9.9.9' })
    expect(code).toBe(0)
    expect(stdout).toBe('9.9.9\n')
  })
  it('version bareword subcommand prints version to stdout, exit 0', async () => {
    const code = await runCli(['version'], { version: '9.9.9' })
    expect(code).toBe(0)
    expect(stdout).toBe('9.9.9\n')
  })
  it('--help prints usage to stdout, exit 0, no JSON error', async () => {
    const code = await runCli(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('Usage')
    expect(stdout).not.toContain('"ok"')
  })
})

describe('CLI top-level help (M25 R3)', () => {
  it('-h covers dual-mode, output contract, group subcommands, and examples; exit 0', async () => {
    const code = await runCli(['-h'])
    expect(code).toBe(0)
    expect(stdout).toContain('无参启动图形界面')
    expect(stdout).toContain('退出码 0=成功 1=业务失败 2=用法或鉴权错误')
    expect(stdout).toContain('子命令:list / search / remove / rebuild / export')
    expect(stdout).toContain('子命令:list / check-now')
    expect(stdout).toContain('子命令:get / set')
    expect(stdout).toContain('常用示例')
    expect(stdout).toContain('~/Documents/wx-kit')
  })
})

describe('CLI session export/import (M27)', () => {
  it('export without session → NO_SESSION, exit 1', async () => {
    const code = await runCli(['session', 'export'])
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'NO_SESSION' } })
  })

  it('import an invalid file → CLI_ERROR, exit 2', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wxk-sess-cli-'))
    const bad = join(dir, 'bad.json'); writeFileSync(bad, JSON.stringify({ nope: 1 }))
    const code = await runCli(['session', 'import', bad], { userDataDir: dir })
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
  })

  it('import a valid file writes it and probes validity (expired here → valid:false)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wxk-sess-cli2-'))
    const f = join(dir, 'in.json')
    writeFileSync(f, JSON.stringify({ token: '42', cookies: [{ name: 'a', value: 'b' }], timestamp: 1 }))
    const { MpAuthExpired } = await import('../../src/core/mp-errors')
    const mpc = await import('../../src/core/mp-client')
    const spy = vi.spyOn(mpc, 'searchAccount').mockRejectedValue(new MpAuthExpired('expired'))
    const code = await runCli(['session', 'import', f], { userDataDir: dir })
    spy.mockRestore()
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, valid: false })
    expect(JSON.parse(readFileSync(join(dir, 'mp-session.json'), 'utf-8'))).toMatchObject({ token: '42' })
  })
})
