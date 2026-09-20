import { useEffect, useMemo, useState } from 'react'
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

function configReady(config: TopicAiConfigStatus | null): boolean {
  return !!config?.baseUrl.trim() && !!config.model.trim() && config.keyConfigured
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
  const [config, setConfig] = useState<TopicAiConfigStatus | null>(null)
  const [preset, setPreset] = useState<TopicPreset>('24h')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('')
  const [result, setResult] = useState<TopicRunResult | null>(null)
  const [excludedCount, setExcludedCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const cards = useMemo(() => usableCards(result), [result])
  const selected = cards.find(card => card.id === selectedId) ?? null

  useEffect(() => { api.topicsGetConfig().then(setConfig).catch(() => setConfig(null)) }, [])
  useEffect(() => api.onTopicsProgress(next => setStage(stageLabel(next))), [])

  const analyze = async () => {
    if (!configReady(config)) { message.warning('先配置选题 AI 服务'); return }
    if (preset === 'custom' && (!from || !to)) { message.warning('请选择完整的开始和结束日期'); return }
    const window: TopicWindowInput = preset === 'custom' ? { preset, from, to } : { preset }
    setLoading(true)
    setStage('正在准备分析')
    setResult(null)
    setSelectedId(null)
    setExcludedCount(0)
    try {
      const response = await api.topicsAnalyze({ window })
      if (!response.ok) { message.error(response.error.message); return }
      setResult(response.result)
      setExcludedCount(response.timeExcludedCount)
    } catch (error) { message.error('分析失败：' + (error as Error).message) }
    finally { setLoading(false); setStage('') }
  }

  const cancel = async () => {
    const response = await api.topicsCancel()
    if (!response.ok) message.info(response.error?.message ?? '当前没有正在进行的分析。')
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
            <Select data-testid="topic-range" value={preset} options={RANGE_OPTIONS} style={{ width: 168 }}
              onChange={(value: TopicPreset) => setPreset(value)} />
            {preset === 'custom' && (
              <div className="topic-custom-dates">
                <input type="date" data-testid="topic-date-from" value={from} onChange={event => setFrom(event.target.value)} />
                <span>至</span>
                <input type="date" data-testid="topic-date-to" value={to} onChange={event => setTo(event.target.value)} />
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
          <div className="surface topic-loading"><Spin /><strong>{stage || '正在分析'}</strong><span>这一次只读取你选定时间范围内的本地素材。</span></div>
        )}

        {notice && (
          <Alert className="topic-alert" type={notice.tone} showIcon message={notice.text}
            description={excludedCount > 0 ? `另有 ${excludedCount} 篇因发表时间不在所选范围或不确定而未纳入。` : undefined} />
        )}

        {cards.length > 0 && (
          <>
            <div className="topic-grid" role="radiogroup" aria-label="候选选题">
              {cards.map((card, index) => (
                <button key={card.id} type="button" role="radio" aria-checked={selectedId === card.id}
                  className={`topic-card${selectedId === card.id ? ' selected' : ''}`}
                  data-testid="topic-card" onClick={() => setSelectedId(card.id)}>
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
