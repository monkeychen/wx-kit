import { useEffect, useState } from 'react'
import { Input, Spin, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import ArticleCard from '../components/ArticleCard'
import type { ArticleMeta } from '../../core/types'

export default function Library() {
  const [kw, setKw] = useState('')
  const [rows, setRows] = useState<ArticleMeta[]>([])
  const [root, setRoot] = useState('')
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  const load = async (keyword = '') => {
    setLoading(true)
    try {
      const [list, s] = await Promise.all([
        keyword ? api.librarySearch(keyword) : api.libraryList(),
        api.getSettings(),
      ])
      setRows(list)
      setRoot(s.libraryRoot)
    } catch (e) {
      message.error('加载失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const del = async (id: string) => {
    try { await api.libraryRemove(id); message.success('已删除'); load(kw) }
    catch (e) { message.error('删除失败：' + (e as Error).message) }
  }

  return (
    <div className="page">
      <div className="fade-in">
        <div className="page-head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Library</div>
            <h1 className="page-title">文库 {rows.length > 0 && <span className="faint" style={{ fontSize: 18, fontFamily: 'var(--font-sans)', fontWeight: 400 }}>· {rows.length} 篇</span>}</h1>
          </div>
          <Input.Search allowClear placeholder="按标题搜索"
            value={kw} onChange={(e) => setKw(e.target.value)} onSearch={(v) => load(v)}
            style={{ maxWidth: 300 }} />
        </div>

        {loading ? (
          <div style={{ padding: 80, textAlign: 'center' }}><Spin /></div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="es-mark">藏</div>
            <div className="es-title">{kw ? '没有匹配的文章' : '文库还是空的'}</div>
            <div>{kw ? '换个关键词试试' : '到「下载」页粘贴链接或按公众号抓取，保存的文章会陈列在这里'}</div>
          </div>
        ) : (
          <div className="shelf">
            {rows.map((m, i) => (
              <ArticleCard key={m.id} meta={m} libraryRoot={root} index={i}
                onRead={() => nav(`/reader/${encodeURIComponent(m.id)}`)}
                onReveal={() => api.reveal(m.dir)}
                onDelete={() => del(m.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
