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
  const [ver, setVer] = useState('')
  useEffect(() => { api.appVersion().then(setVer).catch(() => { /* 版本号缺失不应影响使用 */ }) }, [])
  useEffect(() => {
    const refresh = async () => {
      try { const s = await api.subscriptionsList(); setNewCount(s.accounts.reduce((n, a) => n + a.newRefs.length, 0)) }
      catch { /* 忽略：导航角标不应阻塞渲染 */ }
    }
    refresh()
    return api.onSubscriptionsUpdated(refresh)
  }, [])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} data-testid="app-shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand-title">微信百宝箱</span>
          <span className="brand-mark">wx-kit</span>
          {ver && <span className="brand-ver" data-testid="brand-version">v{ver}</span>}
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              data-testid={`nav-${n.label}`}>
              {n.label}
              {n.to === '/subscriptions' && newCount > 0 && <span className="nav-badge" data-testid="subs-nav-badge">{newCount}</span>}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
      <CliLinkPrompt />
    </div>
  )
}
