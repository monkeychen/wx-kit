import { useEffect, useState } from 'react'
import { Input, Button, message } from 'antd'
import { api } from '../api'
import FormatPicker from '../components/FormatPicker'
import type { DownloadFormat, DownloadItemResult, ProgressEvent } from '../../core/types'

const PHASE_LABEL: Record<ProgressEvent['phase'], string> = {
  fetch: '抓取页面',
  images: '下载图片',
  export: '导出格式',
  save: '写入文章库',
  done: '已完成',
  failed: '处理失败',
}

export default function UrlDownload() {
  const [text, setText] = useState('')
  const [formats, setFormats] = useState<DownloadFormat[]>(['md', 'html', 'meta'])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [items, setItems] = useState<DownloadItemResult[]>([])

  useEffect(() => {
    api.getSettings().then((s) => setFormats(s.defaultFormats)).catch(() => {})
    const off = api.onDownloadProgress(setProgress)
    return off
  }, [])

  const urlCount = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length

  const start = async () => {
    const urls = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (!urls.length) { message.warning('请粘贴至少一个文章链接'); return }
    if (!formats.length) { message.warning('请至少选择一种格式'); return }
    setRunning(true); setItems([]); setProgress(null)
    try {
      const summary = await api.download(urls, formats)
      setItems(summary.items)
      message.success(`完成 · 成功 ${summary.succeeded}，跳过 ${summary.skipped}，失败 ${summary.failed}`)
    } catch (e) {
      message.error('下载出错：' + (e as Error).message)
    } finally {
      setRunning(false); setProgress(null)
    }
  }

  const pct = progress ? Math.round((progress.completed / Math.max(progress.total, 1)) * 100) : 0

  return (
    <div className="page">
      <div className="page-narrow fade-in">
        <div className="page-head">
          <div className="eyebrow">Download</div>
          <h1 className="page-title">下载文章</h1>
          <p className="page-sub">粘贴微信公众号文章链接，下载为可永久保存的多种格式。每行一个链接，支持批量。</p>
        </div>

        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://mp.weixin.qq.com/s/..."
          autoSize={{ minRows: 4, maxRows: 12 }}
          disabled={running}
          style={{ fontSize: 14, background: 'var(--paper-raised)' }}
        />

        <div style={{ margin: '24px 0 10px', fontWeight: 600, fontSize: 15 }}>保存为</div>
        <FormatPicker value={formats} onChange={setFormats} disabled={running} />

        <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button type="primary" size="large" loading={running} onClick={start}
            data-testid="start-download" style={{ paddingInline: 32 }}>
            {running ? '下载中…' : '开始下载'}
          </Button>
          {urlCount > 0 && !running && <span className="faint">{urlCount} 个链接待处理</span>}
        </div>

        {running && progress && (
          <div className="surface progress-card fade-in" style={{ marginTop: 28 }}>
            <div className="progress-head">
              <span className="progress-phase">{PHASE_LABEL[progress.phase]}</span>
              <span className="progress-count">{progress.completed} / {progress.total}</span>
            </div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
            {progress.currentUrl && <div className="progress-current">{progress.currentUrl}</div>}
          </div>
        )}

        {items.length > 0 && (
          <div className="surface fade-in" style={{ marginTop: 28, padding: '6px 20px' }}>
            <div className="result-list">
              {items.map((it, i) => (
                <div className="result-row" key={i}>
                  <span className="result-url">{it.url}</span>
                  {it.skipped ? (
                    <span className="badge badge-skip">已存在</span>
                  ) : it.ok ? (
                    <span className="badge badge-ok" data-testid="result-ok">已保存</span>
                  ) : (
                    <span className="badge badge-fail" title={it.error?.message}>失败</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
