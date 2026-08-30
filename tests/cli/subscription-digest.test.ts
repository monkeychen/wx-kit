import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Subscriptions } from '../../src/core/subscriptions'
import { Library } from '../../src/core/library'
import { SettingsService } from '../../electron/services/settings'

const network = vi.hoisted(() => ({ factory: vi.fn(), cover: vi.fn(), html: vi.fn(), binary: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: vi.fn() } }))
vi.mock('../../electron/services/mp-runtime', async (original) => ({
  ...await original<typeof import('../../electron/services/mp-runtime')>(),
  createMpRuntime: (...args: unknown[]) => {
    network.factory(...args)
    return { requestWereadJson: network.cover, fetchText: network.html, fetchBinary: network.binary }
  },
}))
import { runCli } from '../../src/cli'

let root: string, userDataDir: string, stdout: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wxkit-digest-lib-'))
  userDataDir = await mkdtemp(join(tmpdir(), 'wxkit-digest-user-'))
  stdout = ''
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-30T03:00:00Z'))
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  for (const mock of Object.values(network)) mock.mockReset()
  network.cover.mockImplementation(async (_kind, raw) => {
    const url = new URL(raw)
    if (url.pathname !== '/api/mp/cover') throw new Error('不允许列表探测')
    const bookId = url.searchParams.get('bookId')
    return { reviewId: `${bookId}_token~one`, title: '新文章' }
  })
  network.html.mockImplementation(async (_kind, url) => url.includes('~') ? '<html>无效短链</html>' : html('2026-08-30 10:00'))
  const subs = new Subscriptions(root)
  await subs.addAccount({ fakeid: 'MP_WXS_1', nickname: '测试号', subscribed: true, watermark: 123 })
  await subs.addAccount({ fakeid: 'MP_WXS_2', nickname: '其它号', subscribed: true, watermark: 456 })
  await subs.addNewRefs('MP_WXS_1', [{ title: '待处理旧文', url: 'https://mp.weixin.qq.com/s/pending', createTime: 123 }])
})
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
  await rm(userDataDir, { recursive: true, force: true })
})
const html = (date: string) => `<html><body><h1 id="activity-name">新文章</h1><span id="js_name">测试号</span><em id="publish_time">${date}</em><div id="js_content">正文</div></body></html>`
async function seed(id: string, publishTime: string) {
  const dir = join(root, id)
  await mkdir(dir)
  await writeFile(join(dir, 'content.md'), '正文')
  await new Library(root).add({ id, title: id, account: '测试号', author: '', publishTime,
    downloadTime: '2026-08-30T03:00:00Z', sourceUrl: `https://mp.weixin.qq.com/s/${id}`,
    formats: ['md'], dir, digest: '', coverUrl: '' })
}
async function credentials() {
  await writeFile(join(userDataDir, 'weread-creds.json'), JSON.stringify({ vid: '7', accessToken: 'AT', refreshToken: 'RT', updatedAt: 0 }))
}
async function run(...args: string[]) {
  stdout = ''
  const code = await runCli(['subscription', 'digest', '--out', root, ...args], { userDataDir })
  return { code, result: JSON.parse(stdout) }
}

describe('digest CLI 契约', () => {
  it.each(['today', '2026-08-29'])('无凭据查询 %s 零网络且数据文件不变', async (date) => {
    await seed('today', '2026-08-30 08:00')
    await seed('yesterday', '2026-08-29 08:00')
    await seed('unknown', '')
    const paths = ['library.json', 'subscriptions.json']
    const before = await Promise.all(paths.map((p) => readFile(join(root, p), 'utf8')))
    const { code, result } = await run('--date', date, '--accounts', 'MP_WXS_1')
    expect(code).toBe(0)
    expect(result.articles.map((a: { id: string }) => a.id)).toEqual([date === 'today' ? 'today' : 'yesterday'])
    expect(result.unknownPublishTimeCount).toBe(1)
    expect(result.articles[0].contentPath).toContain('content.md')
    expect(network.factory).not.toHaveBeenCalled()
    expect(await Promise.all(paths.map((p) => readFile(join(root, p), 'utf8')))).toEqual(before)
    expect(await readdir(userDataDir)).toEqual([])
    expect((await readdir(root)).includes('subscription-articles.json')).toBe(false)
  })
  it.each(['yesterday', '2026-08-29', '2026-08-31'])('非今天 %s 的下载请求在凭据和网络前拒绝', async (date) => {
    const { code, result } = await run('--date', date, '--download')
    expect(code).toBe(2)
    expect(result.error.code).toBe('DOWNLOAD_TODAY_ONLY')
    expect(network.factory).not.toHaveBeenCalled()
  })
  it('仅显式下载需要登录', async () => {
    const { code, result } = await run('--date', 'today', '--download')
    expect(code).toBe(2)
    expect(result.error.code).toBe('AUTH_REQUIRED')
    expect(network.factory).not.toHaveBeenCalled()
  })
  it.each(['notify', 'download'] as const)('显式刷新不受 %s 策略影响，重读文库并跳过已保存的替代短链', async (policy) => {
    await credentials()
    const settings = new SettingsService(userDataDir, root)
    await settings.save({ subscriptionNewArticleAction: policy, subscriptionAutoCheck: true, defaultFormats: ['md', 'meta'] })
    const before = await readFile(join(root, 'subscriptions.json'), 'utf8')
    const settingsBefore = await readFile(join(userDataDir, 'settings.json'), 'utf8')
    const first = await run('--date', '2026-08-30', '--download', '--accounts', 'MP_WXS_1', '--no-video')
    expect(first.code).toBe(0)
    expect(first.result.count).toBe(1)
    expect(first.result.articles[0]).toMatchObject({ downloaded: true, title: '新文章' })
    expect(await readFile(first.result.articles[0].contentPath, 'utf8')).toContain('正文')
    expect(new URL(network.cover.mock.calls[0][1]).searchParams.get('bookId')).toBe('MP_WXS_1')
    expect(network.cover).toHaveBeenCalledTimes(1)
    const pageCalls = network.html.mock.calls.length
    const second = await run('--date', 'today', '--download', '--accounts', 'MP_WXS_1')
    expect(second.result.count).toBe(1)
    expect(network.html).toHaveBeenCalledTimes(pageCalls)
    expect(await readFile(join(root, 'subscriptions.json'), 'utf8')).toBe(before)
    expect(await readFile(join(userDataDir, 'settings.json'), 'utf8')).toBe(settingsBefore)
  })
  it('最新 cover 是昨天的文章时可下载，但不进入今天清单', async () => {
    await credentials()
    network.html.mockResolvedValue(html('2026-08-29 08:00'))
    const today = await run('--date', 'today', '--download', '--accounts', 'MP_WXS_1', '--formats', 'md,meta')
    expect(today.result.count).toBe(0)
    expect((await new Library(root).list())).toHaveLength(1)
    const past = await run('--date', 'yesterday')
    expect(past.result.count).toBe(1)
  })
  it('刷新失败保留本地清单，并返回失败退出码', async () => {
    await seed('cached', '2026-08-30 08:00')
    await credentials()
    network.cover.mockRejectedValue(new Error('连接失败'))
    const { code, result } = await run('--date', 'today', '--download')
    expect(code).toBe(1)
    expect(result).toMatchObject({ ok: false, count: 1 })
    expect(result.failures).toHaveLength(2)
  })
  it('HTTP 429 后不再访问剩余账号', async () => {
    await credentials()
    network.cover.mockRejectedValue(Object.assign(new Error('请求受限'), { status: 429 }))
    const { code, result } = await run('--date', 'today', '--download')
    expect(code).toBe(1)
    expect(network.cover).toHaveBeenCalledTimes(1)
    expect(result.failures).toHaveLength(2)
  })
  it('正文下载 HTTP 429 后同样停止后续账号刷新', async () => {
    await credentials()
    network.html.mockRejectedValue(Object.assign(new Error('正文请求受限'), { status: 429 }))
    const { code, result } = await run('--date', 'today', '--download')
    expect(code).toBe(1)
    expect(network.cover).toHaveBeenCalledTimes(1)
    expect(result.failures[1].code).toBe('NOT_ATTEMPTED')
  })
  it('登录态错误不得被当成零篇新文章', async () => {
    await credentials()
    network.cover.mockResolvedValue({ errCode: -2012, errMsg: 'expired' })
    const { code, result } = await run('--date', 'today', '--download')
    expect(code).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.failures[0].code).toBe('AUTH_REQUIRED')
    expect(network.cover).toHaveBeenCalledTimes(1)
  })
  it.each([401, 403])('cover HTTP %s 中止后续账号且错误输出不泄漏内部订阅状态', async (status) => {
    await credentials()
    network.cover.mockRejectedValue(Object.assign(new Error('登录失效'), { status }))
    const { code, result } = await run('--date', 'today', '--download')
    expect(code).toBe(1)
    expect(network.cover).toHaveBeenCalledTimes(1)
    expect(result.failures[0]).toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(result.failures[0]).not.toHaveProperty('newRefs')
    expect(result.failures[0]).not.toHaveProperty('watermark')
  })
  it('单账号图片 HTTP 429 必须报告失败，不能被媒体容错吞成成功', async () => {
    await credentials()
    network.html.mockResolvedValue(html('2026-08-30 10:00').replace('正文', '正文<img data-src="https://mmbiz.qpic.cn/image" />'))
    network.binary.mockRejectedValue(Object.assign(new Error('图片请求受限'), { status: 429 }))
    const { code, result } = await run('--date', 'today', '--download', '--accounts', 'MP_WXS_1', '--formats', 'md,meta')
    expect(code).toBe(1)
    expect(result.failures[0].code).toBe('RATE_LIMITED')
  })
  it('替代短链触发请求保护后不能继续刷新其它账号', async () => {
    await credentials()
    network.html.mockImplementation(async (_kind, url) => {
      if (url.includes('~')) return '<html>无效短链</html>'
      throw Object.assign(new Error('已暂停请求'), { code: 'MP_GOVERNOR_PAUSED' })
    })
    const { code, result } = await run('--date', 'today', '--download')
    expect(code).toBe(1)
    expect(network.cover).toHaveBeenCalledTimes(1)
    expect(result.failures[0].code).toBe('MP_GOVERNOR_PAUSED')
  })
  it('公众号改名后使用稳定账号身份查询刚下载的文章', async () => {
    await credentials()
    network.html.mockResolvedValue(html('2026-08-30 10:00').replace('测试号', '改名后的号'))
    const { code, result } = await run('--date', 'today', '--download', '--accounts', 'MP_WXS_1', '--formats', 'md,meta')
    expect(code).toBe(0)
    expect(result.count).toBe(1)
    const stored = (await new Library(root).list())[0]
    expect(stored.accountId).toBe('MP_WXS_1')
    expect(JSON.parse(await readFile(join(stored.dir, 'meta.json'), 'utf8')).accountId).toBe('MP_WXS_1')
  })
})
