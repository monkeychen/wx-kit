import { useEffect, useRef, useState } from 'react'
import { Input, Switch, Button, Spin, Alert, message, List, Tag, Modal } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { SubscribedAccount, CheckLogEntry } from '../api'
import type { MpAccount } from '../../core/mp-types'

interface DlState { fakeid: string; total: number; done: number }

export default function Subscriptions() {
  const [accounts, setAccounts] = useState<SubscribedAccount[]>([])
  const [authExpired, setAuthExpired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [kw, setKw] = useState('')
  const [candidates, setCandidates] = useState<MpAccount[]>([])
  const [checkLog, setCheckLog] = useState<CheckLogEntry[]>([])
  const [nextCheckAt, setNextCheckAt] = useState<number | null>(null)
  const [dl, setDl] = useState<DlState | null>(null)
  const dlRef = useRef<DlState | null>(null)
  useEffect(() => { dlRef.current = dl }, [dl])
  // 下载进度：只在「自己触发的那个号」窗口期更新行内文字（completed 计数）
  useEffect(() => api.onSubscriptionDownloadProgress((e) => {
    const cur = dlRef.current
    if (cur && e.fakeid === cur.fakeid) setDl({ fakeid: e.fakeid, total: e.total, done: e.done })
  }), [])

  const load = async () => {
    setLoading(true)
    try {
      const s = await api.subscriptionsList()
      setAccounts(s.accounts); setAuthExpired(s.authExpired); setCheckLog(s.checkLog); setNextCheckAt(s.nextCheckAt)
    }
    finally { setLoading(false) }
  }
  useEffect(() => { load(); return api.onSubscriptionsUpdated(load) }, [])

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
  const checkNow = async () => {
    setChecking(true)
    try { await api.subscriptionsCheckNow(); await load() }
    finally { setChecking(false) }
  }
  const downloadNew = async (a: SubscribedAccount) => {
    const n = a.newRefs.length
    setDl({ fakeid: a.fakeid, total: n, done: 0 })
    try {
      await api.subscriptionsDownloadNew(a.fakeid)
      message.success(`已下载「${a.nickname}」${n} 篇新文章`)
      await load()
    } catch (e) {
      message.error('下载失败：' + (e as Error).message)
    } finally {
      setDl(null)
    }
  }
  const dismiss = async (a: SubscribedAccount) => { await api.subscriptionsDismissNew(a.fakeid); await load() }

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
          <Button type="primary" loading={checking} disabled={dl !== null} onClick={checkNow} data-testid="subs-check-now">检查更新</Button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 13 }} className="faint">
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
              const busy = dl !== null
              const downloadingThis = dl?.fakeid === a.fakeid
              const actions = downloadingThis
                ? [<span key="dl" data-testid="subs-downloading" style={{ color: 'var(--cinnabar)' }}><LoadingOutlined /> 下载中 {dl.done}/{dl.total}</span>]
                : a.newRefs.length > 0
                  ? [
                      busy
                        ? <span key="dl" className="faint" data-testid="subs-download-new">下载 {a.newRefs.length} 篇新文章</span>
                        : <a key="dl" data-testid="subs-download-new" onClick={() => downloadNew(a)}>下载 {a.newRefs.length} 篇新文章</a>,
                      busy
                        ? <span key="ig" className="faint">忽略</span>
                        : <a key="ig" onClick={() => dismiss(a)}>忽略</a>,
                    ]
                  : [<span key="none" className="faint">无新文章</span>]
              return (
              <List.Item data-testid="subs-row" actions={actions}>
                <List.Item.Meta
                  title={<span>{a.nickname} {a.newRefs.length > 0 && <Tag color="red">{a.newRefs.length} 新</Tag>}</span>}
                  description={a.lastCheckedAt ? `上次检查 ${new Date(a.lastCheckedAt).toLocaleString()}` : '尚未检查'} />
                <Switch checked={a.subscribed} onChange={(v) => toggle(a, v)} data-testid="subs-toggle"
                  disabled={dl !== null} checkedChildren="已订阅" unCheckedChildren="未订阅" />
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
