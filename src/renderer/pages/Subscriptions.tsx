import { useEffect, useState } from 'react'
import { Input, Switch, Button, Spin, Alert, message, List, Tag } from 'antd'
import { api } from '../api'
import type { SubscribedAccount } from '../api'
import type { MpAccount } from '../../core/mp-types'

export default function Subscriptions() {
  const [accounts, setAccounts] = useState<SubscribedAccount[]>([])
  const [authExpired, setAuthExpired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [kw, setKw] = useState('')
  const [candidates, setCandidates] = useState<MpAccount[]>([])

  const load = async () => {
    setLoading(true)
    try { const s = await api.subscriptionsList(); setAccounts(s.accounts); setAuthExpired(s.authExpired) }
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
          <Button type="primary" loading={checking} onClick={checkNow} data-testid="subs-check-now">检查更新</Button>
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
            <List dataSource={accounts} data-testid="subs-list" renderItem={(a) => (
              <List.Item data-testid="subs-row" actions={[
                a.newRefs.length > 0 ? <a key="dl" data-testid="subs-download-new" onClick={async () => { await api.subscriptionsDownloadNew(a.fakeid); await load() }}>下载 {a.newRefs.length} 篇新文章</a> : <span key="none" className="faint">无新文章</span>,
                a.newRefs.length > 0 ? <a key="ig" onClick={async () => { await api.subscriptionsDismissNew(a.fakeid); await load() }}>忽略</a> : null,
              ]}>
                <List.Item.Meta
                  title={<span>{a.nickname} {a.newRefs.length > 0 && <Tag color="red">{a.newRefs.length} 新</Tag>}</span>}
                  description={a.lastCheckedAt ? `上次检查 ${new Date(a.lastCheckedAt).toLocaleString()}` : '尚未检查'} />
                <Switch checked={a.subscribed} onChange={(v) => toggle(a, v)} data-testid="subs-toggle"
                  checkedChildren="已订阅" unCheckedChildren="未订阅" />
              </List.Item>
            )} />
          )}
      </div>
    </div>
  )
}
