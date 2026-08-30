/** 无时区的微信时间属于北京时间；只接受可校验的日期，不让 Date 自动滚动非法日期。 */
export function parsePublicationTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim())
  if (!match) return null
  const [, date, hour = '00', minute = '00', second = '00', fraction = '', zone = '+08:00'] = match
  const day = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null
  const instant = Date.parse(`${date}T${hour}:${minute}:${second}${fraction}${zone}`)
  return Number.isFinite(instant) ? instant : null
}

export function shanghaiDate(instant: number): string {
  return new Date(instant + 8 * 3600_000).toISOString().slice(0, 10)
}
