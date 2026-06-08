import { useState } from 'react'
import UrlMode from '../components/download/UrlMode'
import AccountMode from '../components/download/AccountMode'

type Mode = 'url' | 'account'

// 「下载」页容器：统一刊头 + 模式页签，下方按模式渲染两个视图。
// 链接下载与公众号下载本质都是下载，只是入口不同——共用「保存为/进度/结果」区。
export default function Download() {
  const [mode, setMode] = useState<Mode>('url')
  return (
    <div className="page">
      <div className="page-narrow fade-in">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div className="eyebrow">Download</div>
          <h1 className="page-title">下载文章</h1>
        </div>
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
        {mode === 'url' ? <UrlMode /> : <AccountMode />}
      </div>
    </div>
  )
}
