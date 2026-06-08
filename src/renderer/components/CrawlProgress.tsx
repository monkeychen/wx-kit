import { useEffect, useState } from 'react'
import { Popconfirm } from 'antd'
import { explainError } from '../error-explain'

export interface CrawlRow { title: string; url: string; status: 'waiting' | 'downloading' | 'ok' | 'skipped' | 'failed'; error?: string }
export interface BackoffState { attempt: number; until: number }

const ICON: Record<CrawlRow['status'], string> = { waiting: '·', downloading: '⟳', ok: '✓', skipped: '⊘', failed: '✗' }
const BADGE: Record<string, [string, string]> = { ok: ['badge-ok', '成功'], skipped: ['badge-skip', '已存在'], failed: ['badge-fail', '失败'] }

interface Props {
  account: string
  rows: CrawlRow[]
  eta: string
  running: boolean
  backoff?: BackoffState | null
  onCancel: () => void
  onRetry: (index: number) => void
}

/** 退避横幅：列表阶段命中频控时显示，客户端每秒倒数，让用户知道是在等而非死机。 */
function BackoffBanner({ attempt, until }: BackoffState) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.ceil((until - Date.now()) / 1000))
  return (
    <div className="backoff-banner" data-testid="backoff-banner">
      <span className="bk-dot" />
      微信访问太频繁，已自动退避 · 约 <b>{secs}</b> 秒后重试（第 {attempt} 次）
    </div>
  )
}

/** 实时逐篇列表：整体进度 + 预计剩余 + 取消，逐篇行带状态徽章（失败可重试）。 */
export default function CrawlProgress({ account, rows, eta, running, backoff, onCancel, onRetry }: Props) {
  const done = rows.filter((r) => r.status === 'ok' || r.status === 'skipped' || r.status === 'failed').length
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0
  return (
    <div className="surface fade-in" style={{ marginTop: 24, padding: '18px 20px' }} data-testid="crawl-progress">
      <div className="progress-head">
        <span className="progress-phase">{running ? `正在爬取 · ${account}` : `已完成 · ${account}`}</span>
        {running
          ? (
            <Popconfirm title="确认取消下载？" description="已下载的文章会保留；未下载的会列入下载历史，可稍后单独补下。"
              okText="取消下载" cancelText="继续下载" okButtonProps={{ danger: true }} onConfirm={onCancel}>
              <button className="card-btn danger" style={{ flex: 'none', border: '1px solid var(--line-strong)', padding: '2px 14px' }} data-testid="crawl-cancel">取消</button>
            </Popconfirm>
          )
          : <span className="progress-count">{done}/{rows.length}</span>}
      </div>
      {backoff && <BackoffBanner attempt={backoff.attempt} until={backoff.until} />}
      <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      <div className="progress-current">{done}/{rows.length}{eta ? ' · ' + eta : ''}</div>
      <div className="result-list" style={{ marginTop: 10 }}>
        {rows.map((r, i) => {
          const ex = r.status === 'failed' && r.error ? explainError(r.error) : null
          return (
            <div className="result-row" key={i}>
              <span style={{ width: 16, textAlign: 'center', color: r.status === 'downloading' ? 'var(--cinnabar)' : 'var(--ink-faint)' }}>{ICON[r.status]}</span>
              <span className="result-url" style={{ color: r.status === 'downloading' ? 'var(--ink)' : undefined }}>{r.title}</span>
              {r.status === 'downloading' && <span className="faint">下载中…</span>}
              {ex && <span className="fail-hint" title={ex.raw}>{ex.title} · {ex.hint}</span>}
              {BADGE[r.status] && !ex && <span className={`badge ${BADGE[r.status][0]}`}>{BADGE[r.status][1]}</span>}
              {ex && <span className={`badge ${BADGE.failed[0]}`} title={ex.raw}>{BADGE.failed[1]}</span>}
              {r.status === 'failed' && <button className="card-btn" style={{ flex: 'none' }} onClick={() => onRetry(i)}>重试</button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
