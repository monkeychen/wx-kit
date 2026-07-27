// src/core/digest-date.ts
// `subscription digest --date` 的日期解析。
//
// **刻意只认三种写法**:`YYYY-MM-DD` / `today` / `yesterday`。
// 「昨天」「7月23日」「上周三」这类表达由 agent 换算后再传进来——
// LLM 做这件事零成本且做得全,而确定性程序要维护一张永远不全的解析表。
// 更要紧的是:**猜错会静默返回另一天的结果**,那比明确报错糟得多(用户根本不会发现)。

export interface DigestDate {
  /** 归一后的日期,YYYY-MM-DD */
  date: string
  /** 当天 00:00:00 的 unix 秒(本机时区) */
  fromTs: number
  /** 当天 23:59:59 的 unix 秒(本机时区) */
  toTs: number
}

const HINT = '日期只接受 YYYY-MM-DD、today、yesterday;「昨天」「7月23日」这类表达请先换算成 YYYY-MM-DD'

const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function resolveDigestDate(input: string, now: number = Date.now()): DigestDate {
  const raw = (input ?? '').trim().toLowerCase()
  if (!raw) throw new Error(HINT)

  let date: string
  if (raw === 'today' || raw === 'yesterday') {
    const d = new Date(now)
    if (raw === 'yesterday') d.setDate(d.getDate() - 1)
    date = fmt(d)
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
    if (!m) throw new Error(`无法识别的日期「${input}」。${HINT}`)
    const [y, mo, dd] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const probe = new Date(y, mo - 1, dd)
    // 2026-02-30 会被 Date 静默滚成 3 月 2 日 —— 回读校验才挡得住
    if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== dd) {
      throw new Error(`日期「${input}」不存在。${HINT}`)
    }
    date = fmt(probe)
  }

  const [y, mo, dd] = date.split('-').map(Number)
  const from = new Date(y, mo - 1, dd, 0, 0, 0, 0)
  const to = new Date(y, mo - 1, dd, 23, 59, 59, 0)
  return { date, fromTs: Math.floor(from.getTime() / 1000), toTs: Math.floor(to.getTime() / 1000) }
}
