import { Layout, Menu } from 'antd'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { DownloadOutlined, BookOutlined, SettingOutlined } from '@ant-design/icons'

const items = [
  { key: '/', icon: <DownloadOutlined />, label: <Link to="/">URL 下载</Link> },
  { key: '/library', icon: <BookOutlined />, label: <Link to="/library">文章库</Link> },
  { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">设置</Link> },
]

export default function MainLayout() {
  const { pathname } = useLocation()
  const selected = pathname.startsWith('/library') ? '/library' : pathname.startsWith('/settings') ? '/settings' : '/'
  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Sider theme="light" width={200}>
        <div style={{ padding: 16, fontWeight: 600 }}>wx-kit · 微信百宝箱</div>
        <Menu mode="inline" selectedKeys={[selected]} items={items} />
      </Layout.Sider>
      <Layout.Content style={{ overflow: 'auto', background: '#fff' }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  )
}
