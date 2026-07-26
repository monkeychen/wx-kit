// tests/core/check-update.test.ts
import { describe, it, expect } from 'vitest'
import { checkUpdate } from '../../src/core/check-update'

// 真实 releases/latest 的形状(2026-07-26 实测裁剪)
const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.9.0', draft: false, prerelease: false,
  published_at: '2026-07-22T08:00:17Z',
  body: '# wx-kit v0.9.0\n\n## 修复\n- 某处',
  assets: [
    { name: 'wx-kit-0.9.0-arm64.dmg', browser_download_url: 'https://github.com/x/arm64.dmg', size: 139623096 },
    { name: 'wx-kit-0.9.0.dmg', browser_download_url: 'https://github.com/x/x64.dmg', size: 141580236 },
    { name: 'wx-kit.Setup.0.9.0.exe', browser_download_url: 'https://github.com/x/setup.exe', size: 114737480 },
  ],
  ...over,
})

describe('checkUpdate', () => {
  it('有新版:带出版本号、发布说明与三平台资产', async () => {
    const r = await checkUpdate('0.8.1', { fetchJson: async () => release() })
    expect(r).toMatchObject({ current: '0.8.1', latest: '0.9.0', hasUpdate: true })
    expect(r!.notes).toContain('修复')
    expect(r!.assets.map((a) => a.name)).toEqual([
      'wx-kit-0.9.0-arm64.dmg', 'wx-kit-0.9.0.dmg', 'wx-kit.Setup.0.9.0.exe',
    ])
  })

  it('已是最新:hasUpdate false,但仍返回 latest(设置页要显示「已是最新 vX」)', async () => {
    const r = await checkUpdate('0.9.0', { fetchJson: async () => release() })
    expect(r).toMatchObject({ hasUpdate: false, latest: '0.9.0' })
  })

  it('本地版本更高(开发中)也不提示更新', async () => {
    const r = await checkUpdate('0.10.0', { fetchJson: async () => release() })
    expect(r!.hasUpdate).toBe(false)
  })

  it('草稿与预发布视为无更新 —— 草稿可能是附件还没传完的半成品', async () => {
    expect(await checkUpdate('0.8.1', { fetchJson: async () => release({ draft: true }) })).toBeNull()
    expect(await checkUpdate('0.8.1', { fetchJson: async () => release({ prerelease: true }) })).toBeNull()
  })

  it('任何失败都返回 null 而不抛 —— 启动静默检查不能因断网炸出错误', async () => {
    expect(await checkUpdate('0.8.1', { fetchJson: async () => { throw new Error('ENOTFOUND') } })).toBeNull()
    expect(await checkUpdate('0.8.1', { fetchJson: async () => ({}) })).toBeNull()          // 缺 tag_name
    expect(await checkUpdate('0.8.1', { fetchJson: async () => null })).toBeNull()
  })

  it('超时返回 null(不会一直挂着)', async () => {
    const hang = (_u: string, init?: { signal?: AbortSignal }) => new Promise<unknown>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))
    })
    const r = await checkUpdate('0.8.1', { fetchJson: hang, timeoutMs: 30 })
    expect(r).toBeNull()
  })

  it('资产里缺 url 的条目被剔除(不给出点不开的下载)', async () => {
    const r = await checkUpdate('0.8.1', {
      fetchJson: async () => release({ assets: [{ name: 'broken.dmg' }, ...release().assets] }),
    })
    expect(r!.assets.every((a) => a.url.startsWith('https://'))).toBe(true)
  })

  it('默认请求 GitHub 的 releases/latest', async () => {
    const seen: string[] = []
    await checkUpdate('0.8.1', { fetchJson: async (url) => { seen.push(url); return release() } })
    expect(seen).toEqual(['https://api.github.com/repos/monkeychen/wx-kit/releases/latest'])
  })
})
