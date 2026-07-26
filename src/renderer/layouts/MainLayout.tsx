import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api'
import CliLinkPrompt from '../components/CliLinkPrompt'

// 杂志刊头：左品牌、右横向导航。取代 antd 左侧 Sider —— 更像一本刊物的报头，
// 也把纵向空间还给内容。
const NAV = [
  { to: '/', label: '下载', end: true },
  { to: '/subscriptions', label: '订阅', end: false },
  { to: '/library', label: '文库', end: false },
  { to: '/settings', label: '设置', end: false },
]

export default function MainLayout() {
  const [newCount, setNewCount] = useState(0)
  const [hasUpdate, setHasUpdate] = useState(false)
  useEffect(() => {
    const refresh = async () => {
      try { const s = await api.subscriptionsList(); setNewCount(s.accounts.reduce((n, a) => n + a.newRefs.length, 0)) }
      catch { /* 忽略：导航角标不应阻塞渲染 */ }
    }
    refresh()
    return api.onSubscriptionsUpdated(refresh)
  }, [])

  // 启动静默检查(M37):延迟几秒、不阻塞首屏,查不到就当没发生 —— 只在有新版时
  // 于「设置」上点一个小圆点,**不弹窗不 toast**(打断用户是最差的告知方式)。
  useEffect(() => {
    const t = setTimeout(() => {
      api.updateCheck({ silent: true })
        .then((r) => { if (r?.hasUpdate) setHasUpdate(true) })
        .catch(() => { /* 静默失败:更新提示不该给启动流程添噪 */ })
    }, 3000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} data-testid="app-shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand-title">微信百宝箱</span>
          <span className="brand-mark">wx-kit</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              data-testid={`nav-${n.label}`}>
              {n.label}
              {n.to === '/subscriptions' && newCount > 0 && <span className="nav-badge" data-testid="subs-nav-badge">{newCount}</span>}
              {n.to === '/settings' && hasUpdate && (
                <span className="nav-dot" data-testid="update-nav-dot" title="有新版本可用" />
              )}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
      <CliLinkPrompt />
    </div>
  )
}
