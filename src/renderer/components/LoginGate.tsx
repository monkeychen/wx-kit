import { useState } from 'react'
import { api } from '../api'

/** 整页登录引导：未登录时本页只显示这一屏。 */
export default function LoginGate({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const doLogin = async () => {
    setBusy(true); setErr('')
    const r = await api.mpLogin()
    setBusy(false)
    if (r.ok) onLoggedIn()
    else setErr(r.error === 'CANCELLED' ? '已取消登录' : '登录失败：' + (r.error ?? ''))
  }
  return (
    <div className="empty-state" data-testid="login-gate">
      <div className="es-mark">▣</div>
      <div className="es-title">先登录公众号后台</div>
      <div style={{ maxWidth: 360 }}>批量爬取需要用你的公众号管理员身份扫码登录 mp.weixin.qq.com。登录态保存在本地，过期前无需重复扫码。</div>
      <button className="cta" disabled={busy} onClick={doLogin} data-testid="login-scan">
        {busy ? '请在弹出窗口扫码…' : '扫码登录'}
      </button>
      {err && <div className="faint" style={{ color: 'var(--cinnabar)' }}>{err}</div>}
    </div>
  )
}
