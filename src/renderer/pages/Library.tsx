import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input, Select, Segmented, Spin, Popconfirm, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import ArticleCard from '../components/ArticleCard'
import ArticleRow from '../components/ArticleRow'
import {
  accountsOf, filterByAccount, sortArticles, groupByAccount,
  type SortKey, type SortDir,
} from '../library-view'
import { buildListColumns, clampColWidth, nextSort, DEFAULT_LIST_WIDTHS } from '../list-columns'
import type { ListColumnWidths } from '../../../electron/services/settings'
import type { ArticleMeta } from '../../core/types'

const SORT_LABEL: Record<SortKey, string> = { download: '下载时间', publish: '发布时间', title: '标题' }

export default function Library() {
  const [kw, setKw] = useState('')
  const [all, setAll] = useState<ArticleMeta[]>([])
  const [root, setRoot] = useState('')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'card' | 'list'>('card')
  const [grouped, setGrouped] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('download')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [account, setAccount] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<ListColumnWidths>(DEFAULT_LIST_WIDTHS)
  const widthsRef = useRef(widths)
  useEffect(() => { widthsRef.current = widths }, [widths])
  const nav = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const [list, s] = await Promise.all([api.libraryList(), api.getSettings()])
      setAll(list); setRoot(s.libraryRoot); setWidths(s.listColumnWidths ?? DEFAULT_LIST_WIDTHS)
    } catch (e) {
      message.error('加载失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const accounts = useMemo(() => accountsOf(all), [all])
  // 搜索（标题，即时）→ 公众号筛选 → 排序 → 分组
  const groups = useMemo(() => {
    const k = kw.trim()
    const searched = k ? all.filter((m) => m.title.includes(k)) : all
    const sorted = sortArticles(filterByAccount(searched, account), sortKey, sortDir)
    return grouped ? groupByAccount(sorted) : [{ account: '', items: sorted }]
  }, [all, kw, account, sortKey, sortDir, grouped])

  const visibleIds = useMemo(() => groups.flatMap((g) => g.items.map((m) => m.id)), [groups])

  const toggleSel = (id: string) => setSel((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n
  })
  const selectAll = () => setSel(new Set(visibleIds))
  const clearSel = () => setSel(new Set())
  const toggleCollapse = (acc: string) => setCollapsed((s) => {
    const n = new Set(s); if (n.has(acc)) n.delete(acc); else n.add(acc); return n
  })

  const onHeaderSort = (k: SortKey) => {
    const n = nextSort({ key: sortKey, dir: sortDir }, k)
    setSortKey(n.key); setSortDir(n.dir)
  }
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')
  const startResize = (key: keyof ListColumnWidths, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = widths[key]
    const onMove = (ev: MouseEvent) => setWidths((w) => ({ ...w, [key]: clampColWidth(startW + ev.clientX - startX) }))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      api.saveSettings({ listColumnWidths: widthsRef.current })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const read = (id: string) => nav(`/reader/${encodeURIComponent(id)}`)
  const delSingle = async (id: string) => {
    try { await api.libraryRemove(id); message.success('已删除'); setSel((s) => { const n = new Set(s); n.delete(id); return n }); await load() }
    catch (e) { message.error('删除失败：' + (e as Error).message) }
  }
  const batchDelete = async () => {
    const ids = [...sel]
    try { await api.libraryRemoveMany(ids); message.success(`已删除 ${ids.length} 篇`); clearSel(); await load() }
    catch (e) { message.error('批量删除失败：' + (e as Error).message) }
  }

  const renderCards = (items: ArticleMeta[]) => (
    <div className="shelf">
      {items.map((m, i) => (
        <ArticleCard key={m.id} meta={m} libraryRoot={root} index={i} selected={sel.has(m.id)}
          onToggleSelect={() => toggleSel(m.id)} onRead={() => read(m.id)}
          onReveal={() => api.reveal(m.dir)} onDelete={() => delSingle(m.id)} />
      ))}
    </div>
  )
  const renderRows = (items: ArticleMeta[], showAccount: boolean) => items.map((m) => (
    <ArticleRow key={m.id} meta={m} selected={sel.has(m.id)} showAccount={showAccount}
      onToggleSelect={() => toggleSel(m.id)} onRead={() => read(m.id)}
      onReveal={() => api.reveal(m.dir)} onDelete={() => delSingle(m.id)} />
  ))

  return (
    <div className="page">
      <div className="fade-in">
        <div className="page-head">
          <div className="eyebrow">Library</div>
          <h1 className="page-title">文库 {all.length > 0 && <span className="faint" style={{ fontSize: 18, fontFamily: 'var(--font-sans)', fontWeight: 400 }}>· {all.length} 篇</span>}</h1>
        </div>

        {/* 工具栏 */}
        <div className="lib-toolbar">
          <Input allowClear placeholder="按标题搜索" value={kw} onChange={(e) => setKw(e.target.value)}
            style={{ width: 240 }} prefix={<span className="faint">🔍</span>} />
          <div style={{ flex: 1 }} />
          {view === 'card' && <>
            <span className="tb-label">排序</span>
            <span data-testid="sort-select"><Select size="middle" value={sortKey} onChange={(v) => setSortKey(v)} style={{ width: 116 }}
              options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ value: k, label: SORT_LABEL[k] }))} /></span>
            <button className="tb-dir" data-testid="sort-dir" title={sortDir === 'desc' ? '降序' : '升序'}
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}>{sortDir === 'desc' ? '↓' : '↑'}</button>
          </>}
          <span data-testid="account-select"><Select size="middle" value={account ?? '__all'} onChange={(v) => setAccount(v === '__all' ? null : v)}
            style={{ width: 150 }} options={[{ value: '__all', label: '全部公众号' }, ...accounts.map((a) => ({ value: a, label: a }))]} /></span>
          <button className={`tb-toggle${grouped ? ' on' : ''}`} data-testid="group-toggle" onClick={() => setGrouped((g) => !g)}>⊟ 分组</button>
          <Segmented value={view} onChange={(v) => setView(v as 'card' | 'list')}
            options={[{ label: '卡片', value: 'card' }, { label: '列表', value: 'list' }]} />
        </div>

        {/* 批量操作条：portal 到 body，钉在视口底（避开 .fade-in 的 transform 包含块，不随内容滚走） */}
        {sel.size > 0 && createPortal(
          <div className="selbar">
            <span className="n">已选 {sel.size} 篇</span>
            <a onClick={selectAll}>全选</a><a onClick={clearSel}>清除</a>
            <Popconfirm title={`删除选中的 ${sel.size} 篇？`} description="磁盘文件将一并删除，不可恢复。"
              okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={batchDelete}>
              <span className="del" data-testid="batch-delete">🗑 批量删除</span>
            </Popconfirm>
          </div>, document.body,
        )}

        {loading ? (
          <div style={{ padding: 80, textAlign: 'center' }}><Spin /></div>
        ) : visibleIds.length === 0 ? (
          <div className="empty-state">
            <div className="es-mark">藏</div>
            <div className="es-title">{kw || account ? '没有匹配的文章' : '文库还是空的'}</div>
            <div>{kw || account ? '换个条件试试' : '到「下载」页粘贴链接或按公众号抓取，保存的文章会陈列在这里'}</div>
          </div>
        ) : view === 'list' ? (
          /* ---- 列表视图：列头只一次，分组时各组只留分隔头（且去掉冗余的公众号列）---- */
          <div className={`list${grouped ? ' grouped' : ''}`} style={{ ['--lcols' as string]: buildListColumns(widths, grouped) }}>
            <div className="lhead">
              <span></span>
              <span className="lh-sort" onClick={() => onHeaderSort('title')}>标题{arrow('title')}</span>
              {!grouped && (
                <span className="lh-resz">公众号<i className="rz" onMouseDown={(e) => startResize('account', e)} /></span>
              )}
              <span className="lh-sort lh-resz" onClick={() => onHeaderSort('publish')}>
                发布时间{arrow('publish')}<i className="rz" onMouseDown={(e) => startResize('publish', e)} />
              </span>
              <span className="lh-sort lh-resz" onClick={() => onHeaderSort('download')}>
                下载时间{arrow('download')}<i className="rz" onMouseDown={(e) => startResize('download', e)} />
              </span>
              <span style={{ textAlign: 'right' }}>操作</span>
            </div>
            {grouped ? groups.map((g) => {
              const col = collapsed.has(g.account)
              return (
                <div key={g.account}>
                  <div className="lgrp-head" onClick={() => toggleCollapse(g.account)}>
                    <span className={`gcaret${col ? ' col' : ''}`}>▼</span>
                    <span className="gseal">{g.account.slice(0, 1)}</span>
                    <span className="gname">{g.account}</span><span className="gcount">{g.items.length} 篇</span>
                  </div>
                  {!col && renderRows(g.items, false)}
                </div>
              )
            }) : renderRows(groups[0].items, true)}
          </div>
        ) : (
          /* ---- 卡片视图 ---- */
          grouped ? groups.map((g) => {
            const col = collapsed.has(g.account)
            return (
              <div className="group" key={g.account}>
                <div className="ghead" onClick={() => toggleCollapse(g.account)}>
                  <span className={`gcaret${col ? ' col' : ''}`}>▼</span>
                  <span className="gseal">{g.account.slice(0, 1)}</span>
                  <span className="gname">{g.account}</span><span className="gcount">{g.items.length} 篇</span>
                  <span className="gline" />
                </div>
                {!col && renderCards(g.items)}
              </div>
            )
          }) : renderCards(groups[0].items)
        )}
      </div>
    </div>
  )
}
