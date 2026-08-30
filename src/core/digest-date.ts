// digest 的自然日统一为北京时间，不依赖运行 CLI 的机器时区。
import { parsePublicationTime, shanghaiDate } from './publication-time'

export interface DigestDate {
  date: string
  fromTs: number
  toTs: number
}

const HINT = '日期只接受 YYYY-MM-DD、today、yesterday；其它表达请先换算成 YYYY-MM-DD'

export function resolveDigestDate(input: string, now: number = Date.now()): DigestDate {
  const raw = (input ?? '').trim().toLowerCase()
  const date = raw === 'today' ? shanghaiDate(now)
    : raw === 'yesterday' ? shanghaiDate(now - 86_400_000) : raw
  const from = /^\d{4}-\d{2}-\d{2}$/.test(date) ? parsePublicationTime(date) : null
  if (from == null) throw new Error(`无法识别或不存在的日期「${input}」。${HINT}`)
  return { date, fromTs: from / 1000, toTs: from / 1000 + 86_399 }
}
