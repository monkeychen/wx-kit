import { useState } from 'react'
import UrlMode from '../components/download/UrlMode'
import DownloadHistory from '../components/download/DownloadHistory'
import type { HistoryEvent } from '../api'
import type { CrawlRangeInput } from '../api'
import type { DownloadFormat } from '../../core/types'
import type { MpAccount } from '../../core/mp-types'

export type UrlPrefill = { nonce: number; text: string; formats: DownloadFormat[] }
// M49 保留休眠的 AccountMode 类型契约，旧实现继续 typecheck，但不进入当前页面。
export type AccountPrefill = { nonce: number; account: MpAccount; range: CrawlRangeInput; formats: DownloadFormat[] }

// M49：下载页只保留按链接下载；公众号模式实现留在源码中，但不再提供用户入口。
export default function Download() {
  const [reloadKey, setReloadKey] = useState(0)
  const [urlPrefill, setUrlPrefill] = useState<UrlPrefill | undefined>()

  const onDone = () => setReloadKey((k) => k + 1)

  const onAgain = (ev: HistoryEvent) => {
    if (ev.source.kind !== 'url') return
    const nonce = Date.now()
    setUrlPrefill({ nonce, text: ev.items.map((i) => i.url).join('\n'), formats: ev.formats })
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
