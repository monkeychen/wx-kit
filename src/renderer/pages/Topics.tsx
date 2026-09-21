import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Alert, Button, Select, Space, Spin, Tabs, Tag, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type {
  TopicAiConfigStatus,
  TopicDecisionCard,
  TopicFeedbackDecision,
  TopicRunResult,
  TopicWindowInput,
} from '../api'
import {
  confidenceLabel,
  feedbackLabel,
  isSafeExternalSource,
  readerValueLabel,
  resultNotice,
  stageLabel,
  statisticsLabel,
} from '../topic-view'
import { configReady, getTopicRunStore } from '../topic-run-store'

type TopicPreset = TopicWindowInput['preset']

const RANGE_OPTIONS = [
  { value: '24h', label: '最近 24 小时' },
  { value: '3d', label: '最近 3 天' },
  { value: '7d', label: '最近 7 天' },
  { value: 'custom', label: '自定义日期' },
]

function usableCards(result: TopicRunResult | null): TopicDecisionCard[] {
  return result?.status === 'completed' || result?.status === 'partial' ? result.cards : []
}

function TopicDetail({ card, runId }: { card: TopicDecisionCard; runId: string }) {
  const [briefPath, setBriefPath] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setBriefPath('') }, [card.id, runId])

  const recordFeedback = async (decision: TopicFeedbackDecision) => {
    const response = await api.topicsFeedback(runId, card.id, decision)
    if (response.ok) message.success(`已记录“${feedbackLabel(decision)}”`)
    else message.error(response.error.message)
  }

  const makeBrief = async () => {
    setBusy(true)
    try {
      const response = await api.topicsBrief(runId, card.id)
      if (!response.ok) { message.error(response.error.message); return }
      await api.copyText(response.markdown)
      setBriefPath(response.path)
      message.success('选题简报已生成并复制')
    } catch (error) { message.error('生成失败：' + (error as Error).message) }
    finally { setBusy(false) }
  }

  const why = (
    <div className="topic-detail-body">
      <section>
        <h3>读者可能获得什么</h3>
        <div className="topic-value-list">
          {card.readerValues.map(value => (
            <div className="topic-value-row" key={value.kind}>
              <Tag>{readerValueLabel(value.kind)}</Tag>
              <span>{value.benefit}</span>
              <span className="topic-inference">编辑推断</span>
            </div>
          ))}
        </div>
      </section>
      <section><h3>为什么值得考虑</h3><p>{card.rationale}</p></section>
      <section>
        <h3>{confidenceLabel(card.evidenceConfidence.level)}</h3>
        <ul>{card.evidenceConfidence.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      </section>
      <section>
        <h3>限制</h3>
        <ul>{card.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  )

  const evidence = (
    <div className="topic-detail-body">
      <Alert type="info" showIcon message="摘录存在不等于事实已验证" description="系统只确认下方文字能在本地素材中逐字定位，不代表外部事实已经独立核验。" />
      {card.evidence.map(item => (
        <article className="topic-evidence" data-testid="topic-evidence" key={item.id}>
          <div className="topic-evidence-head">
            <div><strong>{item.sourceTitle}</strong><span>{item.sourceAccount}</span></div>
            {isSafeExternalSource(item.sourceUrl) && <Button size="small" onClick={() => api.openExternal(item.sourceUrl)}>打开原文</Button>}
          </div>
          <blockquote>{item.quote}</blockquote>
          <div className="topic-evidence-meta">定位 {item.paragraphId} · {item.role === 'support' ? '支持材料' : item.role === 'counterpoint' ? '反方材料' : '背景材料'}</div>
        </article>
      ))}
    </div>
  )

  const outline = (
    <div className="topic-detail-body" data-testid="topic-outline">
      <section>
        <h3>建议结构</h3>
        <ol className="topic-outline-list">{card.outline.map(item => <li key={item}>{item}</li>)}</ol>
      </section>
      <section>
        <h3>动笔前还需补什么</h3>
        {card.missingEvidence.length
          ? <ul>{card.missingEvidence.map(item => <li key={item}>{item}</li>)}</ul>
          : <p className="faint">暂无明确缺口。</p>}
      </section>
    </div>
  )

  return (
    <section className="surface topic-detail" data-testid="topic-detail">
      <div className="topic-detail-head">
        <div>
          <div className="eyebrow">Selected topic</div>
          <h2>{card.question}</h2>
          <p>{card.angle}</p>
        </div>
        <div className="topic-distribution">传播效果未验证</div>
      </div>
      <Tabs items={[
        { key: 'why', label: '为什么值得写', children: why },
        { key: 'evidence', label: '材料依据', children: evidence },
        { key: 'outline', label: '怎么下笔', children: outline },
      ]} />
      <div className="topic-detail-actions">
        <Space wrap>
          <Button data-testid="topic-feedback-skip" onClick={() => recordFeedback('skip')}>暂不写</Button>
          <Button data-testid="topic-feedback-watch" onClick={() => recordFeedback('watch')}>保存观察</Button>
          <Button data-testid="topic-feedback-already-written" onClick={() => recordFeedback('already-written')}>已经写过</Button>
        </Space>
        <Space wrap>
          {briefPath && <Button data-testid="topic-reveal-brief" onClick={() => api.reveal(briefPath)}>显示文件</Button>}
          <Button type="primary" loading={busy} data-testid="topic-make-brief" onClick={makeBrief}>生成选题简报</Button>
        </Space>
      </div>
    </section>
  )
}

export default function Topics() {
  const navigate = useNavigate()
  const store = useMemo(getTopicRunStore, [])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [config, setConfig] = useState<TopicAiConfigStatus | null>(null)
  const preset = (snapshot.window?.preset ?? '24h') as TopicPreset
  const from = snapshot.window?.preset === 'custom' ? snapshot.window.from : ''
  const to = snapshot.window?.preset === 'custom' ? snapshot.window.to : ''
  const loading = snapshot.running
  const stage = snapshot.stage ? stageLabel(snapshot.stage) : ''
  const [elapsed, setElapsed] = useState(0)
  const result = snapshot.result
  const excludedCount = snapshot.timeExcludedCount
  const selectedId = snapshot.selectedId
  const cards = useMemo(() => usableCards(result), [result])
  const selected = cards.find(card => card.id === selectedId) ?? null

  useEffect(() => { api.topicsGetConfig().then(setConfig).catch(() => setConfig(null)) }, [])
  // 挂载时与主进程对账：分析在跑但本地不知道（例如另一处触发）时恢复现场。
  useEffect(() => { void store.sync() }, [store])
  // 加载计时：让人分得清「在跑」和「卡死」。模型请求 90s 超时，接近上限时提示。
  // 起点用 snapshot.startedAt——切页再回来计时不归零。
  useEffect(() => {
    if (!loading || !snapshot.startedAt) { setElapsed(0); return }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - snapshot.startedAt!) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [loading, snapshot.startedAt])

  const setWindow = (window: TopicWindowInput) => store.selectWindow(window)

  const analyze = async () => {
    if (!configReady(config)) { message.warning('先配置 AI 模型服务'); navigate('/settings'); return }
    if (preset === 'custom' && (!from || !to)) { message.warning('请选择完整的开始和结束日期'); return }
    const window: TopicWindowInput = preset === 'custom' ? { preset, from, to } : { preset }
    if (!store.start(window)) message.info('已有选题分析正在进行')
  }

  const cancel = async () => {
    const response = await store.cancel()
    if (!response.ok && response.message) message.info(response.message)
  }

  const notice = result ? resultNotice(result) : null

  return (
    <div className="page" data-testid="topics-page">
      <div className="fade-in topic-page-inner">
        <div className="page-head topic-page-head">
          <div>
            <div className="eyebrow">Topics</div>
            <h1 className="page-title">今天写什么</h1>
            <div className="page-sub">从本地素材中找出最多 3 个可追溯的候选，帮你判断“值不值写”。</div>
          </div>
        </div>

        <section className="surface topic-toolbar">
          <div className="topic-range-control">
            <label>素材范围</label>
            <Select data-testid="topic-range" value={preset} options={RANGE_OPTIONS} style={{ width: 168 }} disabled={loading}
              onChange={(value: TopicPreset) => setWindow(value === 'custom' ? { preset: 'custom', from, to } : { preset: value })} />
            {preset === 'custom' && (
              <div className="topic-custom-dates">
                <input type="date" data-testid="topic-date-from" value={from} disabled={loading} onChange={event => setWindow({ preset: 'custom', from: event.target.value, to })} />
                <span>至</span>
                <input type="date" data-testid="topic-date-to" value={to} disabled={loading} onChange={event => setWindow({ preset: 'custom', from, to: event.target.value })} />
              </div>
            )}
          </div>
          <Space>
            {loading && <Button data-testid="topic-cancel" onClick={cancel}>取消</Button>}
            <Button type="primary" size="large" loading={loading} data-testid="topic-analyze" onClick={analyze}>寻找选题</Button>
          </Space>
          <div className="topic-privacy-note">分析时，所选文章正文会发送到你配置的 AI 服务{config?.baseUrl ? `（${config.baseUrl}）` : ''}。
          </div>
        </section>

        {!configReady(config) && config !== null && (
          <Alert className="topic-alert" type="warning" showIcon
            message="还不能开始分析"
            description="请先设置兼容 OpenAI Chat Completions 的 base URL、model 和 API Key。"
            action={<Button data-testid="topic-go-settings" onClick={() => navigate('/settings')}>前往设置</Button>} />
        )}

        {loading && (
          <div className="surface topic-loading">
            <Spin />
            <strong>{stage || '正在分析'}</strong>
            <span>已等待 {elapsed} 秒{elapsed >= 60 ? '，素材多时单次模型请求最长约 90 秒，可随时取消' : '，这一次只读取你选定时间范围内的本地素材'}</span>
          </div>
        )}

        {notice && (
          <Alert className="topic-alert" type={notice.tone} showIcon message={notice.text}
            description={excludedCount > 0
              ? `另有 ${excludedCount} 篇因发表时间不在所选范围或不确定而未纳入；需要分析它们时，调整上方素材范围后重新分析。`
              : undefined} />
        )}

        {cards.length > 0 && (
          <>
            <div className="topic-grid" role="radiogroup" aria-label="候选选题">
              {cards.map((card, index) => (
                <button key={card.id} type="button" role="radio" aria-checked={selectedId === card.id}
                  className={`topic-card${selectedId === card.id ? ' selected' : ''}`}
                  data-testid="topic-card" onClick={() => store.selectTopic(card.id)}>
                  <div className="topic-card-index">0{index + 1}</div>
                  <h2>{card.question}</h2>
                  <p>{card.angle}</p>
                  <div className="topic-card-values">
                    {card.readerValues.map(value => <Tag key={value.kind}>{readerValueLabel(value.kind)}</Tag>)}
                  </div>
                  <div className="topic-card-meta">{statisticsLabel(card.statistics)}</div>
                  <div className="topic-card-footer">
                    <span>{confidenceLabel(card.evidenceConfidence.level)}</span>
                    <span>传播未验证</span>
                  </div>
                </button>
              ))}
            </div>
            {!selected && <div className="topic-pick-hint">选一个你想继续判断的题目，再展开依据和起笔结构。</div>}
          </>
        )}

        {selected && result && <TopicDetail card={selected} runId={result.runId} />}
      </div>
    </div>
  )
}
