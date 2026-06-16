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
    expect(v).toEqual({ libraryRoot: '/default/lib', defaultFormats: ['md', 'html', 'meta'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify' })
  })

  it('persists and reloads saved settings', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ libraryRoot: '/custom', defaultFormats: ['md', 'pdf'] })
    const s2 = new SettingsService(dir, '/default/lib')
    expect(await s2.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['md', 'pdf'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify' })
  })

  it('merges partial save over existing', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ libraryRoot: '/custom', defaultFormats: ['md'] })
    await s.save({ defaultFormats: ['html'] })
    expect(await s.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['html'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify' })
  })

  it('persists subscription settings', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ subscriptionAutoCheck: true, subscriptionCheckTime: '07:30', subscriptionNewArticleAction: 'download' })
    const s2 = new SettingsService(dir, '/default/lib')
    const v = await s2.get()
    expect(v.subscriptionAutoCheck).toBe(true)
    expect(v.subscriptionCheckTime).toBe('07:30')
    expect(v.subscriptionNewArticleAction).toBe('download')
  })

  it('persists custom list column widths', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ listColumnWidths: { account: 200, publish: 180, download: 120 } })
    const s2 = new SettingsService(dir, '/default/lib')
    expect((await s2.get()).listColumnWidths).toEqual({ account: 200, publish: 180, download: 120 })
  })
})
