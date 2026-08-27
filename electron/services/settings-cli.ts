// CLI 设置赋值:把字符串值校验并解析成 AppSettings 的部分补丁。纯函数,无 electron。
import { ALL_FORMATS, type DownloadFormat } from '../../src/core/types'
import type { AppSettings } from './settings'

export const SETTABLE_KEYS = [
  'libraryRoot', 'defaultFormats', 'historyRetentionDays',
  'subscriptionAutoCheck', 'subscriptionCheckTime', 'subscriptionNewArticleAction',
  'subscriptionScheduleMode', 'subscriptionIntervalHours',
] as const

type ParseOk = { ok: true; patch: Partial<AppSettings> }
type ParseErr = { ok: false; error: string }

const fail = (m: string): ParseErr => ({ ok: false, error: m })
const intIn = (raw: string, lo: number, hi: number): number | null => {
  const n = Number(raw)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

export function parseSettingAssignment(key: string, raw: string): ParseOk | ParseErr {
  switch (key) {
    case 'libraryRoot':
      return raw ? { ok: true, patch: { libraryRoot: raw } } : fail('libraryRoot 不能为空')
    case 'defaultFormats': {
      const set = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
      const out = ALL_FORMATS.filter((f) => set.has(f)) as DownloadFormat[]
      return out.length ? { ok: true, patch: { defaultFormats: out } } : fail(`无有效格式;可选:${ALL_FORMATS.join(',')}`)
    }
    case 'historyRetentionDays': {
      const n = intIn(raw, 1, 3650)
      return n !== null ? { ok: true, patch: { historyRetentionDays: n } } : fail('需 1..3650 的整数')
    }
    case 'subscriptionIntervalHours': {
      const n = intIn(raw, 1, 24)
      return n !== null ? { ok: true, patch: { subscriptionIntervalHours: n } } : fail('需 1..24 的整数')
    }
    case 'subscriptionAutoCheck': {
      if (raw === 'true') return { ok: true, patch: { subscriptionAutoCheck: true } }
      if (raw === 'false') return { ok: true, patch: { subscriptionAutoCheck: false } }
      return fail('需 true 或 false')
    }
    case 'subscriptionCheckTime':
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw)
        ? { ok: true, patch: { subscriptionCheckTime: raw } } : fail('需 HH:MM(24 小时制)')
    case 'subscriptionNewArticleAction':
      return raw === 'notify' || raw === 'download'
        ? { ok: true, patch: { subscriptionNewArticleAction: raw } } : fail("需 'notify' 或 'download'")
    case 'subscriptionScheduleMode':
      return raw === 'daily' || raw === 'interval'
        ? { ok: true, patch: { subscriptionScheduleMode: raw } } : fail("需 'daily' 或 'interval'")
    default:
      return fail(`不可设置的键:${key};可设置:${SETTABLE_KEYS.join(', ')}`)
  }
}
