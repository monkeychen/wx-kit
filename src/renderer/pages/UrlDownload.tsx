import { useEffect, useState } from 'react'
import { Input, Checkbox, Button, Progress, List, Tag, message } from 'antd'
import { api } from '../api'
import type { DownloadFormat, DownloadItemResult, ProgressEvent } from '../../core/types'

const FORMATS: DownloadFormat[] = ['cover', 'md', 'html', 'pdf', 'meta']

export default function UrlDownload() {
  const [text, setText] = useState('')
  const [formats, setFormats] = useState<DownloadFormat[]>(['md', 'html', 'meta'])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [items, setItems] = useState<DownloadItemResult[]>([])

  useEffect(() => {
    api.getSettings().then(s => setFormats(s.defaultFormats)).catch(() => {})
    const off = api.onDownloadProgress(setProgress)
    return off
  }, [])

  const start = async () => {
    const urls = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    if (!urls.length) { message.warning('请输入至少一个 URL'); return }
    if (!formats.length) { message.warning('请至少选择一种格式'); return }
    setRunning(true); setItems([]); setProgress(null)
    try {
      const summary = await api.download(urls, formats)
      setItems(summary.items)
      message.success(`完成：成功 ${summary.succeeded} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`)
    } catch (e) {
      message.error('下载出错：' + (e as Error).message)
    } finally {
      setRunning(false); setProgress(null)
    }
  }

  const pct = progress ? Math.round((progress.completed / Math.max(progress.total, 1)) * 100) : 0

  return (
    <div className="p-6" style={{ maxWidth: 820 }}>
      <h2>URL 下载</h2>
      <Input.TextArea value={text} onChange={e => setText(e.target.value)}
        placeholder="每行一个微信文章链接" autoSize={{ minRows: 4, maxRows: 10 }} disabled={running} />
      <div className="my-3">
        <Checkbox.Group options={FORMATS.map(f => ({ label: f, value: f }))}
          value={formats} onChange={v => setFormats(v as DownloadFormat[])} disabled={running} />
      </div>
      <Button type="primary" loading={running} onClick={start}>开始下载</Button>

      {running && progress && (
        <div className="mt-4">
          <Progress percent={pct} />
          <div style={{ color: '#888' }}>{progress.phase} · {progress.currentUrl}</div>
        </div>
      )}

      {items.length > 0 && (
        <List className="mt-4" size="small" bordered dataSource={items}
          renderItem={(it) => (
            <List.Item>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.url}</span>
              {it.skipped ? <Tag color="default">已存在</Tag>
                : it.ok ? <Tag color="success">成功</Tag>
                : <Tag color="error">失败：{it.error?.message}</Tag>}
            </List.Item>
          )} />
      )}
    </div>
  )
}
