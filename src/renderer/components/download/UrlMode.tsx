import { useEffect, useState } from 'react'
import { Input, message } from 'antd'
import { api } from '../../api'
import FormatPicker from '../FormatPicker'
import type { DownloadFormat, ProgressEvent } from '../../../core/types'
import type { UrlPrefill } from '../../pages/Download'

const PHASE_LABEL: Record<ProgressEvent['phase'], string> = {
  fetch: '抓取页面',
  images: '下载图片',
  export: '导出格式',
  save: '写入文章库',
  done: '已完成',
  failed: '处理失败',
}

interface Props {
  onDone: () => void
  prefill?: UrlPrefill
}

export default function UrlMode({ onDone, prefill }: Props) {
  const [text, setText] = useState('')
  const [formats, setFormats] = useState<DownloadFormat[]>(['md', 'html', 'meta'])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => setFormats(s.defaultFormats)).catch(() => {})
    const off = api.onDownloadProgress(setProgress)
    return off
  }, [])

  // 「照此再下」回填
  useEffect(() => {
    if (prefill) { setText(prefill.text); setFormats(prefill.formats) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce])

  const urlCount = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length

  const start = async () => {
    const urls = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (!urls.length) { message.warning('请粘贴至少一个文章链接'); return }
    if (!formats.length) { message.warning('请至少选择一种格式'); return }
    setRunning(true); setProgress(null)
    try {
      const summary = await api.download(urls, formats)
      message.success(`完成 · 成功 ${summary.succeeded}，跳过 ${summary.skipped}，失败 ${summary.failed}`)
      onDone()   // 结果进入下方下载历史
    } catch (e) {
      message.error('下载出错：' + (e as Error).message)
    } finally {
      setRunning(false); setProgress(null)
    }
  }

  const pct = progress ? Math.round((progress.completed / Math.max(progress.total, 1)) * 100) : 0

  return (
    <>
      <div className="surface">
        <div className="cfg-sec">
          <p className="sec-label">文章链接</p>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'粘贴微信公众号文章链接，每行一个，支持批量\nhttps://mp.weixin.qq.com/s/...'}
            autoSize={{ minRows: 4, maxRows: 12 }}
            disabled={running}
            style={{ fontSize: 14, background: 'var(--paper)' }}
          />
        </div>
        <div className="cfg-sec">
          <p className="sec-label">保存为</p>
          <FormatPicker value={formats} onChange={setFormats} disabled={running} />
        </div>
        <div className="cfg-foot">
          <button className="cta" disabled={running} onClick={start} data-testid="start-download">
            {running ? '下载中…' : '开始下载'}
          </button>
          {urlCount > 0 && !running && <span className="foot-note">{urlCount} 个链接待处理</span>}
        </div>
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
    </>
  )
}
