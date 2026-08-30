import { describe, expect, it } from 'vitest'
import { parsePublicationTime, shanghaiDate } from '../../src/core/publication-time'

describe('发表时间可信解析', () => {
  it.each(['', '昨天', '2026-02-30', '2026-08-30 24:00', '2026-08-30T10:00:00+99:00'])('不接受 %s', (value) => {
    expect(parsePublicationTime(value)).toBeNull()
  })
  it('无时区按北京时间，有时区先换算，支持闰年', () => {
    expect(parsePublicationTime('2026-08-30 00:30')).toBe(Date.parse('2026-08-29T16:30:00Z'))
    expect(shanghaiDate(parsePublicationTime('2026-08-29T10:30:00-06:00')!)).toBe('2026-08-30')
    expect(parsePublicationTime('2024-02-29')).not.toBeNull()
  })
})
