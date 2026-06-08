import { useEffect, useRef, useState } from 'react'
import { Input, Segmented, InputNumber, DatePicker, Spin, message } from 'antd'
import type { Dayjs } from 'dayjs'
import { api } from '../api'
import type { CrawlEvent, CrawlRangeInput } from '../api'
import LoginGate from '../components/LoginGate'
import CrawlProgress, { type CrawlRow } from '../components/CrawlProgress'
import FormatPicker from '../components/FormatPicker'
import { estimateRemaining } from '../eta'
import type { DownloadFormat } from '../../core/types'
import type { MpAccount } from '../../core/mp-types'

export default function BatchCrawl() {
  const [authValid, setAuthValid] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [searching, setSearching] = useState(false)
  const [accounts, setAccounts] = useState<MpAccount[] | null>(null)
  const [selected, setSelected] = useState<MpAccount | null>(null)
  const [mode, setMode] = useState<'count' | 'date'>('count')
  const [count, setCount] = useState(10)
  const [dates, setDates] = useState<[Dayjs, Dayjs] | null>(null)
  const [formats, setFormats] = useState<DownloadFormat[]>(['md', 'html', 'meta'])
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<CrawlRow[]>([])
  const [eta, setEta] = useState('')
  const startRef = useRef(0)

  useEffect(() => {
    api.getSettings().then((s) => setFormats(s.defaultFormats)).catch(() => {})
    api.mpAuthStatus().then((r) => setAuthValid(r.valid)).catch(() => setAuthValid(false))
  }, [])

  useEffect(() => {
    const off = api.onCrawlProgress((ev: CrawlEvent) => {
      if (ev.kind === 'listed') {
        startRef.current = Date.now()
        setRows(ev.items.map((it) => ({ title: it.title, url: it.url, status: 'waiting' })))
      } else if (ev.kind === 'item') {
        setRows((prev) => {
          const next = prev.slice()
          if (next[ev.index]) next[ev.index] = { ...next[ev.index], status: ev.status, error: ev.error }
          const done = next.filter((r) => r.status === 'ok' || r.status === 'skipped' || r.status === 'failed').length
          setEta(estimateRemaining(done, next.length, Date.now() - startRef.current))
          return next
        })
      } else if (ev.kind === 'done') {
        setRunning(false); setEta('')
      }
    })
    return off
  }, [])

  const search = async () => {
    if (!name.trim()) return
    setSearching(true); setAccounts(null); setSelected(null)
    const r = await api.mpSearch(name.trim())
    setSearching(false)
    if (!r.ok) {
      if (r.error?.code === 'AUTH_REQUIRED') setAuthValid(false)
      else message.error('搜索失败：' + (r.error?.message ?? ''))
      return
    }
    setAccounts(r.list ?? [])
  }

  const start = async () => {
    if (!selected) return
    if (mode === 'date' && !dates) { message.warning('请选择日期范围'); return }
    if (!formats.length) { message.warning('请至少选择一种格式'); return }
    const range: CrawlRangeInput = mode === 'count'
      ? { count }
      : { from: dates![0].format('YYYY-MM-DD'), to: dates![1].format('YYYY-MM-DD') }
    setRunning(true); setRows([]); setEta('')
    try {
      const summary = await api.mpCrawl(selected.fakeid, range, formats)
      message.success(`完成 · 成功 ${summary.succeeded}，跳过 ${summary.skipped}，失败 ${summary.failed}`)
    } catch (e) {
      const msg = (e as Error).message
      setRunning(false)
      if (msg.includes('AUTH_REQUIRED')) setAuthValid(false)
      else message.error('爬取出错：' + msg)
    }
  }

  const retry = async (i: number) => {
    const row = rows[i]
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, status: 'downloading' } : r)))
    const s = await api.download([row.url], formats)
    const r = s.items[0]
    setRows((prev) => prev.map((x, j) => (j === i
      ? { ...x, status: r.ok ? (r.skipped ? 'skipped' : 'ok') : 'failed', error: r.error?.message }
      : x)))
  }

  if (authValid === null) return <div className="page" style={{ textAlign: 'center', paddingTop: 80 }}><Spin /></div>
  if (!authValid) return <div className="page"><div className="page-narrow"><LoginGate onLoggedIn={() => setAuthValid(true)} /></div></div>

  return (
    <div className="page">
      <div className="page-narrow fade-in">
        <div className="page-head">
          <div className="eyebrow">Batch</div>
          <h1 className="page-title">批量爬取</h1>
          <p className="page-sub">搜索公众号，按数量或日期范围批量下载它的文章。</p>
        </div>

        <Input.Search placeholder="输入公众号名称" enterButton="搜索" value={name}
          onChange={(e) => setName(e.target.value)} onSearch={search} loading={searching}
          disabled={running} style={{ maxWidth: 420 }} data-testid="account-search" />

        {accounts && !selected && (
          <div className="fade-in" style={{ marginTop: 16, display: 'grid', gap: 8, maxWidth: 520 }}>
            {accounts.length === 0 && <div className="faint">没找到这个公众号，换个名字试试。</div>}
            {accounts.map((a) => (
              <div key={a.fakeid} className="candidate" data-testid="candidate" onClick={() => { setSelected(a); setAccounts(null) }}>
                <span className="c-name">{a.nickname}</span>
                {a.signature && <span className="c-sig">{a.signature}</span>}
              </div>
            ))}
          </div>
        )}

        {selected && !running && rows.length === 0 && (
          <div className="surface fade-in" style={{ marginTop: 22 }}>
            <div className="cfg-head">
              <div className="seal">{selected.nickname.slice(0, 1)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="nm">{selected.nickname}</div>
                {selected.signature && <div className="sg">{selected.signature}</div>}
              </div>
              <button className="swap" onClick={() => setSelected(null)}>换一个</button>
            </div>

            <div className="cfg-sec">
              <p className="sec-label">抓取范围</p>
              <div className="range-row">
                <Segmented value={mode} onChange={(v) => setMode(v as 'count' | 'date')}
                  options={[{ label: '最近 N 篇', value: 'count' }, { label: '日期范围', value: 'date' }]} />
                {mode === 'count'
                  ? <InputNumber min={1} max={200} value={count} onChange={(v) => setCount(v ?? 1)} addonAfter="篇" />
                  : <DatePicker.RangePicker value={dates ?? undefined} onChange={(v) => setDates(v as [Dayjs, Dayjs] | null)} />}
              </div>
            </div>

            <div className="cfg-sec">
              <p className="sec-label">保存为</p>
              <FormatPicker value={formats} onChange={setFormats} />
            </div>

            <div className="cfg-foot">
              <button className="cta" style={{ marginTop: 0 }} onClick={start} data-testid="start-crawl">开始爬取</button>
              <span className="foot-note">{mode === 'count'
                ? `共 ${count} 篇 · 为避免频控，将逐篇串行下载、间隔随机延迟`
                : '按日期范围抓取 · 列出后逐篇下载'}</span>
            </div>
          </div>
        )}

        {(running || rows.length > 0) && (
          <CrawlProgress account={selected?.nickname ?? ''} rows={rows} eta={eta} running={running}
            onCancel={() => api.mpCancelCrawl()} onRetry={retry} />
        )}
      </div>
    </div>
  )
}
