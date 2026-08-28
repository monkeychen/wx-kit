import { useState } from 'react'
import UrlMode from '../components/download/UrlMode'
import DownloadHistory from '../components/download/DownloadHistory'
import type { HistoryEvent } from '../api'
import type { DownloadFormat } from '../../core/types'

export type UrlPrefill = { nonce: number; text: string; formats: DownloadFormat[] }

// 「下载」页容器：单一模式（按链接下载），下方是常驻的下载历史。
// v0.10.0 边界（2026-08-28）：微信读书列表接口被服务端按账号封禁，批量下载历史无解，
// 「按公众号下载」入口已按决策移除（见 AGENTS.md 与 docs/plans/2026-08-28-v0.10.0-scope-tighten.md）。
// 历史里的旧公众号事件的「照此再下」改为回填该批文章 URL——链接下载不依赖登录态，永远可用。
export default function Download() {
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
        <UrlMode onDone={onDone} prefill={urlPrefill} />
        <DownloadHistory reloadKey={reloadKey} onAgain={onAgain} />
      </div>
    </div>
  )
}
