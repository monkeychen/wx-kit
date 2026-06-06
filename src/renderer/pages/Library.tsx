import { useEffect, useState } from 'react'
import { Input, Table, Tag, Space, Button, Popconfirm, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { ArticleMeta } from '../../core/types'

export default function Library() {
  const [kw, setKw] = useState('')
  const [rows, setRows] = useState<ArticleMeta[]>([])
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()

  const load = async (keyword = '') => {
    setLoading(true)
    try { setRows(keyword ? await api.librarySearch(keyword) : await api.libraryList()) }
    catch (e) { message.error('加载失败：' + (e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const del = async (id: string) => {
    try { await api.libraryRemove(id); message.success('已删除'); load(kw) }
    catch (e) { message.error('删除失败：' + (e as Error).message) }
  }

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: '公众号', dataIndex: 'account', key: 'account', width: 140 },
    { title: '发布', dataIndex: 'publishTime', key: 'publishTime', width: 160 },
    { title: '下载', dataIndex: 'downloadTime', key: 'downloadTime', width: 180,
      render: (t: string) => (t ? new Date(t).toLocaleString() : '') },
    { title: '格式', dataIndex: 'formats', key: 'formats', width: 200,
      render: (fs: string[]) => fs.map(f => <Tag key={f}>{f}</Tag>) },
    { title: '操作', key: 'op', width: 240, render: (_: unknown, r: ArticleMeta) => (
      <Space>
        <Button size="small" disabled={!r.formats.includes('md') && !r.formats.includes('html')}
          onClick={() => nav(`/reader/${encodeURIComponent(r.id)}`)}>阅读</Button>
        <Button size="small" onClick={() => api.reveal(r.dir)}>文件夹</Button>
        <Popconfirm title="删除该文章？将同时删除磁盘文件" okText="删除" cancelText="取消" onConfirm={() => del(r.id)}>
          <Button size="small" danger>删除</Button>
        </Popconfirm>
      </Space>
    ) },
  ]

  return (
    <div className="p-6">
      <h2>文章库</h2>
      <Input.Search className="mb-3" allowClear placeholder="按标题搜索"
        value={kw} onChange={e => setKw(e.target.value)} onSearch={(v) => load(v)} style={{ maxWidth: 360 }} />
      <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} size="middle" pagination={{ pageSize: 20 }} />
    </div>
  )
}
