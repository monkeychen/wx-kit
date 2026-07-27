import { describe, it, expect, vi } from 'vitest'
import { decideUpdateCheck, infoFromCache, resolveUpdateCheck, type CachedRelease } from '../../src/core/update-gate'
import type { UpdateInfo } from '../../src/core/check-update'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

const cached: CachedRelease = {
  latest: '0.8.4',
  notes: '# 新版\n改了些东西',
  publishedAt: '2026-07-27T12:00:00Z',
  assets: [{ name: 'wx-kit-0.8.4-arm64.dmg', url: 'https://example.com/a.dmg', size: 140_000_000 }],
}

describe('decideUpdateCheck', () => {
  it('手动检查永远真查：关了开关、刚查过都不拦', () => {
    expect(decideUpdateCheck({ silent: false, enabled: false, lastCheckedAt: NOW, now: NOW })).toBe('check')
    expect(decideUpdateCheck({ silent: false, enabled: true, lastCheckedAt: NOW, now: NOW })).toBe('check')
  })

  it('关掉开关时静默检查什么都不做——连缓存提示也不给', () => {
    expect(decideUpdateCheck({ silent: true, enabled: false, lastCheckedAt: null, now: NOW })).toBe('skip')
    expect(decideUpdateCheck({ silent: true, enabled: false, lastCheckedAt: NOW - DAY * 9, now: NOW })).toBe('skip')
  })

  it('24 小时内查过 → 用缓存，而不是当作「没有新版」', () => {
    // R1 的根因就在这里：旧实现此处直接 return null，把上次查到的结论一起吞了
    expect(decideUpdateCheck({ silent: true, enabled: true, lastCheckedAt: NOW - 1000, now: NOW })).toBe('cache')
    expect(decideUpdateCheck({ silent: true, enabled: true, lastCheckedAt: NOW - DAY + 1, now: NOW })).toBe('cache')
  })

  it('从未查过或已超 24 小时 → 真查（满一天算超时）', () => {
    expect(decideUpdateCheck({ silent: true, enabled: true, lastCheckedAt: null, now: NOW })).toBe('check')
    expect(decideUpdateCheck({ silent: true, enabled: true, lastCheckedAt: NOW - DAY, now: NOW })).toBe('check')
    expect(decideUpdateCheck({ silent: true, enabled: true, lastCheckedAt: NOW - DAY * 3, now: NOW })).toBe('check')
  })
})

describe('infoFromCache', () => {
  it('缓存版本高于当前 → hasUpdate，其余字段原样带出', () => {
    const info = infoFromCache(cached, '0.8.3')
    expect(info).toMatchObject({ current: '0.8.3', latest: '0.8.4', hasUpdate: true, notes: cached.notes })
    expect(info?.assets).toEqual(cached.assets)
  })

  it('升级之后提示自动消失——不需要任何清理逻辑', () => {
    expect(infoFromCache(cached, '0.8.4')?.hasUpdate).toBe(false)
    expect(infoFromCache(cached, '0.9.0')?.hasUpdate).toBe(false)
  })

  it('没有缓存 → null', () => {
    expect(infoFromCache(null, '0.8.3')).toBeNull()
  })

  it('缓存里的版本号缺失时按「没有缓存」处理，不产生 latest 为空的提示', () => {
    expect(infoFromCache({ ...cached, latest: '' }, '0.8.3')).toBeNull()
  })
})

describe('resolveUpdateCheck 端到端编排', () => {
  const base = {
    currentVersion: '0.8.3', cached, now: NOW,
    save: async () => {},
    check: async () => null,
  }

  it('限流命中 → 用缓存，且一次请求都不发', async () => {
    const check = vi.fn(async () => null)
    const info = await resolveUpdateCheck({ ...base, silent: true, enabled: true, lastCheckedAt: NOW - 1000, check })
    expect(check).not.toHaveBeenCalled()
    expect(info).toMatchObject({ hasUpdate: true, latest: '0.8.4' })
  })

  it('查到结果 → 落缓存与时间戳（没有新版也落，它记的是「上次查到的事实」）', async () => {
    const save = vi.fn(async () => {})
    const fresh: UpdateInfo = {
      current: '0.8.3', latest: '0.8.3', hasUpdate: false,
      notes: 'n', publishedAt: 'p', assets: [],
    }
    await resolveUpdateCheck({ ...base, silent: false, enabled: true, lastCheckedAt: null, check: async () => fresh, save })
    expect(save).toHaveBeenCalledWith({
      lastUpdateCheckAt: NOW,
      lastKnownRelease: { latest: '0.8.3', notes: 'n', publishedAt: 'p', assets: [] },
    })
  })

  it('断网时静默检查回落到缓存——已知的新版提示不该因为一次断网就消失', async () => {
    const save = vi.fn(async () => {})
    const info = await resolveUpdateCheck({
      ...base, silent: true, enabled: true, lastCheckedAt: NOW - DAY * 2, check: async () => null, save,
    })
    expect(info).toMatchObject({ hasUpdate: true, latest: '0.8.4' })
    expect(save).not.toHaveBeenCalled()      // 没查成不记时间，否则断网一次要等一天
  })

  it('断网时手动检查返回 null——拿旧结论冒充「查成功」是撒谎', async () => {
    const info = await resolveUpdateCheck({
      ...base, silent: false, enabled: true, lastCheckedAt: null, check: async () => null,
    })
    expect(info).toBeNull()
  })

  it('关掉开关时静默检查既不请求也不给缓存结论', async () => {
    const check = vi.fn(async () => null)
    const info = await resolveUpdateCheck({ ...base, silent: true, enabled: false, lastCheckedAt: null, check })
    expect(check).not.toHaveBeenCalled()
    expect(info).toBeNull()
  })
})
