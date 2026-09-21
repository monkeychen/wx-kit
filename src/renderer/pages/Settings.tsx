import { useEffect, useMemo, useState } from 'react'
import { Input, Button, Space, InputNumber, Popconfirm, Switch, Select, Segmented, Tooltip, message } from 'antd'
import { FolderOpenOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { api } from '../api'
import FormatPicker from '../components/FormatPicker'
import SettingsCategoryNav, { type SettingsCategoryStatus } from '../components/SettingsCategoryNav'
import { SettingsGroup, SettingsRow } from '../components/SettingsGroup'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AppSettings } from '../../../electron/services/settings'
import type { TopicAiConfigStatus, UpdateInfo, UpdateChannelInfo } from '../api'
import type { MpProtectionStatus } from '../api'
import { useWereadLoginQr } from '../hooks/useWereadLoginQr'
import type { MpAuthActionResult, MpSessionInfo } from '../api'
import { DMG_POST_INSTALL_HINT } from '../../core/install-channel'
import type { DownloadFormat } from '../../core/types'
import { SETTINGS_CATEGORIES, isSettingsDirty, type SettingsCategory } from '../settings-view'

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [savedSettings, setSavedSettings] = useState<AppSettings | null>(null)
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('content')
  const [cliLink, setCliLink] = useState<Awaited<ReturnType<typeof api.cliLinkStatus>> | null>(null)
  const [topicAi, setTopicAi] = useState<TopicAiConfigStatus | null>(null)
  const [savedTopicAi, setSavedTopicAi] = useState<TopicAiConfigStatus | null>(null)
  const [topicAiBaseUrl, setTopicAiBaseUrl] = useState('')
  const [topicAiModel, setTopicAiModel] = useState('')
  const [topicAiKey, setTopicAiKey] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [ver, setVer] = useState('')
  // M37 更新检查:三态(未查 / 查询中 / 有结果),查不到用 'failed' 与「已是最新」区分开
  const [upd, setUpd] = useState<UpdateInfo | null>(null)
  const [updState, setUpdState] = useState<'idle' | 'checking' | 'done' | 'failed'>('idle')
  const [chan, setChan] = useState<UpdateChannelInfo | null>(null)
  const [dl, setDl] = useState<{ done: number; total: number } | null>(null)
  const [mpProtection, setMpProtection] = useState<MpProtectionStatus | null>(null)
  const [mpSession, setMpSession] = useState<MpSessionInfo | null>(null)
  const [mpAuthBusy, setMpAuthBusy] = useState<'login' | 'relogin' | 'logout' | null>(null)
  const [mpCleanupError, setMpCleanupError] = useState('')
  // M60 R3:墨问集成。读 settings 缓存渲染,「重新检测」走即时 IPC
  const [mowenChecking, setMowenChecking] = useState(false)
  const wereadQr = useWereadLoginQr()

  const redetectMowen = async () => {
    setMowenChecking(true)
    try {
      await api.mowenDetect()
      const persisted = await api.getSettings()
      setSavedSettings(persisted)
      setS(current => current ? {
        ...current,
        mowenMocliPath: persisted.mowenMocliPath,
        mowenMocliVersion: persisted.mowenMocliVersion,
        mowenDetectedAt: persisted.mowenDetectedAt,
      } : persisted)
      message.success('已重新检测')
    } catch (e) { message.error('检测失败：' + (e as Error).message) }
    finally { setMowenChecking(false) }
  }

  useEffect(() => {
    api.getSettings().then(value => { setS(value); setSavedSettings(structuredClone(value)) })
  }, [])
  useEffect(() => {
    api.topicsGetConfig().then(value => {
      setTopicAi(value)
      setSavedTopicAi(value)
      setTopicAiBaseUrl(value.baseUrl)
      setTopicAiModel(value.model)
    }).catch(() => { /* 选题配置失败不阻断其它设置 */ })
  }, [])
  useEffect(() => { api.cliLinkStatus().then(setCliLink) }, [])
  useEffect(() => { api.appVersion().then(setVer).catch(() => { /* 版本号缺失不阻塞设置页 */ }) }, [])
  useEffect(() => { api.updateChannel().then(setChan).catch(() => { /* 渠道识别失败就退回通用引导 */ }) }, [])
  useEffect(() => api.onUpdateProgress((p) => setDl({ done: p.done, total: p.total })), [])
  useEffect(() => { api.mpSessionInfo().then(setMpSession).catch(() => {}) }, [])
  useEffect(() => {
    let active = true
    const refresh = () => api.mpProtectionStatus().then((value) => { if (active) setMpProtection(value) }).catch(() => {})
    void refresh()
    // 状态查询只读本地文件；短轮询让排队数和等待窗口可见，不会产生微信请求。
    const timer = setInterval(refresh, 1_000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  const checkUpdateNow = async () => {
    setUpdState('checking')
    // 手动点击不受「每天一次」和开关约束 —— 用户主动问就该真去查
    const r = await api.updateCheck().catch(() => null)
    setUpd(r); setUpdState(r ? 'done' : 'failed')
  }
  const downloadUpdate = async () => {
    if (!upd) return
    setDl({ done: 0, total: 0 })
    const r = await api.updateDownload(upd.assets)
    setDl(null)
    if (r.ok) message.success('安装包已下载并打开')
    else message.warning(r.error === 'no-matching-asset' ? '没有匹配当前系统的安装包,请到发布页手动下载' : '下载失败:' + r.error)
  }

  const choose = async () => {
    const dir = await api.chooseDir()
    if (dir && s) setS({ ...s, libraryRoot: dir })
  }
  const clearTopicAiKey = async () => {
    try {
      const value = await api.topicsClearKey()
      setTopicAi(value)
      setSavedTopicAi(value)
      setTopicAiKey('')
      message.success('AI Key 已清除')
    } catch (error) { message.error('清除失败：' + (error as Error).message) }
  }
  const clearHistory = async () => {
    try { await api.historyClear(); message.success('已清空下载历史') }
    catch (e) { message.error('清空失败：' + (e as Error).message) }
  }
  const rebuildIndex = async () => {
    try {
      const r = await api.libraryRebuild()
      message.success(`已重建文库索引：扫描 ${r.scanned} 篇，重建 ${r.rebuilt} 篇，跳过 ${r.skipped} 篇`)
    } catch (e) { message.error('重建失败：' + (e as Error).message) }
  }
  const createCliLink = async () => {
    try {
      const r = await api.cliLinkCreate(cliLink?.status === 'conflict')
      if (r.transient) {
        message.warning('当前从开发/构建目录运行，命令行入口暂不创建——请从正式安装的 wx-kit 启动后再试')
        return
      }
      if (cliLink && !cliLink.inPath) {
        const r = await api.cliLinkAddToPath()
        message.success(`已创建，并将 ~/bin 写入 ${r.profilePath}，重开终端生效`)
      } else {
        message.success('已创建命令行快捷方式')
      }
      setCliLink(await api.cliLinkStatus())
    } catch (e) { message.error('创建失败：' + (e as Error).message) }
  }
  const pauseMpRequests = async () => {
    try { setMpProtection(await api.mpProtectionPause()); message.success('已暂停所有微信请求') }
    catch (e) { message.error('暂停失败：' + (e as Error).message) }
  }
  const resumeMpRequests = async () => {
    try {
      setMpProtection(await api.mpProtectionResume())
      message.success('已恢复请求许可；当前没有发起任何微信请求')
    } catch (e) { message.error('恢复失败：' + (e as Error).message) }
  }
  const explainAuthFailure = (result: MpAuthActionResult) => {
    if (result.code === 'MP_GOVERNOR_PAUSED' || result.code === 'MP_RATE_LIMITED') {
      message.warning((result.error ?? '微信请求已暂停') + '；请先查看上方“微信请求保护”')
    } else if (result.error !== 'CANCELLED') {
      message.error('登录失败：' + (result.error ?? '未知错误'))
    }
  }
  const refreshMpSession = async () => {
    const value = await api.mpSessionInfo()
    setMpSession(value)
    return value
  }
  const doMpLogin = async (relogin: boolean) => {
    setMpAuthBusy(relogin ? 'relogin' : 'login')
    setMpCleanupError('')
    try {
      const result = relogin ? await api.mpRelogin() : await api.mpLogin()
      await refreshMpSession()
      if (result.ok) message.success(relogin ? '已重新登录' : '已登录')
      else if (result.error === 'CANCELLED') {
        message.info(relogin ? '已取消重新登录，旧登录态已经清除' : '已取消登录')
      } else explainAuthFailure(result)
    } catch (e) { message.error('登录失败：' + (e as Error).message) }
    finally { setMpAuthBusy(null) }
  }
  const doMpLogout = async () => {
    setMpAuthBusy('logout')
    try {
      const result = await api.mpLogout()
      await refreshMpSession()
      if (result.ok) { setMpCleanupError(''); message.success('已彻底退出登录，设置和文库均已保留') }
      else explainAuthFailure(result)
    } catch (e) {
      const text = '退出失败：' + (e as Error).message
      setMpCleanupError(text); message.error(text)
    } finally { setMpAuthBusy(null) }
  }

  const dirty = useMemo(() => isSettingsDirty({
    savedSettings,
    draftSettings: s,
    savedTopic: savedTopicAi,
    topicDraft: { baseUrl: topicAiBaseUrl, model: topicAiModel, apiKey: topicAiKey },
  }), [savedSettings, s, savedTopicAi, topicAiBaseUrl, topicAiModel, topicAiKey])

  const topicDirty = topicAiKey.trim().length > 0
    || topicAiBaseUrl.trim() !== (savedTopicAi?.baseUrl.trim() ?? '')
    || topicAiModel.trim() !== (savedTopicAi?.model.trim() ?? '')

  const saveAll = async () => {
    if (!s || !dirty) return
    if (topicDirty && !topicAiKey.trim() && !savedTopicAi?.keyConfigured) {
      message.warning('首次配置请填写 API Key')
      setActiveCategory('ai')
      return
    }
    setSettingsSaving(true)
    try {
      let nextSettings = s
      let nextTopic = savedTopicAi
      if (topicDirty) {
        nextTopic = await api.topicsSaveConfig({
          baseUrl: topicAiBaseUrl,
          model: topicAiModel,
          ...(topicAiKey.trim() ? { apiKey: topicAiKey } : {}),
        })
        nextSettings = { ...s, topicAiBaseUrl: nextTopic.baseUrl, topicAiModel: nextTopic.model }
      }
      const persisted = await api.saveSettings(nextSettings)
      setS(persisted)
      setSavedSettings(structuredClone(persisted))
      if (nextTopic) {
        setTopicAi(nextTopic)
        setSavedTopicAi(nextTopic)
        setTopicAiBaseUrl(nextTopic.baseUrl)
        setTopicAiModel(nextTopic.model)
      }
      setTopicAiKey('')
      message.success('已保存更改')
    } catch (error) { message.error('保存失败：' + (error as Error).message) }
    finally { setSettingsSaving(false) }
  }

  const revertDraft = () => {
    if (savedSettings) setS(structuredClone(savedSettings))
    setTopicAiBaseUrl(savedTopicAi?.baseUrl ?? '')
    setTopicAiModel(savedTopicAi?.model ?? '')
    setTopicAiKey('')
  }

  const categoryStatuses: Record<SettingsCategory, SettingsCategoryStatus> = {
    content: 'ok',
    accounts: mpSession?.loggedIn && s?.mowenMocliPath ? 'ok' : mpSession?.loggedIn || s?.mowenMocliPath ? 'warning' : 'off',
    automation: s?.subscriptionAutoCheck || s?.siteSyncEnabled ? 'ok' : 'off',
    ai: topicAi?.keyConfigured ? 'ok' : 'off',
    system: mpProtection?.mode && mpProtection.mode !== 'active' ? 'warning' : 'ok',
  }

  const category = SETTINGS_CATEGORIES.find(item => item.id === activeCategory)!
  const categoryCount: Record<SettingsCategory, string> = {
    content: '4 项设置', accounts: '2 个连接', automation: '2 组设置',
    ai: '2 组设置', system: '高级设置',
  }

  if (!s) return <div className="page"><div className="faint">加载中…</div></div>

  return (
    <div className="page">
      <div className="fade-in">
        <div className="page-head">
          <div className="eyebrow">Settings</div>
          <h1 className="page-title">设置</h1>
          <p className="page-sub">所有账户、服务与偏好仍在这里，通过分类降低寻找成本。</p>        </div>

        <div className="settings-shell">
          <SettingsCategoryNav value={activeCategory} onChange={setActiveCategory} statuses={categoryStatuses} />
          <div className="settings-main">
            <div className="settings-panel-head">
              <div>
                <h2>{category.label}</h2>
                <p>{category.panelDescription}</p>
              </div>
              <span className="settings-panel-count">{categoryCount[activeCategory]}</span>
            </div>
            <div className="settings-summary" data-testid={`settings-summary-${activeCategory}`}>
              {activeCategory === 'content' && <>
                <div><span>文库</span><strong>{s.libraryRoot.replace(/^\/Users\/[^/]+/, '~')}</strong></div>
                <div><span>默认格式</span><strong>{s.defaultFormats.length} 种</strong></div>
                <div><span>视频</span><strong className={s.downloadVideos ? 'ok' : ''}>{s.downloadVideos ? '自动下载' : '跳过'}</strong></div>
              </>}
              {activeCategory === 'accounts' && <>
                <div><span>微信读书</span><strong className={mpSession?.loggedIn ? 'ok' : ''}>{mpSession ? mpSession.loggedIn ? '已登录' : '未登录' : '读取中'}</strong></div>
                <div><span>墨问 CLI</span><strong className={s.mowenMocliPath ? 'ok' : ''}>{s.mowenMocliPath ? '已检测' : '未检测'}</strong></div>
                <div><span>数据</span><strong>仅保存在本机</strong></div>
              </>}
              {activeCategory === 'automation' && <>
                <div><span>订阅检查</span><strong className={s.subscriptionAutoCheck ? 'ok' : ''}>{s.subscriptionAutoCheck ? '已开启' : '未开启'}</strong></div>
                <div><span>新文章</span><strong>{s.subscriptionNewArticleAction === 'download' ? '自动下载' : '仅提示'}</strong></div>
                <div><span>站点同步</span><strong>{s.siteSyncEnabled ? '已开启' : '未开启'}</strong></div>
              </>}
              {activeCategory === 'ai' && <>
                <div><span>选题模型</span><strong className={topicAi?.keyConfigured ? 'ok' : ''}>{topicAi ? topicAi.keyConfigured ? '已配置' : '未配置' : '读取中'}</strong></div>
                <div><span>Key</span><strong>{topicAi ? topicAi.keyConfigured ? topicAi.keyPersistent ? '已安全保存' : '仅本次会话' : '未配置' : '读取中'}</strong></div>
                <div><span>命令行</span><strong>{cliLink?.status === 'linked' ? '已创建' : '未创建'}</strong></div>
              </>}
              {activeCategory === 'system' && <>
                <div><span>微信请求</span><strong className={mpProtection?.mode === 'active' ? 'ok' : ''}>{mpProtection ? mpProtection.mode === 'active' ? '保护正常' : '已暂停' : '读取中'}</strong></div>
                <div><span>诊断日志</span><strong>默认开启</strong></div>
                <div><span>当前版本</span><strong>v{ver || '—'}</strong></div>
              </>}
            </div>

            <div className="settings-panel" data-testid={`settings-panel-${activeCategory}`}>
          {activeCategory === 'system' && <SettingsGroup testId="settings-group-mp-protection" legacyTestId="mp-protection" title="微信请求保护" description="所有公众号、文章和媒体请求共用全局队列；频控时立即停手。"
            status={!mpProtection ? undefined : mpProtection.mode === 'active'
              ? { text: '可按需请求', tone: 'ok' }
              : mpProtection.mode === 'rate-limited'
                ? { text: '频控熔断', tone: 'warning' }
                : { text: '已暂停', tone: 'off' }}>
            {mpProtection ? (
              <>
                <SettingsRow label="队列状态"
                  hint={<>
                    <span data-testid="mp-protection-next">上次请求 {mpProtection.lastRequestAt ? new Date(mpProtection.lastRequestAt).toLocaleString() : '暂无'}，本进程排队 {mpProtection.queued} 项，最早可执行：{mpProtection.mode === 'active' && mpProtection.nextAllowedAt > Date.now()
                      ? new Date(mpProtection.nextAllowedAt).toLocaleString()
                      : mpProtection.mode === 'active' ? '现在' : '需先手动恢复请求许可'}</span>。
                  </>}>
                  {mpProtection.mode === 'active' ? (
                    <Popconfirm title="暂停所有微信请求？"
                      description="暂停后下载、订阅等需要微信网络的动作都会停止，本地浏览不受影响。"
                      okText="暂停" cancelText="取消" onConfirm={pauseMpRequests}>
                      <Button danger data-testid="mp-protection-pause">暂停所有微信请求</Button>
                    </Popconfirm>
                  ) : (
                    <Popconfirm
                      title="恢复微信请求许可？"
                      description="恢复动作本身不会联网；之后只有你的明确操作或已开启的订阅计划才会申请请求。"
                      okText="恢复" cancelText="继续暂停" onConfirm={resumeMpRequests}>
                      <Button type="primary" data-testid="mp-protection-resume">恢复请求许可</Button>
                    </Popconfirm>
                  )}
                </SettingsRow>
                <div data-testid="mp-protection-mode" className="setting-hint" style={{ marginTop: 4 }}>
                  当前状态：<strong>{mpProtection.mode === 'active' ? '已启用保护，可按需请求'
                    : mpProtection.mode === 'rate-limited' ? '频控熔断，所有微信请求已停止'
                      : '用户暂停，所有微信请求已停止'}</strong>
                </div>
                {(mpProtection.pausedReason || mpProtection.rateLimitSignal) && (
                  <div className="setting-hint" data-testid="mp-protection-reason" style={{ marginTop: 4 }}>
                    {mpProtection.pausedReason ?? mpProtection.rateLimitSignal}
                  </div>
                )}
              </>
            ) : <div className="faint" style={{ marginTop: 8 }}>正在读取保护状态…</div>}
          </SettingsGroup>}

          {activeCategory === 'accounts' && <SettingsGroup testId="settings-group-weread" legacyTestId="mp-account" title="微信读书账号" description="用于识别公众号和订阅最新文章。"
            status={!mpSession ? undefined : mpSession.loggedIn
              ? { text: '已登录', tone: 'ok' }
              : { text: '未登录', tone: 'off' }}>
            {(mpAuthBusy === 'login' || mpAuthBusy === 'relogin') && (
              <div style={{ textAlign: 'center', margin: '10px 0' }} data-testid="set-weread-qr">
                {!wereadQr.qrDataUrl && <span className="faint">正在生成二维码…</span>}
                {wereadQr.qrDataUrl && (
                  <>
                    <img src={wereadQr.qrDataUrl} alt="微信读书登录二维码" width={200} height={200} />
                    <div className="faint">{wereadQr.scanned ? '已扫码，请在手机上确认登录…' : '请用微信扫码登录'}</div>
                  </>
                )}
              </div>
            )}
            <SettingsRow label="当前账号"
              hint={mpSession?.loggedIn && mpSession.loginAt ? `扫码于 ${new Date(mpSession.loginAt).toLocaleString()}，不影响文库文件。` : '扫码后即可按公众号下载与订阅。'}>
              {mpCleanupError ? (
                <Space align="center">
                  <span data-testid="set-mp-status" style={{ color: 'var(--cinnabar)' }}>
                    退出未完成，仍可能残留登录数据
                  </span>
                  <Button danger loading={mpAuthBusy === 'logout'} onClick={doMpLogout}
                    data-testid="set-mp-logout-retry">重试清理</Button>
                </Space>
              ) : mpSession?.loggedIn ? (
                <Space align="center">
                  <span className="faint" data-testid="set-mp-status">已登录</span>
                  <Button loading={mpAuthBusy === 'relogin'} disabled={mpAuthBusy !== null && mpAuthBusy !== 'relogin'}
                    onClick={() => doMpLogin(true)} data-testid="set-mp-relogin">重新登录</Button>
                  <Popconfirm title="彻底退出登录？"
                    description="只删微信读书凭据文件；设置、订阅、文库及频控状态都会保留。"
                    okText="退出" cancelText="取消" onConfirm={doMpLogout}>
                    <Button danger loading={mpAuthBusy === 'logout'} disabled={mpAuthBusy !== null && mpAuthBusy !== 'logout'}
                      data-testid="set-mp-logout">退出登录</Button>
                  </Popconfirm>
                </Space>
              ) : mpSession ? (
                <Space align="center">
                  <span className="faint" data-testid="set-mp-status">未登录</span>
                  <Button type="primary" loading={mpAuthBusy === 'login'} disabled={mpAuthBusy !== null && mpAuthBusy !== 'login'}
                    onClick={() => doMpLogin(false)} data-testid="set-mp-login">扫码登录</Button>
                </Space>
              ) : <span className="faint" data-testid="set-mp-status">正在读取登录状态…</span>}
            </SettingsRow>
            {mpCleanupError && <div className="setting-hint" style={{ color: 'var(--cinnabar)', marginTop: 6 }}>{mpCleanupError}</div>}
          </SettingsGroup>}

          {activeCategory === 'content' && <SettingsGroup testId="settings-group-library" title="文章库" description="文章、图片与索引的本地保存位置。"
            status={{ text: '正常', tone: 'ok' }}>
            <SettingsRow label="文库位置" hint="修改后不迁移旧文件，可随时改回。">
              <Space.Compact>
                <Input value={s.libraryRoot} readOnly style={{ minWidth: 320 }} />
                <Button icon={<FolderOpenOutlined />} onClick={choose}>选择目录</Button>
              </Space.Compact>
            </SettingsRow>
            <SettingsRow label="文库索引" hint="列表异常为空时，从文章目录重建。">
              <Popconfirm title="重建文库索引？" description="扫描库目录重建 library.json，不会删除任何文章文件。"
                okText="重建" cancelText="取消" onConfirm={rebuildIndex}>
                <Button>重建索引</Button>
              </Popconfirm>
            </SettingsRow>
          </SettingsGroup>}

          {activeCategory === 'content' && <SettingsGroup testId="settings-group-download" title="下载偏好" description="新任务的默认选择，下载时仍可临时调整。">
            <SettingsRow label="默认格式" hint="封面、Markdown、网页与元数据。">
              <FormatPicker value={s.defaultFormats}
                onChange={(v: DownloadFormat[]) => setS({ ...s, defaultFormats: v })} />
            </SettingsRow>

            <SettingsRow label="文中视频" hint="视频可能较大，可在单次下载时覆盖。">
              <Space align="center">
                <span className="faint">{s.downloadVideos ? '有视频就下载' : '跳过视频'}</span>
                <Switch checked={s.downloadVideos} data-testid="set-download-videos"
                  onChange={(v) => setS({ ...s, downloadVideos: v })} />
              </Space>
            </SettingsRow>

            <SettingsRow label="下载历史" hint="只清操作记录，不删除已下载文章。">
              <Space align="center">
                <InputNumber min={1} max={3650} value={s.historyRetentionDays} data-testid="set-history-retention"
                  onChange={(v) => setS({ ...s, historyRetentionDays: v ?? 365 })} addonAfter="天" />
                <Popconfirm title="清空下载历史？" description="只清记录，不删已下载的文件。"
                  okText="清空" cancelText="取消" onConfirm={clearHistory}>
                  <Button danger>清空历史</Button>
                </Popconfirm>
              </Space>
            </SettingsRow>
          </SettingsGroup>}

          {activeCategory === 'automation' && <SettingsGroup testId="settings-group-subscriptions" title="订阅自动检查" description="仅在应用打开时运行，错过的检查在下次启动补做。"
            status={s.subscriptionAutoCheck
              ? { text: '已开启', tone: 'ok' }
              : { text: '已关闭', tone: 'off' }}>
            <SettingsRow label="自动检查" hint="公众号与墨问作者共用这套调度偏好。">
              <Space align="center">
                <span className="faint">{s.subscriptionAutoCheck ? '开启' : '关闭'}</span>
                <Switch checked={s.subscriptionAutoCheck} data-testid="set-subs-auto"
                  onChange={(v) => setS({ ...s, subscriptionAutoCheck: v })} />
              </Space>
            </SettingsRow>
            <SettingsRow label="检查频率" hint="可选每天固定时刻或间隔小时。">
              {s.subscriptionScheduleMode === 'daily' ? (
                <Space align="center">
                  <Segmented value={s.subscriptionScheduleMode} data-testid="set-subs-mode"
                    onChange={(v) => setS({ ...s, subscriptionScheduleMode: v as 'daily' | 'interval' })}
                    options={[{ label: '每天某时刻', value: 'daily' }, { label: '每隔N小时', value: 'interval' }]} />
                  <input type="time" value={s.subscriptionCheckTime} data-testid="set-subs-time"
                    onChange={(e) => setS({ ...s, subscriptionCheckTime: e.target.value })}
                    style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }} />
                </Space>
              ) : (
                <Space align="center">
                  <Segmented value={s.subscriptionScheduleMode} data-testid="set-subs-mode"
                    onChange={(v) => setS({ ...s, subscriptionScheduleMode: v as 'daily' | 'interval' })}
                    options={[{ label: '每天某时刻', value: 'daily' }, { label: '每隔N小时', value: 'interval' }]} />
                  <InputNumber min={1} max={24} value={s.subscriptionIntervalHours} data-testid="set-subs-interval"
                    onChange={(v) => setS({ ...s, subscriptionIntervalHours: v ?? 6 })} addonAfter="小时" />
                </Space>
              )}
            </SettingsRow>
            <SettingsRow label="发现新文章时" hint="只提示，或自动下载到文库。完整检查历史见检查日志。">
              <Space align="center">
                <Select value={s.subscriptionNewArticleAction} style={{ width: 140 }} data-testid="set-subs-action"
                  onChange={(v) => setS({ ...s, subscriptionNewArticleAction: v })}
                  options={[{ value: 'notify', label: '仅提示' }, { value: 'download', label: '自动下载' }]} />
                <Button onClick={() => api.subscriptionsOpenLog()} data-testid="set-open-checklog">检查日志</Button>
              </Space>
            </SettingsRow>
          </SettingsGroup>}

          {activeCategory === 'automation' && <SettingsGroup testId="settings-group-site-sync" title={<>站点同步
              {/* 建站指引藏在 ? 后面:只有「也想搭个站」的人才需要,常驻正文是噪音 */}
              <Tooltip
                placement="right"
                styles={{ root: { maxWidth: 360 } }}
                title={
                  <span>
                    同步目标是一个 Astro 静态站。我的开源项目 <b>dreamble</b> 的 <code>site/</code> 子目录
                    就是这个站点的完整源码——主题、发文规范、构建脚本都在里面,想自建个人站可直接取用。
                    <br />
                    <a onClick={() => api.openExternal('https://github.com/monkeychen/dreamble')}
                      style={{ color: '#8ecbff' }}>github.com/monkeychen/dreamble</a>
                  </span>
                }
              >
                <QuestionCircleOutlined data-testid="site-sync-help"
                  style={{ marginLeft: 6, fontSize: 13, opacity: 0.5, cursor: 'help' }} />
              </Tooltip>
            </>} description="把文库文章转换为 Astro 站点目录，不会自动发布。"
            status={s.siteSyncEnabled
              ? { text: '已启用', tone: 'ok' }
              : { text: '未启用', tone: 'off' }}>
            <SettingsRow label="启用站点同步" hint="开启后，文库批量栏显示「同步到站点」。">
              <Space align="center">
                <span className="faint">{s.siteSyncEnabled ? '开启' : '关闭'}</span>
                <Switch checked={s.siteSyncEnabled} data-testid="set-site-sync"
                  onChange={(v) => setS({ ...s, siteSyncEnabled: v })} />
              </Space>
            </SettingsRow>
            {s.siteSyncEnabled && (
              <SettingsRow label="站点目录" hint="Astro 站点的 content/posts 目录，纯本地文件操作。">
                <Space.Compact>
                  <Input value={s.siteSyncPostsDir} data-testid="set-site-sync-dir" style={{ minWidth: 320 }}
                    onChange={(e) => setS({ ...s, siteSyncPostsDir: e.target.value })}
                    placeholder="站点 content/posts 目录" />
                  <Button icon={<FolderOpenOutlined />} onClick={async () => {
                    const dir = await api.chooseDir()
                    if (dir) setS({ ...s, siteSyncPostsDir: dir })
                  }}>选择目录</Button>
                </Space.Compact>
              </SettingsRow>
            )}
          </SettingsGroup>}

          {activeCategory === 'ai' && cliLink?.supported && (
            <SettingsGroup testId="settings-group-cli" title="命令行快捷方式" status={cliLink.status === 'linked' ? { text: '已创建', tone: 'ok' } : { text: '未创建', tone: 'off' }} description="供终端和 AI Agent 调用同一套 wx-kit 能力。">
              <SettingsRow label="命令位置"
                hint={<>{cliLink.dir}。{cliLink.status === 'conflict' && '该位置被占用（创建将覆盖）'}{!cliLink.inPath && '；~/bin 不在 PATH，创建时会引导写入 shell 配置'}。</>}>
                {cliLink.transient ? (
                  <span className="faint" style={{ color: 'var(--warning, #d46b08)' }}>开发目录运行中，暂不可创建</span>
                ) : (
                  <Button onClick={createCliLink} data-testid="set-cli-link">
                    {cliLink.status === 'linked' ? '重新创建' : '创建命令行快捷方式'}
                  </Button>
                )}
              </SettingsRow>
            </SettingsGroup>
          )}

          {activeCategory === 'ai' && <SettingsGroup testId="settings-group-topic-ai" legacyTestId="topic-ai-section" title="选题 AI"             status={!topicAi ? undefined : topicAi.keyConfigured
            ? { text: topicAi.keyPersistent ? 'Key 已加密' : 'Key 仅本次会话', tone: topicAi.keyPersistent ? 'ok' : 'warning' }
            : { text: 'Key 未配置', tone: 'off' }} description="分析时，所选文章正文会发送到你配置的服务。">
            {/* 对齐原型：隐私提示用醒目 callout 而非普通 description（正文出机事实须明示） */}
            <div className="settings-callout" data-testid="topic-ai-privacy-callout">
              隐私提示：分析时所选文章正文会发送到你配置的服务；Base URL 与模型名保存在普通设置，API Key 使用系统安全存储。wx-kit 不托管模型额度。
            </div>
            <SettingsRow label="Base URL" hint="OpenAI Chat Completions 兼容地址。">
              <Input data-testid="topic-ai-base-url" value={topicAiBaseUrl} style={{ minWidth: 320 }}
                onChange={event => setTopicAiBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1" />
            </SettingsRow>
            <SettingsRow label="Model" hint="由你的服务商提供的模型名称。">
              <Input data-testid="topic-ai-model" value={topicAiModel} style={{ minWidth: 320 }}
                onChange={event => setTopicAiModel(event.target.value)}
                placeholder="例如 gpt-4.1-mini" />
            </SettingsRow>
            <SettingsRow label="API Key" hint="留空即保留当前 Key。">
              <Space align="center">
                <Input.Password data-testid="topic-ai-key" value={topicAiKey} style={{ minWidth: 260 }}
                  onChange={event => setTopicAiKey(event.target.value)}
                  autoComplete="new-password"
                  placeholder={topicAi?.keyConfigured ? '已配置；留空即保留原 Key' : '输入 API Key'} />
                {topicAi?.keyConfigured && <Button danger data-testid="topic-ai-clear-key" onClick={clearTopicAiKey}>清除</Button>}
              </Space>
            </SettingsRow>
            <div className="settings-row" style={{ border: 0, minHeight: 'auto' }}>
              <div className="settings-row-copy">
                <span className={`badge ${topicAi?.keyConfigured ? 'badge-ok' : 'badge-cancel'}`}
                  data-testid="topic-ai-key-status">
                  {!topicAi ? '正在读取'
                    : !topicAi.keyConfigured ? '未配置'
                      : topicAi.keyPersistent ? '已安全保存' : '仅本次会话，重启需重填'}
                </span>
                {topicAi?.keyConfigured && !topicAi.keyPersistent && (
                  <small style={{ color: 'var(--amber)' }}>系统加密能力不可用，Key 仅存于本次运行内存。</small>
                )}
              </div>
            </div>
          </SettingsGroup>}

          {activeCategory === 'accounts' && <SettingsGroup testId="settings-group-mowen" legacyTestId="mowen-section" title="墨问集成" status={s?.mowenMocliPath
            ? { text: s.mowenMocliVersion ? `已检测 · ${s.mowenMocliVersion}` : '已检测', tone: 'ok' }
            : { text: '未检测', tone: 'off' }} description="发现用户与批量清单依赖 mocli，正文下载仍由 wx-kit 完成。">
            {s?.mowenMocliPath ? (
              <SettingsRow label="mocli 路径" hint="墨问官方命令行，检测到后下载页即可使用墨问相关功能。">
                <Space align="center">
                  <code data-testid="mowen-path">{s.mowenMocliPath}</code>
                  <Button loading={mowenChecking} onClick={redetectMowen} data-testid="mowen-redetect">重新检测</Button>
                </Space>
              </SettingsRow>
            ) : (
              <>
                <div className="setting-hint" data-testid="mowen-status-missing">
                  未检测到 mocli。请先安装并完成认证：
                  <pre style={{ margin: '6px 0 0' }}><code>npm install -g @mowenxd/cli{'\n'}mocli auth init --apik &lt;你的墨问 API Key&gt;</code></pre>
                  <span className="faint">API Key 在墨问小程序「我的 → 开发者 → 我的 API Key」获取。</span>
                </div>
                <Button style={{ marginTop: 8 }} loading={mowenChecking}
                  onClick={redetectMowen} data-testid="mowen-redetect">重新检测</Button>
              </>
            )}
            {s?.mowenMocliPath && <div className="setting-hint" data-testid="mowen-status-installed" style={{ marginTop: 8 }}>
              已检测到 mocli{s.mowenMocliVersion ? <>（版本 <span data-testid="mowen-version">{s.mowenMocliVersion}</span>）</> : null}，下载页即可使用墨问相关功能。
            </div>}
          </SettingsGroup>}

          {activeCategory === 'system' && <SettingsGroup testId="settings-group-diagnostics" title="诊断" description="日志已自动脱敏，不会远程上传。">
            <SettingsRow label="main.log" hint="报障时可把日志文件发给开发者。">
              <Button data-testid="diag-open-logs"
                onClick={async () => {
                  try {
                    const r = await api.diagOpenLogsFolder()
                    if (!r.ok) message.warning(r.error ?? '打开失败')
                  } catch { message.error('打开日志文件夹失败') }
                }}>打开日志文件夹</Button>
            </SettingsRow>
          </SettingsGroup>}

          {activeCategory === 'system' && <SettingsGroup testId="settings-group-about" title="关于 wx-kit" description="版本、更新渠道和项目入口。">
            <SettingsRow label={<span>当前版本 <strong data-testid="about-version">v{ver || '—'}</strong></span>}
              hint="启动时每天最多检查一次更新，不上传其它数据。">
              <Space align="center">
                <Button data-testid="about-homepage"
                  onClick={() => api.openExternal('https://github.com/monkeychen/wx-kit')}>项目主页</Button>
                <Button data-testid="about-check-update" loading={updState === 'checking'}
                  onClick={checkUpdateNow}>检查更新</Button>
                {updState === 'done' && upd && !upd.hasUpdate && (
                  <span className="faint" data-testid="about-up-to-date">已是最新 v{upd.latest}</span>
                )}
                {updState === 'failed' && (
                  <span className="faint" data-testid="about-check-failed">暂时查不到(网络问题),稍后再试</span>
                )}
              </Space>
            </SettingsRow>

            {/* 有新版才展开:版本号 + 发布说明 + 按渠道给一键动作 */}
            {upd?.hasUpdate && (
              <div className="update-box" data-testid="about-update-box">
                <div className="update-head">
                  发现新版 <strong>v{upd.latest}</strong>
                  {upd.publishedAt && <span className="faint">（{upd.publishedAt.slice(0, 10)} 发布）</span>}
                </div>
                {/* 发布说明是给人读的:裸着 markdown 标记(# / ** / -)只会添噪。
                    react-markdown 阅读器已在用,渲染它不引任何新依赖。 */}
                {upd.notes && (
                  <div className="update-notes" data-testid="update-notes">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}
                      components={{
                        // release body 的 h1/h2 在这个小框里当小标题就够,别撑成页面级标题
                        h1: ({ children }) => <div className="un-h">{children}</div>,
                        h2: ({ children }) => <div className="un-h">{children}</div>,
                        h3: ({ children }) => <div className="un-h">{children}</div>,
                        a: ({ href = '', children }) => (
                          <a onClick={() => api.openExternal(href)} style={{ cursor: 'pointer' }}>{children}</a>
                        ),
                      }}>
                      {upd.notes.trim()}
                    </ReactMarkdown>
                  </div>
                )}
                {chan?.command ? (
                  <>
                    <div className="setting-hint">
                      你是用 Homebrew 安装的。到终端执行下面这条命令即可升级（<b>三段都需要</b>：
                      不 <code>brew update</code> 会读到旧版本信息，不 <code>xattr</code> 应用会被系统拦住）：
                    </div>
                    <pre className="update-cmd" data-testid="update-command">{chan.command}</pre>
                    <Space>
                      <Button size="small" type="primary" data-testid="update-copy-cmd"
                        onClick={() => { api.copyText(chan.command!); message.success('命令已复制，到终端粘贴执行') }}>
                        复制命令
                      </Button>
                      <span className="faint">升级完成后重启应用</span>
                    </Space>
                  </>
                ) : (
                  <>
                    <div className="setting-hint">
                      下载后把 wx-kit 拖进「应用程序」覆盖，再执行 <code>{DMG_POST_INSTALL_HINT}</code>
                      （未签名应用需要这一步，否则会被系统拦住）。
                    </div>
                    <Space wrap>
                      <Button size="small" type="primary" data-testid="update-download"
                        loading={dl !== null} onClick={downloadUpdate}>
                        {dl ? `下载中 ${dl.total ? Math.round((dl.done / dl.total) * 100) : 0}%` : '下载并打开安装包'}
                      </Button>
                      <Button size="small" data-testid="update-copy-hint"
                        onClick={() => { api.copyText(DMG_POST_INSTALL_HINT); message.success('命令已复制') }}>
                        复制 xattr 命令
                      </Button>
                      <Button size="small" data-testid="about-releases"
                        onClick={() => api.openExternal('https://github.com/monkeychen/wx-kit/releases')}>打开发布页</Button>
                    </Space>
                  </>
                )}
              </div>
            )}

            <SettingsRow label="启动时检查更新" hint="每天最多查一次，只向 GitHub 请求版本信息，不上传任何数据。">
              <Space align="center">
                <span className="faint">{s.updateCheckEnabled ? '开启' : '关闭'}</span>
                <Switch checked={s.updateCheckEnabled} data-testid="set-update-check"
                  onChange={(v) => setS({ ...s, updateCheckEnabled: v })} />
              </Space>
            </SettingsRow>
          </SettingsGroup>}
            </div>

            <div className={`settings-save-bar${dirty ? ' dirty' : ''}`} data-testid="settings-save-bar">
              <span data-testid="settings-dirty-state">{dirty ? '有未保存的更改' : '没有未保存的更改'}</span>
              <Space>
                <Button data-testid="settings-revert" disabled={!dirty || settingsSaving} onClick={revertDraft}>撤销</Button>
                <Button type="primary" data-testid="settings-save" disabled={!dirty}
                  loading={settingsSaving} onClick={saveAll}>保存更改</Button>
              </Space>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
