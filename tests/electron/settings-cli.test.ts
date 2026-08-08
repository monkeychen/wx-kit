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
  it('rejects retired subscription settings without deleting their parser implementation', () => {
    expect(parseSettingAssignment('subscriptionAutoCheck', 'true')).toMatchObject({ ok: false, error: expect.stringContaining('MP_BACKEND_UNAVAILABLE') })
    expect(parseSettingAssignment('subscriptionCheckTime', '07:30')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('subscriptionNewArticleAction', 'download')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('subscriptionScheduleMode', 'daily')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('subscriptionIntervalHours', '4')).toMatchObject({ ok: false })
  })
  it('rejects non-settable keys', () => {
    expect(parseSettingAssignment('listColumnWidths', '{}')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('cliLinkPrompted', 'true')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('bogus', 'x')).toMatchObject({ ok: false })
  })
})
