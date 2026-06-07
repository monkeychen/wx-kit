import { NavLink, Outlet } from 'react-router-dom'

// 杂志刊头：左品牌、右横向导航。取代 antd 左侧 Sider —— 更像一本刊物的报头，
// 也把纵向空间还给内容。
const NAV = [
  { to: '/', label: '下载', end: true },
  { to: '/batch', label: '批量', end: false },
  { to: '/library', label: '书架', end: false },
  { to: '/settings', label: '设置', end: false },
]

export default function MainLayout() {
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
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  )
}
