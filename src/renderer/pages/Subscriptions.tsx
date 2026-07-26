import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input, Switch, Button, Spin, Alert, message, List, Tag, Modal } from 'antd'
import { LoadingOutlined, SettingOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { SubscribedAccount, CheckLogEntry, PerAccountResult, RunCheckResult } from '../api'
import type { NewArticleAction } from '../../../electron/services/settings'
import type { MpAccount } from '../../core/mp-types'

/** 下载进度按 fakeid 存:手动下载与检查里的自动下载共用同一套 UI（M34） */
interface DlState { total: number; done: number; phase: string }
/** 行内结果态展示多久后淡出；失败态不自动清（失败信息值钱，留到下次检查） */
const RESULT_TTL_MS = 8000

export default function Subscriptions() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<SubscribedAccount[]>([])
  const [authExpired, setAuthExpired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [kw, setKw] = useState('')
  const [candidates, setCandidates] = useState<MpAccount[]>([])
  const [checkLog, setCheckLog] = useState<CheckLogEntry[]>([])
  const [nextCheckAt, setNextCheckAt] = useState<number | null>(null)
  const [dls, setDls] = useState<Record<string, DlState>>({})
  const [rowRes, setRowRes] = useState<Record<string, PerAccountResult>>({})
  const [policy, setPolicy] = useState<NewArticleAction | null>(null)
  // 下载进度：无条件按 fakeid 记账。此前只认「自己触发的那个号」，自动下载（无本地 dl 记录）的进度被整个丢弃。
  useEffect(() => api.onSubscriptionDownloadProgress((e) => {
    setDls((prev) => ({ ...prev, [e.fakeid]: { total: e.total, done: e.done, phase: e.phase } }))
  }), [])

  const load = async () => {
    setLoading(true)
    try {
      const s = await api.subscriptionsList()
      setAccounts(s.accounts); setAuthExpired(s.authExpired); setCheckLog(s.checkLog); setNextCheckAt(s.nextCheckAt)
      // 策略常驻可见：设置是几天前设的，点检查时早忘了——让状态可见，而不是让人回忆
      setPolicy((await api.getSettings()).subscriptionNewArticleAction)
    }
    finally { setLoading(false) }
  }
  useEffect(() => { load(); return api.onSubscriptionsUpdated(load) }, [])

  /** 检查结果落到各行；成功态几秒后淡出，失败态留着 */
  const applyResults = (r: RunCheckResult) => {
    setDls({})
    if (!r.results.length) return
    setRowRes((prev) => ({ ...prev, ...Object.fromEntries(r.results.map((x) => [x.fakeid, x])) }))
    const okIds = r.results.filter((x) => x.ok).map((x) => x.fakeid)
    if (okIds.length) setTimeout(() => setRowRes((prev) => {
      const next = { ...prev }; for (const id of okIds) delete next[id]; return next
    }), RESULT_TTL_MS)
  }
  /**
   * 检查没查成任何号时（无登录态/没订阅号）也要说话，不能点完什么都没发生。
   * single=true 时是点了某一行的「检查」——那 no-accounts 只有一个成因：这个号没订阅，
   * 于是话术要引导下一步动作，而不是复述全局状态（「没有已订阅的公众号」对单行毫无指导性）。
   */
  const noteText = (r: RunCheckResult, single = false): string | null =>
    r.note === 'no-session' || r.note === 'auth-expired' ? '需重新登录公众号后台'
      : r.note === 'no-accounts' ? (single ? '该号未订阅，打开右侧开关后再检查' : '没有已订阅的公众号')
        : null

  const toggle = async (a: SubscribedAccount, next: boolean) => {
    await api.subscriptionsSetSubscribed(a.fakeid, a.nickname, next); await load()
  }
  const search = async () => {
    const name = kw.trim(); if (!name) return
    const r = await api.mpSearch(name)
    if (!r.ok) { message.error(r.error?.message ?? '搜索失败'); setAuthExpired(r.error?.code === 'AUTH_REQUIRED'); return }
    setCandidates(r.list ?? [])
  }
  const add = async (c: MpAccount) => {
    await api.subscriptionsAddAccount(c.fakeid, c.nickname); setCandidates([]); setKw(''); await load(); message.success(`已订阅「${c.nickname}」`)
  }
  // 「检查全部」的操作对象是全体，故额外给一条汇总；单号检查不弹（反馈已在那一行）
  const checkNow = async () => {
    setChecking(true)
    try {
      const r = await api.subscriptionsCheckNow()
      applyResults(r); await load()
      const note = noteText(r)
      if (note) { message.warning(note); return }
      const tail = r.results.some((x) => x.downloaded > 0)
        ? `已自动下载 ${r.results.reduce((s, x) => s + x.downloaded, 0)} 篇`
        : r.newFound > 0 ? `${r.newFound} 篇待处理` : '无新文章'
      const summary = `查 ${r.accounts} 号 · 新 ${r.newFound} 篇 · ${tail}`
      if (r.failed > 0) message.warning(`${summary} · 失败 ${r.failed}，详见下方检查记录`)
      else message.success(summary)
    } finally { setChecking(false) }
  }
  // R1 部分检查:只查这一个号(in-flight 共享:正在跑时全入口置灰并入同一次运行)
  const checkOne = async (a: SubscribedAccount) => {
    setChecking(true)
    try {
      const r = await api.subscriptionsCheckNow([a.fakeid])
      applyResults(r); await load()
      // 单号检查不弹全局提示；只有「一个号都没查成」这种说不清的情况才出声
      const note = noteText(r, true)
      if (note) setRowRes((prev) => ({ ...prev, [a.fakeid]: { fakeid: a.fakeid, nickname: a.nickname, ok: false, newFound: 0, downloaded: 0, error: note } }))
    } finally { setChecking(false) }
  }
  const downloadNew = async (a: SubscribedAccount) => {
    const n = a.newRefs.length
    setDls((prev) => ({ ...prev, [a.fakeid]: { total: n, done: 0, phase: 'start' } }))
    try {
      await api.subscriptionsDownloadNew(a.fakeid)
      message.success(`已下载「${a.nickname}」${n} 篇新文章`)
      await load()
    } catch (e) {
      message.error('下载失败：' + (e as Error).message)
    } finally {
      setDls((prev) => { const next = { ...prev }; delete next[a.fakeid]; return next })
    }
  }
  const dismiss = async (a: SubscribedAccount) => { await api.subscriptionsDismissNew(a.fakeid); await load() }
  const busy = Object.keys(dls).length > 0

  /** 行内结果:检查完这一行到底发生了什么。此前自动下载全程零反馈，点完像什么都没发生。 */
  const rowResultEl = (fakeid: string, nickname: string) => {
    const r = rowRes[fakeid]
    if (!r) return null
    const [text, color] = !r.ok ? [`✗ ${r.error ?? '检查失败'}`, 'var(--cinnabar)']
      : r.downloaded > 0 ? [`✓ 已自动下载 ${r.downloaded} 篇`, 'var(--celadon, #3f8f6f)']
        : r.newFound > 0 ? [`发现 ${r.newFound} 篇待处理`, 'var(--cinnabar)']
          : ['暂无新文章', undefined]
    return (
      <span data-testid="subs-row-result" style={{ marginLeft: 8, color }}>
        · {text}
        {r.downloaded > 0 && (
          <a style={{ marginLeft: 6 }} data-testid="subs-goto-library"
            onClick={() => navigate(`/library?account=${encodeURIComponent(nickname)}`)}>去看看</a>
        )}
      </span>
    )
  }

  // 检查记录里「失败 x」的明细弹窗(v0.5.4 起的记录才有 failures;旧记录保持纯文本)
  const showFailures = (e: CheckLogEntry) => {
    Modal.info({
      title: `检查失败明细（${new Date(e.time).toLocaleString()}）`,
      content: (
        <List size="small" dataSource={e.failures} renderItem={(f) => (
          <List.Item>
            <List.Item.Meta title={f.nickname} description={f.error} />
          </List.Item>
        )} />
      ),
      okText: '知道了',
      width: 480,
    })
  }

  return (
    <div className="page">
      <div className="fade-in">
        <div className="page-head">
          <div className="eyebrow">Subscriptions</div>
          <h1 className="page-title">订阅</h1>
        </div>

        {authExpired && <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message="订阅检查需重新登录公众号后台" description="到「下载 · 按公众号」扫码登录后，订阅检查会自动恢复。" />}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Input placeholder="搜索公众号名称以添加订阅" value={kw} onChange={(e) => setKw(e.target.value)}
            onPressEnter={search} style={{ width: 280 }} data-testid="subs-search-input" allowClear />
          <Button onClick={search} data-testid="subs-search-btn">搜索</Button>
          <div style={{ flex: 1 }} />
          <Button type="primary" loading={checking} disabled={busy} onClick={checkNow} data-testid="subs-check-now">检查全部</Button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 13 }} className="faint">
          {policy && (
            <span data-testid="subs-policy">
              发现新文章时：<strong>{policy === 'download' ? '自动下载' : '仅提示'}</strong>
              <a onClick={() => navigate('/settings')} style={{ marginLeft: 4 }} title="到设置页修改">
                <SettingOutlined />
              </a>
            </span>
          )}
          <span data-testid="subs-next-check">下次预计检查：{nextCheckAt ? new Date(nextCheckAt).toLocaleString() : '未开启自动检查'}</span>
          <a onClick={() => api.subscriptionsOpenLog()} data-testid="subs-open-log">📄 打开检查日志</a>
        </div>

        {candidates.length > 0 && (
          <List size="small" bordered style={{ marginBottom: 16 }} dataSource={candidates}
            renderItem={(c) => (
              <List.Item actions={[<a key="add" onClick={() => add(c)}>订阅</a>]}>
                <span>{c.nickname}</span>{c.alias && <span className="faint" style={{ marginLeft: 8 }}>{c.alias}</span>}
              </List.Item>
            )} />
        )}

        {loading ? <div style={{ padding: 80, textAlign: 'center' }}><Spin /></div>
          : accounts.length === 0 ? (
            <div className="empty-state">
              <div className="es-mark">订</div>
              <div className="es-title">还没有可订阅的公众号</div>
              <div>下载过某公众号的文章后它会出现在这里，或上方搜索名称直接添加。</div>
            </div>
          ) : (
            <List dataSource={accounts} data-testid="subs-list" renderItem={(a) => {
              const dl = dls[a.fakeid]
              const downloadingThis = dl != null && dl.phase !== 'done'
              // R1:每行「检查」单号;与顶部「检查全部」共享 in-flight(checking/dl 时全置灰并入同一次运行)
              const checkEl = checking || busy
                ? <span key="ck" className="faint" data-testid="subs-check-one">检查</span>
                : <a key="ck" data-testid="subs-check-one" onClick={() => checkOne(a)}>检查</a>
              const actions = downloadingThis
                ? [<span key="dl" data-testid="subs-downloading" style={{ color: 'var(--cinnabar)' }}><LoadingOutlined /> 下载中 {dl.done}/{dl.total}</span>, checkEl]
                : a.newRefs.length > 0
                  ? [
                      busy
                        ? <span key="dl" className="faint" data-testid="subs-download-new">下载 {a.newRefs.length} 篇新文章</span>
                        : <a key="dl" data-testid="subs-download-new" onClick={() => downloadNew(a)}>下载 {a.newRefs.length} 篇新文章</a>,
                      busy
                        ? <span key="ig" className="faint">忽略</span>
                        : <a key="ig" onClick={() => dismiss(a)}>忽略</a>,
                      checkEl,
                    ]
                  // 刚检查完这一行时,行内结果态已经把话说清了;再挂个「无新文章」会和
                  // 「已自动下载 N 篇」并列显示,读起来自相矛盾
                  : rowRes[a.fakeid]?.ok
                    ? [checkEl]
                    : [<span key="none" className="faint">无新文章</span>, checkEl]
              return (
              <List.Item data-testid="subs-row" actions={actions}>
                <List.Item.Meta
                  title={<span>{a.nickname} {a.newRefs.length > 0 && <Tag color="red">{a.newRefs.length} 新</Tag>}</span>}
                  description={
                    <span>
                      {a.lastCheckedAt ? `上次检查 ${new Date(a.lastCheckedAt).toLocaleString()}` : '尚未检查'}
                      {rowResultEl(a.fakeid, a.nickname)}
                    </span>
                  } />
                <Switch checked={a.subscribed} onChange={(v) => toggle(a, v)} data-testid="subs-toggle"
                  disabled={busy} checkedChildren="已订阅" unCheckedChildren="未订阅" />
              </List.Item>
              ) }} />
          )}

        <div style={{ marginTop: 24 }} data-testid="subs-check-log">
          <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>检查记录</h3>
          {checkLog.length === 0 ? <div className="faint" style={{ fontSize: 13 }}>还没有检查记录。开启自动检查或点「检查更新」后，这里会留痕。</div>
            : <List size="small" dataSource={checkLog.slice(0, 10)} renderItem={(e: CheckLogEntry) => (
                <List.Item>
                  <span style={{ fontSize: 12.5 }}>
                    {new Date(e.time).toLocaleString()} · {e.trigger === 'auto' ? '自动' : '手动'} · 查 {e.accounts} 号 · 新 {e.newFound} ·{' '}
                    {e.failures?.length
                      ? <a onClick={() => showFailures(e)} data-testid="subs-log-failures">失败 {e.failed}</a>
                      : <>失败 {e.failed}</>}{e.note ? ` · ${e.note}` : ''}
                  </span>
                </List.Item>
              )} />}
        </div>
      </div>
    </div>
  )
}
