import { useState } from 'react'
import { Input, Button, Select, InputNumber, Checkbox, Table, Tag, Typography, message } from 'antd'
import { api } from '../../api'

const { Text } = Typography

interface UserItem { uid: string; name: string; intro: string; homeUrl: string }
interface NoteItem {
  noteId: string; title: string; brief: string; url: string
  publicAt: number | null; withFee: boolean; withImage: boolean; withText: boolean
  wordCount: number | null; viewCount: number | null; favorCount: number | null
}

// 「墨问笔记」tab（M61 R2a）：搜用户 → 条件拉清单 → 勾选批量下载。
// 下载走现有 download 通道（mowen URL 在 downloadArticle 路由），进度/历史/结果区全部复用。
// mocli 未装：顶部指引条（不灰死整页，PRD R3 降级语义）。
export default function MowenMode({ onDone }: { onDone: () => void }) {
  const [keyword, setKeyword] = useState('')
  const [users, setUsers] = useState<UserItem[] | null>(null)
  const [user, setUser] = useState<UserItem | null>(null)
  const [filter, setFilter] = useState('all')
  const [recent, setRecent] = useState<string | undefined>('7d')
  const [count, setCount] = useState(20)
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [expandRefs, setExpandRefs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [mocliMissing, setMocliMissing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handle = (r: { ok: boolean; error?: { code: string; message: string } }): boolean => {
    if (r.ok) { setMocliMissing(false); setErrorMsg(''); return true }
    if (r.error?.code === 'MOCLI_NOT_FOUND') setMocliMissing(true)
    else setErrorMsg(r.error?.message ?? '请求失败')
    return false
  }

  const search = async () => {
    if (!keyword.trim()) { message.warning('输入要搜索的用户名'); return }
    setLoading(true)
    try {
      const r = await api.mowenSearchUsers(keyword.trim())
      if (!handle(r)) return
      setUsers(r.users ?? [])
      setUser(null); setNotes([]); setChecked(new Set())
      if (!r.users?.length) message.info('没有匹配的用户')
    } finally { setLoading(false) }
  }

  const listNotes = async (u: UserItem) => {
    setLoading(true)
    try {
      const r = await api.mowenListUserNotes(u.uid, { filter, recent, count })
      if (!handle(r)) return
      setNotes(r.notes ?? [])
      // 默认全选；「文库已有」此处未知（下载时判重跳过并如实标注），付费笔记默认不选
      setChecked(new Set((r.notes ?? []).filter((n) => !n.withFee).map((n) => n.noteId)))
      setExpandRefs(new Set())
    } finally { setLoading(false) }
  }

  const pickUser = (u: UserItem) => {
    setUser(u)
    void listNotes(u)
  }

  const toggle = (id: string) => {
    setChecked((s) => { const n = new Set(s); if (n.has(id)) { n.delete(id) } else { n.add(id) } return n })
  }
  const toggleExpand = (id: string) => {
    setExpandRefs((s) => { const n = new Set(s); if (n.has(id)) { n.delete(id) } else { n.add(id) } return n })
  }

  const downloadChecked = async () => {
    const ids = notes.filter((n) => checked.has(n.noteId))
    if (!ids.length) { message.warning('先勾选要下载的笔记'); return }
    setLoading(true)
    try {
      const r = await api.download(
        ids.map((n) => n.url),
        (await api.getSettings()).defaultFormats,
      )
      const failed = r.failed
      const unavail = r.unavailable ?? 0
      const msg = unavail
        ? `已提交 ${r.total} 篇下载（${unavail} 篇不可匿名获取（付费/私密），详见下载历史）`
        : `已提交 ${r.total} 篇下载${failed ? `（${failed} 篇失败，详见下载历史）` : ''}`
      message.success(msg)
      onDone()
    } catch (e) { message.error('下载失败：' + (e as Error).message) }
    finally { setLoading(false) }
  }

  const fmtTime = (sec: number | null) => {
    if (sec == null) return '—'
    const d = new Date(sec * 1000)
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  return (
    <div data-testid="mowen-mode">
      {mocliMissing && (
        <div className="setting-hint" data-testid="mowen-tab-missing" style={{ marginBottom: 12 }}>
          未检测到 mocli。请先安装并认证：<code>npm install -g @mowenxd/cli</code>；<code>mocli auth init</code>（API Key 在墨问小程序「我的 → 开发者」获取）。详见设置页「墨问集成」。
        </div>
      )}
      {errorMsg && <div className="setting-hint" style={{ color: 'var(--cinnabar)', marginBottom: 12 }} data-testid="mowen-tab-error">{errorMsg}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input.Search data-testid="mowen-search-input" placeholder="按用户名/简介模糊搜索墨问用户"
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
          onSearch={search} loading={loading} style={{ maxWidth: 420 }} enterButton="搜用户" />
      </div>

      {users && users.length > 0 && (
        <div style={{ margin: '12px 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {users.map((u) => (
            <Button key={u.uid} size="small" type={user?.uid === u.uid ? 'primary' : 'default'}
              data-testid="mowen-user-item" title={u.intro}
              onClick={() => pickUser(u)}>
              {u.name}
            </Button>
          ))}
        </div>
      )}

      {user && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
            <Text strong>「{user.name}」的笔记</Text>
            <Select value={filter} onChange={(v) => setFilter(v)} style={{ width: 100 }} data-testid="mowen-filter"
              options={[{ value: 'all', label: '全部' }, { value: 'album', label: '合集' }, { value: 'fee', label: '付费' }, { value: 'popular', label: '热门' }]} />
            <Select value={recent} onChange={(v) => setRecent(v)} allowClear placeholder='不限时间' style={{ width: 110 }} data-testid="mowen-recent"
              options={[{ value: '24h', label: '24 小时' }, { value: '3d', label: '3 天' }, { value: '7d', label: '7 天' }, { value: '15d', label: '15 天' }]} />
            <InputNumber min={1} max={100} value={count} onChange={(v) => setCount(v ?? 20)} data-testid="mowen-count" />
            <Button size="small" onClick={() => listNotes(user)} loading={loading}>刷新清单</Button>
            <span style={{ flex: 1 }} />
            <Button type="primary" size="small" data-testid="mowen-download"
              disabled={checked.size === 0 || loading} onClick={downloadChecked}
              loading={loading}>
              下载选中（{checked.size}）
            </Button>
          </div>

          <Table<NoteItem>
            size="small" rowKey="noteId" dataSource={notes} loading={loading}
            pagination={{ pageSize: 10 }}
            rowSelection={{
              selectedRowKeys: [...checked],
              onSelect: (rec) => toggle(rec.noteId),
              onSelectAll: (selected, _rows, changeRows) => setChecked((s) => {
                const n = new Set(s)
                for (const row of changeRows) {
                  if (selected) { n.add(row.noteId) } else { n.delete(row.noteId) }
                }
                return n
              }),
            }}
            columns={[
              {
                title: '标题', dataIndex: 'title', ellipsis: true,
                render: (_v, rec) => (
                  <span>
                    {rec.withFee && <Tag color="gold" data-testid="mowen-tag-fee">付费</Tag>}
                    <Text>{rec.title || '(无标题)'}</Text>
                  </span>
                ),
              },
              { title: '发表', width: 110, render: (_v, rec) => fmtTime(rec.publicAt) },
              { title: '字数', width: 80, render: (_v, rec) => rec.wordCount ?? '—' },
              {
                title: '下载', width: 170,
                render: (_v, rec) => (
                  <Checkbox checked={expandRefs.has(rec.noteId)} disabled={!checked.has(rec.noteId)}
                    onChange={() => toggleExpand(rec.noteId)} data-testid="mowen-expand-refs">
                    含引用子笔记
                  </Checkbox>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  )
}
