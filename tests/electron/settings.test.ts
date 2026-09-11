// tests/electron/settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '../../electron/services/settings'

describe('SettingsService', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-set-')) })

  it('returns defaults when no file exists', async () => {
    const s = new SettingsService(dir, '/default/lib')
    const v = await s.get()
    expect(v).toEqual({ libraryRoot: '/default/lib', defaultFormats: ['md', 'html', 'meta'], downloadVideos: true, updateCheckEnabled: true, lastUpdateCheckAt: null, lastKnownRelease: null, historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify', subscriptionScheduleMode: 'daily', subscriptionIntervalHours: 6, cliLinkPrompted: false, libraryExpandedGroups: [], librarySort: { key: 'publish', dir: 'desc' }, siteSyncEnabled: false, siteSyncPostsDir: '/Users/chenzhian/workspace/ai/dreamble/site/content/posts', mowenMocliPath: null, mowenMocliVersion: null, mowenDetectedAt: null })
  })

  it('persists and reloads saved settings', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ libraryRoot: '/custom', defaultFormats: ['md', 'pdf'] })
    const s2 = new SettingsService(dir, '/default/lib')
    expect(await s2.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['md', 'pdf'], downloadVideos: true, updateCheckEnabled: true, lastUpdateCheckAt: null, lastKnownRelease: null, historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify', subscriptionScheduleMode: 'daily', subscriptionIntervalHours: 6, cliLinkPrompted: false, libraryExpandedGroups: [], librarySort: { key: 'publish', dir: 'desc' }, siteSyncEnabled: false, siteSyncPostsDir: '/Users/chenzhian/workspace/ai/dreamble/site/content/posts', mowenMocliPath: null, mowenMocliVersion: null, mowenDetectedAt: null })
  })

  it('merges partial save over existing', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ libraryRoot: '/custom', defaultFormats: ['md'] })
    await s.save({ defaultFormats: ['html'] })
    expect(await s.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['html'], downloadVideos: true, updateCheckEnabled: true, lastUpdateCheckAt: null, lastKnownRelease: null, historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify', subscriptionScheduleMode: 'daily', subscriptionIntervalHours: 6, cliLinkPrompted: false, libraryExpandedGroups: [], librarySort: { key: 'publish', dir: 'desc' }, siteSyncEnabled: false, siteSyncPostsDir: '/Users/chenzhian/workspace/ai/dreamble/site/content/posts', mowenMocliPath: null, mowenMocliVersion: null, mowenDetectedAt: null })
  })

  it('persists custom list column widths', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ listColumnWidths: { account: 200, publish: 180, download: 120 } })
    const s2 = new SettingsService(dir, '/default/lib')
    expect((await s2.get()).listColumnWidths).toEqual({ account: 200, publish: 180, download: 120 })
  })

  it('defaults cliLinkPrompted to false and persists true', async () => {
    const s = new SettingsService(dir, '/default/lib')
    expect((await s.get()).cliLinkPrompted).toBe(false)
    await s.save({ cliLinkPrompted: true })
    expect((await new SettingsService(dir, '/default/lib').get()).cliLinkPrompted).toBe(true)
  })
})
