import { describe, it, expect } from 'vitest'
import { parseSettingAssignment } from '../../electron/services/settings-cli'

describe('parseSettingAssignment', () => {
  it('parses string libraryRoot', () => {
    expect(parseSettingAssignment('libraryRoot', '/x/y')).toEqual({ ok: true, patch: { libraryRoot: '/x/y' } })
  })
  it('parses csv defaultFormats and rejects junk', () => {
    expect(parseSettingAssignment('defaultFormats', 'md,pdf')).toEqual({ ok: true, patch: { defaultFormats: ['md', 'pdf'] } })
    expect(parseSettingAssignment('defaultFormats', 'nope')).toMatchObject({ ok: false })
  })
  it('parses int historyRetentionDays within range', () => {
    expect(parseSettingAssignment('historyRetentionDays', '30')).toEqual({ ok: true, patch: { historyRetentionDays: 30 } })
    expect(parseSettingAssignment('historyRetentionDays', '0')).toMatchObject({ ok: false })
  })
  it('accepts subscription settings again (v0.10.0 weread revival)', () => {
    expect(parseSettingAssignment('subscriptionAutoCheck', 'true')).toMatchObject({ ok: true, patch: { subscriptionAutoCheck: true } })
    expect(parseSettingAssignment('subscriptionCheckTime', '07:30')).toMatchObject({ ok: true, patch: { subscriptionCheckTime: '07:30' } })
    expect(parseSettingAssignment('subscriptionNewArticleAction', 'download')).toMatchObject({ ok: true })
    expect(parseSettingAssignment('subscriptionScheduleMode', 'daily')).toMatchObject({ ok: true })
    expect(parseSettingAssignment('subscriptionIntervalHours', '4')).toMatchObject({ ok: true })
    // 非法值仍拒绝
    expect(parseSettingAssignment('subscriptionAutoCheck', 'yes')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('subscriptionCheckTime', '7:30')).toMatchObject({ ok: false })
  })
  it('rejects non-settable keys', () => {
    expect(parseSettingAssignment('listColumnWidths', '{}')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('cliLinkPrompted', 'true')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('bogus', 'x')).toMatchObject({ ok: false })
  })
})
