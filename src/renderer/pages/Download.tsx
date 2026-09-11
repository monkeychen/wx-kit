import { useState } from 'react'
import { Segmented } from 'antd'
import UrlMode from '../components/download/UrlMode'
import MowenMode from '../components/download/MowenMode'
import DownloadHistory from '../components/download/DownloadHistory'
import type { HistoryEvent } from '../api'
import type { DownloadFormat } from '../../core/types'

export type UrlPrefill = { nonce: number; text: string; formats: DownloadFormat[] }

// 「下载」页容器：链接下载 + 墨问笔记（M61 R2a，Segmented 切换）+ 常驻下载历史。
// 两个模式共用同一条下载通道与历史——mowen URL 在 downloadArticle 顶部路由。
// v0.10.0 边界（2026-08-28）：微信读书列表接口被服务端按账号封禁，批量下载历史无解，
// 「按公众号下载」入口已按决策移除（见 AGENTS.md 与 docs/plans/2026-08-28-v0.10.0-scope-tighten.md）。
export default function Download() {
  const [mode, setMode] = useState<'url' | 'mowen'>('url')
  const [reloadKey, setReloadKey] = useState(0)
  const [urlPrefill, setUrlPrefill] = useState<UrlPrefill | undefined>()

  const onDone = () => setReloadKey((k) => k + 1)

  const onAgain = (ev: HistoryEvent) => {
    setUrlPrefill({
      nonce: Date.now(),
      text: ev.items.map((i) => i.url).join('\n'),
      formats: ev.formats,
    })
  }

  return (
    <div className="page">
      <div className="fade-in">
        <Segmented value={mode} onChange={(v) => setMode(v as 'url' | 'mowen')} style={{ marginBottom: 12 }}
          data-testid="download-mode-segmented"
          options={[{ label: '按链接下载', value: 'url' }, { label: '墨问笔记', value: 'mowen' }]} />
        {mode === 'url'
          ? <UrlMode onDone={onDone} prefill={urlPrefill} />
          : <MowenMode onDone={onDone} />}
        <DownloadHistory reloadKey={reloadKey} onAgain={onAgain} />
      </div>
    </div>
  )
}
