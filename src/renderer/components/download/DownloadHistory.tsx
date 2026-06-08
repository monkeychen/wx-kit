import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { message, Popconfirm } from 'antd'
import { api, type HistoryEvent } from '../../api'

const PAGE = 10

function two(n: number) { return String(n).padStart(2, '0') }

/** 友好时间：刚刚 / 今天 HH:mm / 昨天 HH:mm / M-D HH:mm */
function whenLabel(t: number): string {
  const d = new Date(t), now = new Date()
  if (now.getTime() - t < 2 * 60_000) return '刚刚'
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`
  const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (ymd(d) === ymd(now)) return `今天 ${hm}`
  if (ymd(d) === ymd(yest)) return `昨天 ${hm}`
  return `${d.getMonth() + 1}-${d.getDate()} ${hm}`
}

function sourceTitle(ev: HistoryEvent): string {
  if (ev.source.kind === 'url') return `${whenLabel(ev.time)} · 按链接下载 ${ev.source.count} 篇`
  return `${whenLabel(ev.time)} · ${ev.source.nickname} ${ev.total} 篇`
}

/** 第二排：格式 · （公众号）范围 */
function sourceSub(ev: HistoryEvent): string {
  const fmts = ev.formats.join(' · ')
  if (ev.source.kind === 'account') {
    const r = ev.source.range
    const range = 'count' in r ? `最近 ${r.count} 篇` : `${r.from} ～ ${r.to}`
    return `${fmts} · ${range}`
  }
  return fmts
}

interface Props {
  reloadKey: number
  onAgain: (ev: HistoryEvent) => void
}

export default function DownloadHistory({ reloadKey, onAgain }: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [total, setTotal] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const nav = useNavigate()

  // 初载 + reloadKey 变化（下载完成）：从头取 max(PAGE, 已加载)，下载完成时展开顶条
  useEffect(() => {
    let alive = true
    const limit = Math.max(PAGE, events.length)
    api.historyList(0, limit).then((r) => {
      if (!alive) return
      setEvents(r.events); setTotal(r.total)
      if (reloadKey > 0 && r.events[0]) setExpanded((s) => new Set(s).add(r.events[0].id))
    }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const loadMore = async () => {
    const r = await api.historyList(events.length, PAGE)
    setEvents((prev) => [...prev, ...r.events]); setTotal(r.total)
  }

  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  const reload = async () => {
    const r = await api.historyList(0, Math.max(PAGE, events.length))
    setEvents(r.events); setTotal(r.total)
  }

  const retry = async (url: string, formats: HistoryEvent['formats']) => {
    try { await api.download([url], formats); message.success('重试完成'); await reload() }
    catch (e) { message.error('重试失败：' + (e as Error).message) }
  }

  const remove = async (id: string) => {
    try { await api.historyRemove(id); await reload() }
    catch (e) { message.error('删除失败：' + (e as Error).message) }
  }

  if (events.length === 0) return null

  return (
    <div className="hist" data-testid="download-history">
      <div className="hist-head">
        <div className="hist-title">下载历史</div>
        <div className="hist-sub">保留最近 1 年 · 清空在「设置」</div>
      </div>

      {events.map((ev) => {
        const open = expanded.has(ev.id)
        const acc = ev.source.kind === 'account'
        return (
          <div className={`event${open ? ' ev-open' : ''}`} key={ev.id} data-testid="history-event">
            <div className="ev-bar" onClick={() => toggle(ev.id)}>
              <span className="ev-caret">▶</span>
              <span className={`ev-icon ${acc ? 'acc' : 'url'}`}>{acc ? (ev.source as { nickname: string }).nickname.slice(0, 1) : '链'}</span>
              <div className="ev-main">
                <div className="ev-line1">{sourceTitle(ev)}</div>
                <div className="ev-line2">{sourceSub(ev)}</div>
              </div>
              <div className="ev-stat">
                {ev.succeeded > 0 && <span className="ok">{ev.succeeded} 成功</span>}
                {ev.skipped > 0 && <> · {ev.skipped} 跳过</>}
                {ev.failed > 0 && <> · <span className="fail">{ev.failed} 失败</span></>}
              </div>
              <button className="ev-again" onClick={(e) => { e.stopPropagation(); onAgain(ev) }}>复制下载项</button>
              <Popconfirm title="删除这条下载记录？" description="只删记录，不删已下载的文件。"
                okText="删除" cancelText="取消" onConfirm={() => remove(ev.id)}>
                <button className="ev-del" data-testid="history-del" onClick={(e) => e.stopPropagation()}>删除</button>
              </Popconfirm>
            </div>

            {open && (
              <div className="ev-body">
                {ev.items.map((it, i) => (
                  <div className="art" data-testid="history-article" key={i}>
                    <div className={`art-title${it.deleted ? ' del' : ''}`}>{it.title}</div>
                    {it.status === 'ok' && !it.deleted && (
                      <div className="fmts">{(it.formats ?? []).map((f) => <span className="fmt" key={f}>{f}</span>)}</div>
                    )}
                    {it.status === 'skipped' && <span className="badge badge-skip">已存在</span>}
                    {it.status === 'failed' && <span className="fail-reason">失败：{it.error ?? '未知错误'}</span>}
                    {it.deleted && <span className="art-del-note">已从文库删除</span>}

                    <div className="act">
                      {it.status !== 'failed' && it.id && !it.deleted && (
                        <button data-testid="history-read" onClick={() => nav(`/reader/${encodeURIComponent(it.id!)}`)}>阅读</button>
                      )}
                      {it.dir && !it.deleted && <button onClick={() => api.reveal(it.dir!)}>文件夹</button>}
                      {it.status === 'failed' && <button className="retry" onClick={() => retry(it.url, ev.formats)}>重试</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {events.length < total && (
        <button className="hist-more" onClick={loadMore}>加载更多（剩 {total - events.length}）</button>
      )}
    </div>
  )
}
