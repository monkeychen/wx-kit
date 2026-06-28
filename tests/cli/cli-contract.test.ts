// tests/cli/cli-contract.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
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
  it('--help prints usage to stdout, exit 0, no JSON error', async () => {
    const code = await runCli(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('Usage')
    expect(stdout).not.toContain('"ok"')
  })
})
