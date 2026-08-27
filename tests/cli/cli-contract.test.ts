// tests/cli/cli-contract.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdirSync as _mkdirSync, writeFileSync as _writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '../../electron/services/settings'

// mock 掉 electron 绑定的服务，让 runCli 在纯 node 下可测
vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: {
    fromPartition: vi.fn(() => ({
      fetch: vi.fn(),
      cookies: { set: vi.fn(), get: vi.fn(async () => []) },
    })),
  },
}))
vi.mock('../../electron/services/mp-auth', () => ({
  getSession: vi.fn(() => null), startFreshLogin: vi.fn(),
}))

import { runCli } from '../../src/cli'

let stdout = ''
beforeEach(() => {
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdout += s; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('CLI revived private API commands (v0.10.0 weread backend)', () => {
  // 不登录、零网络的契约面：各命令给出可预期的业务响应而不是停用错误
  it('auth-status reports present:false when never logged in', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-rev-cli-'))
    const code = await runCli(['auth-status'], { userDataDir })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, present: false, valid: false })
  })

  it('crawl without login asks for login (exit 2)', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-rev-cli-'))
    const code = await runCli(['crawl', 'MP_WXS_1', '--count', '3'], { userDataDir })
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })

  it('crawl without account id is a usage error', async () => {
    const code = await runCli(['crawl', '--count', '3'])
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
  })

  it('search without --url is a usage error (name search is gone)', async () => {
    const code = await runCli(['search'])
    expect(code).toBe(2)
  })

  it('subscription check-now without login reports no-session (exit 0)', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-rev-cli-'))
    const root = mkdtempSync(join(tmpdir(), 'wxk-rev-lib-'))
    const code = await runCli(['subscription', 'check-now', '--out', root], { userDataDir })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, note: 'no-session' })
  })

  it('subscription digest without login asks for login (exit 2)', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-rev-cli-'))
    const root = mkdtempSync(join(tmpdir(), 'wxk-rev-lib-'))
    const code = await runCli(['subscription', 'digest', '--date', 'today', '--out', root], { userDataDir })
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })

  it('session export without login reports NO_SESSION (exit 1)', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-rev-cli-'))
    const code = await runCli(['session', 'export'], { userDataDir })
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'NO_SESSION' } })
  })

  it('session import rejects legacy mp-session format (zero network)', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-rev-cli-'))
    const legacy = join(userDataDir, 'legacy-session.json')
    writeFileSync(legacy, JSON.stringify({ token: '123', cookies: [{ name: 'a', value: 'b' }], timestamp: 1 }))
    const code = await runCli(['session', 'import', legacy], { userDataDir })
    expect(code).toBe(2)
    expect(JSON.parse(stdout).error.message).toContain('旧版 mp-session.json')
  })

  it('protection status works without login (zero network)', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-rev-cli-'))
    const code = await runCli(['protection', 'status'], { userDataDir })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true })
  })

  it('help shows revived commands, not 停用 markers', async () => {
    const code = await runCli(['help', 'subscription'])
    expect(code).toBe(0)
    expect(stdout).not.toContain('已停用')
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
  it('get returns full settings incl. subscription keys; get <key> returns one', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli-'))
    await runCli(['settings', 'get'], { userDataDir: ud })
    const result = JSON.parse(stdout)
    expect(result).toMatchObject({ ok: true, settings: { libraryRoot: expect.any(String) } })
    // v0.10.0：订阅键复活，settings get 不再隐藏
    expect(result.settings).toHaveProperty('subscriptionScheduleMode')
    stdout = ''
    await runCli(['settings', 'get', 'libraryRoot'], { userDataDir: ud })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, key: 'libraryRoot' })
  })
  it('set writes a valid key and echoes full settings', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli2-'))
    const code = await runCli(['settings', 'set', 'historyRetentionDays', '30'], { userDataDir: ud })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, settings: { historyRetentionDays: 30 } })
  })
  it('subscription settings are readable and writable again (v0.10.0)', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli3-'))
    const service = new SettingsService(ud, '/unused')
    await service.save({ subscriptionIntervalHours: 4 })
    expect(await runCli(['settings', 'get', 'subscriptionIntervalHours'], { userDataDir: ud })).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, key: 'subscriptionIntervalHours', value: 4 })
    stdout = ''
    expect(await runCli(['settings', 'set', 'subscriptionIntervalHours', '8'], { userDataDir: ud })).toBe(0)
    expect((await service.get()).subscriptionIntervalHours).toBe(8)
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

describe('CLI library sort (v0.8.0 R3)', () => {
  // publishTime 刻意与索引顺序、downloadTime、标题序都不一致，才能区分是哪一种排序生效
  const seedSorted = () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-sort-'))
    const art = (id: string, title: string, publishTime: string, downloadTime: string) => ({
      id, title, author: '', account: 'acc', publishTime, sourceUrl: '', digest: '', coverUrl: '',
      downloadTime, formats: ['md'], dir: join(root, 'acc', id),
    })
    writeFileSync(join(root, 'library.json'), JSON.stringify({
      version: 1,
      articles: [
        art('mid', 'B 中', '2026-06-02 10:00', '2026-06-30T00:00:00.000Z'),
        art('old', 'C 旧', '2026-06-01 10:00', '2026-06-10T00:00:00.000Z'),
        art('new', 'A 新', '2026-06-03 10:00', '2026-06-20T00:00:00.000Z'),
        art('none', 'D 无', '', '2026-06-05T00:00:00.000Z'),
      ],
    }))
    return root
  }
  const ids = () => JSON.parse(stdout).items.map((a: { id: string }) => a.id)

  it('list 默认按 publishTime 降序（最近在前），空 publishTime 置末', async () => {
    expect(await runCli(['library', 'list', '--out', seedSorted()])).toBe(0)
    expect(ids()).toEqual(['new', 'mid', 'old', 'none'])
  })

  it('list --order asc 反转，空 publishTime 仍在末尾', async () => {
    expect(await runCli(['library', 'list', '--order', 'asc', '--out', seedSorted()])).toBe(0)
    expect(ids()).toEqual(['old', 'mid', 'new', 'none'])
  })

  // 注意：「空值置末」只针对 publishTime；download 排序下 none 有 downloadTime，照常参与比较
  it('list --sort download 按下载时间，与 publish 序不同', async () => {
    expect(await runCli(['library', 'list', '--sort', 'download', '--out', seedSorted()])).toBe(0)
    expect(ids()).toEqual(['mid', 'new', 'old', 'none'])
  })

  it('list --sort title --order asc 按标题', async () => {
    expect(await runCli(['library', 'list', '--sort', 'title', '--order', 'asc', '--out', seedSorted()])).toBe(0)
    expect(ids()).toEqual(['new', 'mid', 'old', 'none'])
  })

  it('search 同样默认 publishTime 降序，且可与 --account 组合', async () => {
    expect(await runCli(['library', 'search', '', '--account', 'acc', '--out', seedSorted()])).toBe(0)
    expect(ids()).toEqual(['new', 'mid', 'old', 'none'])
  })
})

describe('CLI site sync (v0.8.0 R2)', () => {
  const CONTENT_MD = (title: string) => `---
title: "${title}"
account: "acc"
publishTime: "2026-06-01 09:30"
---
# ${title}

正文。

![](images/img-1.png)
`
  /** 造一个真实形态的库：每篇有 meta 索引 + content.md + 一张图 */
  const seedSite = (articles: Array<{ id: string; title: string; publishTime: string }>) => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-site-lib-'))
    const postsRoot = mkdtempSync(join(tmpdir(), 'wxk-cli-site-posts-'))
    const metas = articles.map(({ id, title, publishTime }) => {
      const dir = join(root, 'acc', id)
      _mkdirSync(join(dir, 'images'), { recursive: true })
      _writeFileSync(join(dir, 'content.md'), CONTENT_MD(title))
      _writeFileSync(join(dir, 'images', 'img-1.png'), 'PNG')
      return { id, title, author: '', account: 'acc', publishTime, sourceUrl: '', digest: '', coverUrl: '', downloadTime: '2026-06-20T00:00:00.000Z', formats: ['md'], dir }
    })
    writeFileSync(join(root, 'library.json'), JSON.stringify({ version: 1, articles: metas }))
    return { root, postsRoot }
  }
  const one = () => seedSite([{ id: 'a1', title: '第一篇', publishTime: '2026-06-01 09:30' }])
  const two = () => seedSite([
    { id: 'a1', title: '第一篇', publishTime: '2026-06-01 09:30' },
    { id: 'a2', title: '第二篇', publishTime: '2026-06-02 09:30' },
  ])

  it('无选料器 → NO_SELECTOR, exit 2', async () => {
    const { root, postsRoot } = one()
    const code = await runCli(['site', 'sync', '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'NO_SELECTOR' } })
  })

  it('单篇 --slug：生成 <date>-<slug>/index.md 与同目录图片，exit 0', async () => {
    const { root, postsRoot } = one()
    const code = await runCli(['site', 'sync', '--ids', 'a1', '--slug', 'first-post', '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, succeeded: 1, failed: 0 })
    const dir = join(postsRoot, '2026-06-01-first-post')
    const md = readFileSync(join(dir, 'index.md'), 'utf-8')
    expect(md).toContain('source: wechat')
    expect(md).toContain('](./img-1.png)')     // 图片摊平为同目录引用
    expect(md).not.toContain('# 第一篇')        // 与 frontmatter title 重复的 H1 已去掉
    expect(readFileSync(join(dir, 'img-1.png'), 'utf-8')).toBe('PNG')
  })

  it('--slugs 按 id 映射（不靠位置对应），批量两篇都落对目录', async () => {
    const { root, postsRoot } = two()
    // 故意让映射顺序与选料顺序相反，位置对应的话就会张冠李戴
    const code = await runCli(['site', 'sync', '--ids', 'a1,a2', '--slugs', 'a2=second,a1=first', '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, succeeded: 2, failed: 0 })
    expect(readFileSync(join(postsRoot, '2026-06-01-first', 'index.md'), 'utf-8')).toContain('第一篇')
    expect(readFileSync(join(postsRoot, '2026-06-02-second', 'index.md'), 'utf-8')).toContain('第二篇')
  })

  it('--slugs-file 每行 "<id> <slug>"，# 注释与空行忽略', async () => {
    const { root, postsRoot } = two()
    const f = join(mkdtempSync(join(tmpdir(), 'wxk-slugs-')), 'slugs.txt')
    writeFileSync(f, '# 注释行\n\na1 first\na2 second\n')
    const code = await runCli(['site', 'sync', '--all', '--slugs-file', f, '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, succeeded: 2 })
  })

  it('--slug 用在多篇上 → CLI_ERROR, exit 2（引导改用 --slugs）', async () => {
    const { root, postsRoot } = two()
    const code = await runCli(['site', 'sync', '--all', '--slug', 'x', '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(2)
    const out = JSON.parse(stdout)
    expect(out).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
    expect(out.error.message).toContain('--slugs')
  })

  it('缺 slug → exit 2，并列出缺哪几篇', async () => {
    const { root, postsRoot } = two()
    const code = await runCli(['site', 'sync', '--all', '--slugs', 'a1=first', '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(2)
    const out = JSON.parse(stdout)
    expect(out).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
    expect(out.error.missing).toEqual([{ id: 'a2', title: '第二篇' }])
  })

  it('非法 slug 不阻断其他篇：部分失败 → exit 1，成功篇照常落盘', async () => {
    const { root, postsRoot } = two()
    const code = await runCli(['site', 'sync', '--all', '--slugs', 'a1=Bad_Slug,a2=second', '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(1)
    const out = JSON.parse(stdout)
    expect(out).toMatchObject({ ok: false, succeeded: 1, failed: 1 })
    expect(readFileSync(join(postsRoot, '2026-06-02-second', 'index.md'), 'utf-8')).toContain('第二篇')
  })

  it('slug 与站点已有目录冲突 → 该篇失败、不覆盖，exit 1', async () => {
    const { root, postsRoot } = one()
    _mkdirSync(join(postsRoot, '2026-05-01-first-post'), { recursive: true })
    _writeFileSync(join(postsRoot, '2026-05-01-first-post', 'index.md'), '原有内容')
    const code = await runCli(['site', 'sync', '--ids', 'a1', '--slug', 'first-post', '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, succeeded: 0, failed: 1 })
    expect(readFileSync(join(postsRoot, '2026-05-01-first-post', 'index.md'), 'utf-8')).toBe('原有内容')
  })

  it('选料结果为空 → NOT_FOUND, exit 1', async () => {
    const { root, postsRoot } = one()
    const code = await runCli(['site', 'sync', '--ids', 'zzz', '--slug', 'x', '--posts-dir', postsRoot, '--out', root])
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('--posts-dir 缺省时回落 settings.siteSyncPostsDir', async () => {
    const { root, postsRoot } = one()
    const ud = mkdtempSync(join(tmpdir(), 'wxk-site-ud-'))
    await new SettingsService(ud, '/unused').save({ siteSyncPostsDir: postsRoot })
    const code = await runCli(['site', 'sync', '--ids', 'a1', '--slug', 'from-settings', '--out', root], { userDataDir: ud })
    expect(code).toBe(0)
    expect(readFileSync(join(postsRoot, '2026-06-01-from-settings', 'index.md'), 'utf-8')).toContain('第一篇')
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
    expect(stdout).toContain('退出码 0=成功 1=业务失败 2=用法错误')
    expect(stdout).toContain('子命令:list / search / remove / rebuild / export')
    expect(stdout).toContain('子命令:get / set')
    expect(stdout).toContain('常用示例')
    expect(stdout).not.toContain('已停用')
    expect(stdout).toContain('search --url')
    expect(stdout).toContain('~/Documents/wx-kit')
  })

  // v0.8.0 R4：agent 从顶层 -h 拿到仓库地址即可自助读 README/issues，子命令 help 不重复
  it('-h 含 GitHub 仓库地址与自助提示', async () => {
    const code = await runCli(['-h'])
    expect(code).toBe(0)
    expect(stdout).toContain('https://github.com/monkeychen/wx-kit')
    expect(stdout).toContain('README')
  })

  it('子命令 help 不含仓库地址（只在顶层给一次）', async () => {
    const code = await runCli(['help', 'library'])
    expect(code).toBe(0)
    expect(stdout).not.toContain('https://github.com/monkeychen/wx-kit')
  })
})

// CLI 的 update 命令**不做联网单测**:它内部 8 秒才超时,而 vitest 默认 5 秒就判失败,
// GitHub 稍慢就必然变红(实测 4 轮里红 1 轮,5009ms)。放宽 vitest 超时只会让套件更慢更飘,
// 而单测套件的价值恰恰在「快且确定」。这一层的实际覆盖:
//   · checkUpdate 的逻辑与全部失败路径 → tests/core/check-update.test.ts(注入 fetch,9 条)
//   · 渠道识别与三段命令               → tests/core/install-channel.test.ts(10 条)
//   · update 已登记 CLI_COMMANDS       → tests/electron/cli-dispatch.test.ts
//   · 真实输出契约                     → 真机跑 `electron . update --check` 验证(见 M37 计划)
describe('CLI version(不联网)', () => {
  it('version 命令不联网 —— 保持原有速度与纯净输出', async () => {
    const code = await runCli(['version'])
    expect(code).toBe(0)
    expect(stdout.trim()).not.toContain('{')   // 纯版本号,不是 JSON
  })
})
