// 把时间串渲染成「3 天前 / 刚刚」这类人话。解析不了就原样返回。
export function relativeTime(input: string): string {
  if (!input) return ''
  const t = Date.parse(input.replace(/-/g, '/'))
  if (Number.isNaN(t)) return input
  const diff = Date.now() - t
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  const mon = Math.floor(day / 30)
  if (mon < 12) return `${mon} 个月前`
  return `${Math.floor(mon / 12)} 年前`
}
