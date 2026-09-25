// src/renderer/components/subscription/MowenPanel.tsx
// 墨问作者订阅面板（M63 R4a；安哥实测反馈后按微信面板范式全面对齐——2026-09-14）：
// 行内功能与交互与「公众号」tab 完全一致——订阅开关（取消订阅≠删除）、行内检查、文库入口、
// 本轮检查文章清单（逐篇勾选/单篇下载/直开阅读器）、行内落盘摘要、检查记录明细弹窗。
// 数据源与微信同构：检查明细走 checkLog 的 downloadDetail（fakeid 字段=uid，subscription-view
// 工具直接复用）；主键 mowen_<noteId> 确定性，articleId 由编排回填、直开阅读器无需反查。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Checkbox, Input, List, Modal, Popconfirm, Spin, Switch, Tag, message } from 'antd'
import { DeleteOutlined, LoadingOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { MowenSubscribedAuthor, MowenUser, CheckLogEntry, MowenCheckResult } from '../../api'
import {
  latestResultByAccount, latestItemsForAccount, summaryPhrase, triggerLabel, formatShortTime, itemStatusTag, detailModalTitle,
} from '../../subscription-view'

/** 收起时选择即全部——与微信面板同一「行内动作只有一个含义」的语义（防并列两套按钮）。 */
const pendingOf = (a: MowenSubscribedAuthor) => a.newNotes.filter((n) => n.status === 'pending')

const RESULT_TTL_MS = 4000

type PerAuthorResult = MowenCheckResult['results'][number]

export default function MowenPanel() {
  const navigate = useNavigate()
  const { pathname } = useLocation() // 阅读器「返回」的来源标记（本面板挂在订阅页路由下）
  const [authors, setAuthors] = useState<MowenSubscribedAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [mocliMissing, setMocliMissing] = useState(false)
  const [kw, setKw] = useState('')
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<MowenUser[]>([])
  const [checkingAll, setCheckingAll] = useState(false)
  // 行内单作者检查的状态按 uid 记（与微信 checkingIds 同规：点任一行「检查」不牵动整页）
  const [checkingIds, setCheckingIds] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [checkLog, setCheckLog] = useState<CheckLogEntry[]>([])
  // 行内结果态：成功几秒后淡出、失败留着（与微信 applyResults 同规）
  const [rowRes, setRowRes] = useState<Record<string, PerAuthorResult>>({})

  const load = async () => {
    try {
      const s = await api.mowenSubsList()
      setAuthors(s.authors)
      setCheckLog(s.checkLog ?? [])   // 墨问自己的检查日志（独立文件，不再从微信列表过滤）
    } catch (e) {
      message.error('加载订阅失败：' + (e as Error).message)
    } finally { setLoading(false) }
  }
  useEffect(() => { load(); return api.onMowenSubsUpdated(load) }, [])

  // 初始只看缓存结论（M60 启动检测写 settings），不主动触发重检——装没装是低频事实
  useEffect(() => {
    void api.mowenDetect().then((d) => setMocliMissing(!d.installed))
  }, [])

  // 行内摘要落盘派生（单一数据源），与微信 M56 同规
  const latestByAuthor = useMemo(() => latestResultByAccount(checkLog), [checkLog])

  const applyResults = (r: MowenCheckResult) => {
    if (!r.results.length) return
    setRowRes((prev) => ({ ...prev, ...Object.fromEntries(r.results.map((x) => [x.uid, x])) }))
    const okIds = r.results.filter((x) => x.ok).map((x) => x.uid)
    if (okIds.length) setTimeout(() => setRowRes((prev) => {
      const next = { ...prev }; for (const id of okIds) delete next[id]; return next
    }), RESULT_TTL_MS)
  }

  const search = async () => {
    const k = kw.trim()
    if (!k) { message.warning('先输入作者名字'); return }
    setSearching(true)
    try {
      const r = await api.mowenSubsAdd(k)
      if (!r.ok) {
        if (r.error?.code === 'MOCLI_NOT_FOUND') setMocliMissing(true)
        message.error(r.error?.message ?? '搜索失败')
        return
      }
      setCandidates(r.authors ?? [])
    } finally { setSearching(false) }
  }

  const add = async (u: MowenUser) => {
    const r = await api.mowenSubsAdd(kw.trim(), u.uid)
    if (!r.ok) { message.warning(r.error?.message ?? '订阅失败'); return }
    message.success(`已订阅「${u.name}」`)
    setCandidates([]); setKw('')
    await load()
  }

  const toggle = async (a: MowenSubscribedAuthor, next: boolean) => {
    await api.mowenSubsSetSubscribed(a.uid, next); await load()
  }

  const checkAll = async () => {
    setCheckingAll(true)
    try {
      const r = await api.mowenSubsCheckNow()
      applyResults(r); await load()
      if (r.note === 'mocli-missing') { setMocliMissing(true); message.warning('未检测到 mocli，无法检查'); return }
      if (r.note === 'no-authors') { message.warning('还没有订阅墨问作者'); return }
      const tail = r.results.some((x) => x.downloaded > 0)
        ? `已自动下载 ${r.results.reduce((s, x) => s + x.downloaded, 0)} 篇`
        : r.newFound > 0 ? `${r.newFound} 篇待处理` : '无新笔记'
      const summary = `查 ${r.authors} 位作者 · 新 ${r.newFound} 篇 · ${tail}`
      if (r.failed > 0) message.warning(`${summary} · 失败 ${r.failed}，详见下方检查记录`)
      else message.success(summary)
    } catch (e) {
      message.warning((e as Error).message)
    } finally { setCheckingAll(false) }
  }

  const checkOne = async (a: MowenSubscribedAuthor) => {
    setCheckingIds((prev) => (prev.includes(a.uid) ? prev : [...prev, a.uid]))
    try {
      const r = await api.mowenSubsCheckNow([a.uid])
      applyResults(r); await load()
      const mine = r.results.find((x) => x.uid === a.uid)
      if (r.note === 'mocli-missing' || (mine && !mine.ok)) {
        setRowRes((prev) => ({ ...prev, [a.uid]: { uid: a.uid, name: a.name, ok: false, newFound: 0, downloaded: 0, existed: 0, unavailable: 0, error: mine?.error ?? '未检测到 mocli' } }))
      }
    } catch (e) {
      setRowRes((prev) => ({ ...prev, [a.uid]: { uid: a.uid, name: a.name, ok: false, newFound: 0, downloaded: 0, existed: 0, unavailable: 0, error: (e as Error).message } }))
    } finally {
      setCheckingIds((prev) => prev.filter((x) => x !== a.uid))
    }
  }

  const removeAuthor = async (a: MowenSubscribedAuthor) => {
    await api.mowenSubsRemove(a.uid)
    message.success(`已删除「${a.name}」`)
    await load()
  }

  const pickedIds = (a: MowenSubscribedAuthor): string[] => {
    const all = pendingOf(a).map((n) => n.noteId)
    if (!expanded[a.uid]) return all
    const sel = selected[a.uid]
    return sel ? all.filter((id) => sel.includes(id)) : all
  }

  const busy = checkingAll || checkingIds.length > 0

  const downloadSelected = async (a: MowenSubscribedAuthor) => {
    const ids = pickedIds(a)
    if (!ids.length) return
    try {
      const r = await api.mowenSubsDownloadNotes(a.uid, ids)
      const head = `「${a.name}」已下载 ${r.downloaded} 篇`
      const skip = r.existed ? `，${r.existed} 篇已在库中` : ''
      if (r.failed > 0) message.warning(`${head}${skip}，${r.failed} 篇未成功（仍在待处理里，可再试一次）`)
      else message.success(head + skip)
      await load()
    } catch (e) {
      message.error('下载失败：' + (e as Error).message)
    }
  }

  const dismissSelected = async (a: MowenSubscribedAuthor) => {
    const ids = pickedIds(a)
    if (!ids.length) return
    await api.mowenSubsDismissNotes(a.uid, ids)
    await load()
  }

  /** 单篇下载：复用批量通道（传单 id），与微信 downloadOne 同规。 */
  const downloadOne = async (a: MowenSubscribedAuthor, noteId: string) => {
    try {
      const r = await api.mowenSubsDownloadNotes(a.uid, [noteId])
      if (r.failed > 0) message.warning('下载失败，可重试')
      else if (r.existed > 0) message.info('已在文库中')
      await load()
    } catch (e) {
      message.error('下载失败：' + (e as Error).message)
    }
  }

  const toggleExpand = (a: MowenSubscribedAuthor) => {
    setExpanded((prev) => ({ ...prev, [a.uid]: !prev[a.uid] }))
    // 默认全选（与微信同语义）
    setSelected((prev) => prev[a.uid] ? prev : { ...prev, [a.uid]: pendingOf(a).map((n) => n.noteId) })
  }
  const toggleOne = (uid: string, id: string, all: string[]) => {
    setSelected((prev) => {
      const cur = prev[uid] ?? all
      return { ...prev, [uid]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }
    })
  }

  /** 行内摘要（与微信 rowResultEl 同构）：失败不淡出；落盘摘要优先（单一数据源）。 */
  const rowResultEl = (uid: string) => {
    const r = rowRes[uid]
    if (r && !r.ok) {
      return <span data-testid="mowen-subs-row-result" style={{ marginLeft: 8, color: 'var(--cinnabar)' }}>· ✗ {r.error ?? '检查失败'}</span>
    }
    const hit = latestByAuthor.get(uid)
    if (hit) {
      return (
        <span data-testid="mowen-subs-row-summary" className="faint" style={{ marginLeft: 8 }}>
          · {formatShortTime(hit.entry.time)} {triggerLabel(hit.entry)} · {summaryPhrase(hit.detail.items, hit.entry.kind)}
        </span>
      )
    }
    if (!r) return null
    const [text, color] = r.downloaded > 0 ? [`✓ 已自动下载 ${r.downloaded} 篇`, 'var(--celadon, #3f8f6f)']
      : r.newFound > 0 ? [`发现 ${r.newFound} 篇待处理`, 'var(--cinnabar)']
        : ['暂无新笔记', undefined]
    return <span data-testid="mowen-subs-row-result" style={{ marginLeft: 8, color }}>· {text}</span>
  }

  /** 本轮检查文章列表（与微信 M58 pendingPanel 同构）：数据源 = 检查记录里该作者最近一次的明细。
   *  已入库（articleId 存在）点标题直开阅读器；未入库点标题开浏览器原文；pending 可勾选/单篇下载。 */
  const pendingPanel = (a: MowenSubscribedAuthor) => {
    const detail = latestItemsForAccount(checkLog, a.uid)
    const items = detail?.items ?? []
    if (!expanded[a.uid] || (!items.length && !a.newNotes.length)) return null
    const all = pendingOf(a).map((n) => n.noteId)
    const sel = selected[a.uid] ?? all
    const pendingIds = new Set(all)
    return (
      <div className="subs-pending" data-testid="mowen-subs-notes">
        {items.map((item) => {
          const downloadable = item.refId != null && pendingIds.has(item.refId)
          const status = itemStatusTag(item.status)
          return (
            <div key={item.url ?? item.title} className="subs-pending-item" data-testid="mowen-subs-note">
              {downloadable && <Checkbox checked={sel.includes(item.refId!)} disabled={busy}
                onChange={() => toggleOne(a.uid, item.refId!, all)} data-testid="mowen-subs-note-check" />}
              <a className="subs-pending-title"
                onClick={() => {
                  if (item.articleId) { navigate(`/reader/${encodeURIComponent(item.articleId)}`, { state: { from: pathname } }); return }
                  if (item.url) { api.openExternal(item.url); return }
                  message.info('该条记录来自旧版本检查，重新「检查」一次即可补全文章链接')
                }}
                title={item.articleId ? '打开阅读器' : item.url ? '在浏览器打开原文' : undefined}
                data-testid="mowen-subs-note-title">{item.title || '(无标题)'}</a>
              <Tag color={status.color} data-testid="mowen-subs-item-status" title={item.status === 'failed' ? item.error : undefined}>{status.label}</Tag>
              {item.status === 'pending' && downloadable &&
                <a data-testid="mowen-subs-item-download" onClick={() => downloadOne(a, item.refId!)}
                  style={{ opacity: busy ? 0.5 : 1 }}>下载</a>}
            </div>
          )
        })}
        {items.length === 0 && pendingOf(a).length > 0 && (
          // 旧记录无明细但 newNotes 有 pending：按 newNotes 兜底渲染（可勾选下载）
          pendingOf(a).map((n) => (
            <div key={n.noteId} className="subs-pending-item" data-testid="mowen-subs-note">
              <Checkbox checked={sel.includes(n.noteId)} disabled={busy} onChange={() => toggleOne(a.uid, n.noteId, all)} />
              <a className="subs-pending-title" onClick={() => n.url && api.openExternal(n.url)}>{n.title || '(无标题)'}</a>
              <Tag color="orange">待处理</Tag>
              <a onClick={() => downloadOne(a, n.noteId)}>下载</a>
            </div>
          ))
        )}
      </div>
    )
  }

  /** 检查记录明细弹窗（与微信 showCheckDetail 同构）。 */
  const showCheckDetail = (e: CheckLogEntry) => {
    const sections: ReactNode[] = []
    if (e.failures?.length) {
      sections.push(
        <div key="failures" data-testid="mowen-subs-detail-failures" style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, margin: '0 0 8px' }}>检查失败</h4>
          <List size="small" dataSource={e.failures} renderItem={(f) => (
            <List.Item><List.Item.Meta title={f.nickname} description={f.error} /></List.Item>
          )} />
        </div>,
      )
    }
    if (e.downloadDetail?.length) {
      // 只呈现有新笔记的作者（与微信弹窗同规）：「查过无新」的空条目不渲染
      const withNew = e.downloadDetail.filter((acc) => acc.items.length > 0)
      if (withNew.length) sections.push(
        <div key="downloads" data-testid="mowen-subs-detail-downloads">
          <h4 style={{ fontSize: 13, margin: '0 0 8px' }}>下载明细</h4>
          {withNew.map((acc) => (
            <div key={acc.fakeid} style={{ marginBottom: 12 }} data-testid="mowen-subs-detail-author">
              <div style={{ fontWeight: 600, fontSize: 13 }}>{acc.nickname}</div>
              {acc.items.map((item, i) => {
                const tag = itemStatusTag(item.status)
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                    <span style={{ flex: 1, fontSize: 13 }}>{item.title || '(无标题)'}</span>
                    <Tag color={tag.color} title={item.error}>{tag.label}</Tag>
                  </div>
                )
              })}
            </div>
          ))}
        </div>,
      )
    }
    Modal.info({
      title: detailModalTitle(e),
      content: sections.length ? <>{sections}</> : (
        <span className="faint" style={{ fontSize: 13 }}>
          {e.accounts > 0 && e.newFound === 0 && !e.failures?.length
            ? `本次检查 ${e.accounts} 位作者，均无新笔记。`
            : '该记录没有留下更多明细（旧版本记录）。'}
        </span>
      ),
      okText: '知道了', width: 520,
    })
  }

  if (mocliMissing) {
    return (
      <Alert type="warning" showIcon data-testid="mowen-subs-guide"
        message="墨问订阅需要 mocli"
        description={<>未检测到 mocli。请先安装并认证：<code>npm install -g @mowenxd/cli</code>；<code>mocli auth init</code>（API Key 在墨问小程序「我的 → 开发者」获取）。详见设置页「墨问集成」。</>}
      />
    )
  }

  const mowenLogs = checkLog.slice(0, 10)

  return (
    <div>
      {/* surface 白底卡片：与下载页/微信面板内容区同形态（2026-09-17 统一）。
          管理区（搜索→清单）进卡片；「检查记录」留卡片外（与微信面板、下载页历史区同规）。 */}
      <div className="surface" style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input placeholder="输入墨问作者名字搜索并订阅" value={kw} onChange={(e) => setKw(e.target.value)}
          onPressEnter={search} style={{ width: 280 }} data-testid="mowen-subs-kw" allowClear disabled={searching} />
        <Button type="primary" onClick={search} loading={searching} data-testid="mowen-subs-search">搜索</Button>
        <div style={{ flex: 1 }} />
        <Button type="primary" loading={checkingAll} disabled={checkingIds.length > 0} onClick={checkAll} data-testid="mowen-subs-check-now">检查全部</Button>
      </div>

      {candidates.length > 0 && (
        <List size="small" bordered style={{ marginBottom: 16 }} dataSource={candidates}
          data-testid="mowen-subs-candidates"
          renderItem={(c) => {
            const subscribed = authors.some((a) => a.uid === c.uid)
            return (
              <List.Item actions={[subscribed
                ? <span key="on" className="faint" data-testid="mowen-subs-subscribed-tag">已订阅</span>
                : <a key="add" data-testid="mowen-subs-subscribe" onClick={() => add(c)}>订阅</a>]}>
                <List.Item.Meta title={c.name} description={<span className="faint" style={{ fontSize: 12.5 }} title={c.intro}>{c.intro || '（无简介）'}</span>} />
              </List.Item>
            )
          }} />
      )}

      {loading ? <div style={{ padding: 80, textAlign: 'center' }}><Spin /></div>
        : authors.length === 0 ? (
          <div className="empty-state">
            <div className="es-mark">订</div>
            <div className="es-title">还没有订阅墨问作者</div>
            <div>上方搜索作者名字，确认简介后订阅；之后的更新会出现在这里。</div>
          </div>
        ) : (
          <List dataSource={authors} className="subs-row-list" data-testid="mowen-subs-list" renderItem={(a) => {
            const pending = pendingOf(a)
            const thisChecking = checkingIds.includes(a.uid)
            const checkEl = thisChecking
              ? <span key="ck" className="faint" data-testid="mowen-subs-check-btn"><LoadingOutlined /> 检查中</span>
              : busy
                ? <span key="ck" className="faint" data-testid="mowen-subs-check-btn">检查</span>
                : <a key="ck" data-testid="mowen-subs-check-btn" onClick={() => checkOne(a)}>检查</a>
            const removeEl = (
              <Popconfirm key="rm" title={`删除「${a.name}」？`} description="删除后该作者的订阅与检查状态一并移除；再次订阅会重新添加。"
                okText="删除" cancelText="取消" onConfirm={() => removeAuthor(a)}>
                <a data-testid="mowen-subs-remove" aria-label={`删除 ${a.name}`}><DeleteOutlined /></a>
              </Popconfirm>
            )
            // 常驻「文库」入口（与微信 M56 R2 同规）：按作者名筛选文库存量文章
            const libraryEl = (
              <a key="lib" data-testid="mowen-subs-goto-library"
                onClick={() => navigate(`/library?account=${encodeURIComponent(a.uid)}&name=${encodeURIComponent(a.name)}`)}>文库</a>
            )
            // 行内动作作用于「当前选择」：收起时选择即全部（与微信同规，一次只有一个含义）
            const open = !!expanded[a.uid]
            const picked = pickedIds(a).length
            const dlLabel = open ? `下载所选 ${picked} 篇` : `下载 ${pending.length} 篇新笔记`
            const igLabel = open ? `忽略所选 ${picked} 篇` : '忽略'
            const idle = !busy && picked > 0
            const actions = a.subscribed && pending.length > 0
              ? [
                  idle
                    ? <a key="dl" data-testid="mowen-subs-download-new" onClick={() => downloadSelected(a)}>{dlLabel}</a>
                    : <span key="dl" className="faint" data-testid="mowen-subs-download-new">{dlLabel}</span>,
                  idle
                    ? <a key="ig" data-testid="mowen-subs-dismiss-new" onClick={() => dismissSelected(a)}>{igLabel}</a>
                    : <span key="ig" className="faint" data-testid="mowen-subs-dismiss-new">{igLabel}</span>,
                  checkEl, libraryEl,
                ]
              : rowRes[a.uid]?.ok
                ? [checkEl, libraryEl, removeEl]
                : [<span key="none" className="faint">无新笔记</span>, checkEl, libraryEl, removeEl]
            return (
              <List.Item data-testid="mowen-subs-row" actions={actions}>
                <List.Item.Meta
                  title={
                    <span>
                      {a.name}
                      {/* 展开入口不随下载清零消失（微信 M58 同规）：本轮明细仍在，「下载了什么」要能看 */}
                      {(() => {
                        const detail = latestItemsForAccount(checkLog, a.uid)
                        const hasNew = a.subscribed && pending.length > 0
                        const hasDetail = (detail?.items.length ?? 0) > 0
                        if (!hasNew && !hasDetail) return null
                        return (
                          <a onClick={() => toggleExpand(a)} data-testid="mowen-subs-expand" title="查看具体是哪几篇">
                            {hasNew
                              ? <Tag color="red" style={{ cursor: 'pointer' }}>{open ? '▾' : '▸'} {pending.length} 新</Tag>
                              : <Tag color="green" style={{ cursor: 'pointer' }}>{open ? '▾' : '▸'} {detail!.items.length} 篇</Tag>}
                          </a>
                        )
                      })()}
                    </span>
                  }
                  description={
                    <>
                      <span>
                        {a.lastCheckedAt ? `上次检查 ${new Date(a.lastCheckedAt).toLocaleString()}` : '尚未检查'}
                        {rowResultEl(a.uid)}
                      </span>
                      {pendingPanel(a)}
                    </>
                  } />
                <Switch checked={a.subscribed} onChange={(v) => toggle(a, v)} data-testid="mowen-subs-toggle"
                  disabled={busy} checkedChildren="已订阅" unCheckedChildren="未订阅" />
              </List.Item>
            )
          }} />
        )}
      </div>

      <div style={{ marginTop: 24 }} data-testid="mowen-subs-check-log">
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>检查记录</h3>
        {mowenLogs.length === 0 ? <div className="faint" style={{ fontSize: 13 }}>还没有检查记录。开启自动检查或点「检查全部」后，这里会留痕。</div>
          : <List size="small" dataSource={mowenLogs} renderItem={(e: CheckLogEntry) => (
              // 每条记录都可点开明细弹窗（与微信同规）
              <List.Item data-testid="mowen-subs-log-entry" style={{ cursor: 'pointer', padding: '6px 0' }} onClick={() => showCheckDetail(e)}>
                <span style={{ fontSize: 12.5 }}>
                  {new Date(e.time).toLocaleString()} · {triggerLabel(e)} · 查 {e.accounts} 位作者 · 新 {e.newFound} ·{' '}
                  {e.failures?.length
                    ? <a onClick={(ev) => { ev.stopPropagation(); showCheckDetail(e) }} data-testid="mowen-subs-log-failures">失败 {e.failed}</a>
                    : <>失败 {e.failed}</>}{e.note ? ` · ${e.note}` : ''}
                </span>
              </List.Item>
            )} />}
      </div>
    </div>
  )
}
