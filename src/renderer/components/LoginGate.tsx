import { useState } from 'react'
import { api } from '../api'
import { useWereadLoginQr } from '../hooks/useWereadLoginQr'

/**
 * 整页登录引导（v0.10.0 微信读书）：未登录时本页只显示这一屏。
 * 扫码窗口从「弹出 BrowserWindow」改为应用内二维码：主进程推进状态机，
 * confirmUrl 推给渲染层自画（useWereadLoginQr）。
 */
export default function LoginGate({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const { qrDataUrl, scanned } = useWereadLoginQr()

  const doLogin = async () => {
    setBusy(true); setErr('')
    const r = await api.mpLogin()
    setBusy(false)
    if (r.ok) onLoggedIn()
    else if (r.code === 'CANCELLED') setErr('已取消登录')
    else if (r.code === 'MP_GOVERNOR_PAUSED' || r.code === 'MP_RATE_LIMITED') {
      setErr((r.error ?? '微信请求已暂停') + '。请先到“设置 → 微信请求保护”查看。')
    } else setErr('登录失败：' + (r.error ?? ''))
  }

  return (
    <div className="empty-state" data-testid="login-gate">
      <div className="es-mark">▣</div>
      <div className="es-title">先登录微信读书</div>
      <div style={{ maxWidth: 360 }}>
        按公众号下载与订阅通过微信读书获取文章列表。用你的微信扫码登录微信读书账号，
        登录态保存在本地，过期前无需重复扫码。
      </div>
      {busy && (
        <div style={{ textAlign: 'center' }} data-testid="login-qr-area">
          {!qrDataUrl && <div className="faint">正在生成二维码…</div>}
          {qrDataUrl && <img src={qrDataUrl} alt="微信读书登录二维码" width={220} height={220} data-testid="login-qr-img" />}
          {scanned && <div className="faint">已扫码，请在手机上确认登录…</div>}
        </div>
      )}
      <div>
        <button className="cta" disabled={busy} onClick={doLogin} data-testid="login-scan">
          {busy ? '等待扫码确认…' : '扫码登录'}
        </button>
        {busy && (
          <button className="card-btn" style={{ marginLeft: 8 }} onClick={() => api.cancelWereadLogin()}>
            取消
          </button>
        )}
      </div>
      {err && <div className="faint" style={{ color: 'var(--cinnabar)' }}>{err}</div>}
    </div>
  )
}
