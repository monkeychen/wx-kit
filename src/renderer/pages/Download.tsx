import { useState } from 'react'
import UrlMode from '../components/download/UrlMode'
import AccountMode from '../components/download/AccountMode'
import DownloadHistory from '../components/download/DownloadHistory'
import type { HistoryEvent } from '../api'
import type { CrawlRangeInput } from '../api'
import type { DownloadFormat } from '../../core/types'
import type { MpAccount } from '../../core/mp-types'

type Mode = 'url' | 'account'

export type UrlPrefill = { nonce: number; text: string; formats: DownloadFormat[] }
export type AccountPrefill = { nonce: number; account: MpAccount; range: CrawlRangeInput; formats: DownloadFormat[] }

// 「下载」页容器：统一模式页签，下方按模式渲染配置卡，再下是常驻的下载历史。
// 协调两件事：① 下载完成 bump reloadKey 让历史刷新并展开顶条；② 「照此再下」把
// 某次 event 的来源+格式回填到对应模式的配置卡。
export default function Download() {
  const [mode, setMode] = useState<Mode>('url')
  const [reloadKey, setReloadKey] = useState(0)
  const [urlPrefill, setUrlPrefill] = useState<UrlPrefill | undefined>()
  const [accountPrefill, setAccountPrefill] = useState<AccountPrefill | undefined>()

  const onDone = () => setReloadKey((k) => k + 1)

  const onAgain = (ev: HistoryEvent) => {
    const nonce = Date.now()
    if (ev.source.kind === 'url') {
      setMode('url')
      setUrlPrefill({ nonce, text: ev.items.map((i) => i.url).join('\n'), formats: ev.formats })
    } else {
      const r = ev.source.range
      const range: CrawlRangeInput = 'count' in r ? { count: r.count } : { from: r.from, to: r.to }
      setMode('account')
      setAccountPrefill({
        nonce,
        account: { fakeid: ev.source.fakeid, nickname: ev.source.nickname, alias: '', signature: '' },
        range, formats: ev.formats,
      })
    }
  }

  return (
    <div className="page">
      <div className="fade-in">
        <div className="mode-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'url'} data-testid="mode-url"
            className={`mode-tab${mode === 'url' ? ' on' : ''}`} onClick={() => setMode('url')}>
            按链接下载
          </button>
          <button role="tab" aria-selected={mode === 'account'} data-testid="mode-account"
            className={`mode-tab${mode === 'account' ? ' on' : ''}`} onClick={() => setMode('account')}>
            按公众号下载
          </button>
        </div>

        {mode === 'url'
          ? <UrlMode onDone={onDone} prefill={urlPrefill} />
          : <AccountMode onDone={onDone} prefill={accountPrefill} />}

        <DownloadHistory reloadKey={reloadKey} onAgain={onAgain} />
      </div>
    </div>
  )
}
