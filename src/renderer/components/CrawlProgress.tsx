export interface CrawlRow { title: string; url: string; status: 'waiting' | 'downloading' | 'ok' | 'skipped' | 'failed'; error?: string }

const ICON: Record<CrawlRow['status'], string> = { waiting: '·', downloading: '⟳', ok: '✓', skipped: '⊘', failed: '✗' }
const BADGE: Record<string, [string, string]> = { ok: ['badge-ok', '成功'], skipped: ['badge-skip', '已存在'], failed: ['badge-fail', '失败'] }

interface Props {
  account: string
  rows: CrawlRow[]
  eta: string
  running: boolean
  onCancel: () => void
  onRetry: (index: number) => void
}

/** 实时逐篇列表：整体进度 + 预计剩余 + 取消，逐篇行带状态徽章（失败可重试）。 */
export default function CrawlProgress({ account, rows, eta, running, onCancel, onRetry }: Props) {
  const done = rows.filter((r) => r.status === 'ok' || r.status === 'skipped' || r.status === 'failed').length
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0
  return (
    <div className="surface fade-in" style={{ marginTop: 24, padding: '18px 20px' }} data-testid="crawl-progress">
      <div className="progress-head">
        <span className="progress-phase">{running ? `正在爬取 · ${account}` : `已完成 · ${account}`}</span>
        {running
          ? <button className="card-btn danger" style={{ flex: 'none', border: '1px solid var(--line-strong)', padding: '2px 14px' }} data-testid="crawl-cancel" onClick={onCancel}>取消</button>
          : <span className="progress-count">{done}/{rows.length}</span>}
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      <div className="progress-current">{done}/{rows.length}{eta ? ' · ' + eta : ''}</div>
      <div className="result-list" style={{ marginTop: 10 }}>
        {rows.map((r, i) => (
          <div className="result-row" key={i}>
            <span style={{ width: 16, textAlign: 'center', color: r.status === 'downloading' ? 'var(--cinnabar)' : 'var(--ink-faint)' }}>{ICON[r.status]}</span>
            <span className="result-url" style={{ color: r.status === 'downloading' ? 'var(--ink)' : undefined }}>{r.title}</span>
            {r.status === 'downloading' && <span className="faint">下载中…</span>}
            {BADGE[r.status] && <span className={`badge ${BADGE[r.status][0]}`} title={r.error}>{BADGE[r.status][1]}</span>}
            {r.status === 'failed' && <button className="card-btn" style={{ flex: 'none' }} onClick={() => onRetry(i)}>重试</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
