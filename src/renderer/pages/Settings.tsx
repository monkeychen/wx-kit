import { useEffect, useState } from 'react'
import { Input, Button, Space, InputNumber, Popconfirm, Switch, Select, Segmented, Tooltip, message } from 'antd'
import { FolderOpenOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { api } from '../api'
import FormatPicker from '../components/FormatPicker'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AppSettings } from '../../../electron/services/settings'
import type { UpdateInfo, UpdateChannelInfo } from '../api'
import type { MpProtectionStatus } from '../api'
import { DMG_POST_INSTALL_HINT } from '../../core/install-channel'
import type { DownloadFormat } from '../../core/types'

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [cliLink, setCliLink] = useState<Awaited<ReturnType<typeof api.cliLinkStatus>> | null>(null)

  const [ver, setVer] = useState('')
  // M37 更新检查:三态(未查 / 查询中 / 有结果),查不到用 'failed' 与「已是最新」区分开
  const [upd, setUpd] = useState<UpdateInfo | null>(null)
  const [updState, setUpdState] = useState<'idle' | 'checking' | 'done' | 'failed'>('idle')
  const [chan, setChan] = useState<UpdateChannelInfo | null>(null)
  const [dl, setDl] = useState<{ done: number; total: number } | null>(null)
  const [mpProtection, setMpProtection] = useState<MpProtectionStatus | null>(null)

  useEffect(() => { api.getSettings().then(setS) }, [])
  useEffect(() => { api.cliLinkStatus().then(setCliLink) }, [])
  useEffect(() => { api.appVersion().then(setVer).catch(() => { /* 版本号缺失不阻塞设置页 */ }) }, [])
  useEffect(() => { api.updateChannel().then(setChan).catch(() => { /* 渠道识别失败就退回通用引导 */ }) }, [])
  useEffect(() => api.onUpdateProgress((p) => setDl({ done: p.done, total: p.total })), [])
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
  const save = async () => {
    if (!s) return
    try { await api.saveSettings(s); message.success('已保存') }
    catch (e) { message.error('保存失败：' + (e as Error).message) }
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
      await api.cliLinkCreate(cliLink?.status === 'conflict')
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

  if (!s) return <div className="page"><div className="faint">加载中…</div></div>

  return (
    <div className="page">
      <div className="fade-in">
        <div className="page-head">
          <div className="eyebrow">Settings</div>
          <h1 className="page-title">设置</h1>
        </div>

        <div className="surface">
          <div className="setting-block" data-testid="mp-protection">
            <div className="setting-label">微信请求保护</div>
            <div className="setting-hint">
              所有公众号后台、文章和媒体请求共用一个全局队列。检测到频控会立即停止，
              不会自动重试或探测恢复。
            </div>
            {mpProtection ? (
              <Space direction="vertical" size="small" style={{ width: '100%', marginTop: 8 }}>
                <div data-testid="mp-protection-mode">
                  当前状态：<strong>{mpProtection.mode === 'active' ? '已启用保护，可按需请求'
                    : mpProtection.mode === 'rate-limited' ? '频控熔断，所有微信请求已停止'
                      : '用户暂停，所有微信请求已停止'}</strong>
                </div>
                {(mpProtection.pausedReason || mpProtection.rateLimitSignal) && (
                  <div className="setting-hint" data-testid="mp-protection-reason">
                    {mpProtection.pausedReason ?? mpProtection.rateLimitSignal}
                  </div>
                )}
                <div className="setting-hint">
                  上次请求：{mpProtection.lastRequestAt ? new Date(mpProtection.lastRequestAt).toLocaleString() : '暂无'}；
                  本进程排队：{mpProtection.queued} 项
                </div>
                <div className="setting-hint" data-testid="mp-protection-next">
                  最早可执行：{mpProtection.mode === 'active' && mpProtection.nextAllowedAt > Date.now()
                    ? new Date(mpProtection.nextAllowedAt).toLocaleString()
                    : mpProtection.mode === 'active' ? '现在' : '需先手动恢复请求许可'}
                </div>
                {mpProtection.mode === 'active' ? (
                  <Button danger onClick={pauseMpRequests} data-testid="mp-protection-pause">暂停所有微信请求</Button>
                ) : (
                  <Popconfirm
                    title="恢复微信请求许可？"
                    description="恢复动作本身不会联网；之后只有你的明确操作或已开启的订阅计划才会申请请求。"
                    okText="恢复" cancelText="继续暂停" onConfirm={resumeMpRequests}>
                    <Button type="primary" data-testid="mp-protection-resume">恢复请求许可</Button>
                  </Popconfirm>
                )}
              </Space>
            ) : <div className="faint" style={{ marginTop: 8 }}>正在读取保护状态…</div>}
          </div>

          <div className="setting-block">
            <div className="setting-label">文章库位置</div>
            <div className="setting-hint">下载的文章与图片都保存在这里。改后文库列表会暂时变空，旧文章仍在原目录、可改回找回（不会自动迁移）。</div>
            <Space.Compact style={{ width: '100%' }}>
              <Input value={s.libraryRoot} readOnly />
              <Button icon={<FolderOpenOutlined />} onClick={choose}>选择目录</Button>
            </Space.Compact>
            <div className="setting-hint" style={{ marginTop: 10 }}>
              若文库列表异常为空或提示索引损坏，可从磁盘各文章目录的 meta.json 重建索引（不动已下载文件）。
            </div>
            <Popconfirm title="重建文库索引？" description="扫描库目录重建 library.json，不会删除任何文章文件。"
              okText="重建" cancelText="取消" onConfirm={rebuildIndex}>
              <Button style={{ marginTop: 8 }}>重建索引</Button>
            </Popconfirm>
          </div>

          <div className="setting-block">
            <div className="setting-label">默认下载格式</div>
            <div className="setting-hint">新建下载时预选这些格式，仍可临时调整。</div>
            <FormatPicker value={s.defaultFormats}
              onChange={(v: DownloadFormat[]) => setS({ ...s, defaultFormats: v })} />
          </div>

          <div className="setting-block">
            <div className="setting-label">文中视频</div>
            <div className="setting-hint">
              文章里带视频时一并下载（和图片一样，属于文章内容，无需在格式里勾选）。
              单个视频可达上百 MB——按公众号批量抓取前想省流量可以关掉。
            </div>
            <Space align="center">
              <Switch checked={s.downloadVideos} data-testid="set-download-videos"
                onChange={(v) => setS({ ...s, downloadVideos: v })} />
              <span className="faint">{s.downloadVideos ? '有视频就下载' : '跳过视频（正文会注明"含视频未下载"）'}</span>
            </Space>
          </div>

          <div className="setting-block">
            <div className="setting-label">下载历史</div>
            <div className="setting-hint">仅保留下载「动作」的记录，超期自动清理。清空或超期<b>只删记录，不会删除已下载的文件</b>。</div>
            <Space align="center" wrap>
              <span>保留最近</span>
              <InputNumber min={1} max={3650} value={s.historyRetentionDays}
                onChange={(v) => setS({ ...s, historyRetentionDays: v ?? 365 })} addonAfter="天" />
              <Popconfirm title="清空下载历史？" description="只清记录，不删已下载的文件。"
                okText="清空" cancelText="取消" onConfirm={clearHistory}>
                <Button danger>清空下载历史</Button>
              </Popconfirm>
            </Space>
          </div>

          <div className="setting-block">
            <div className="setting-label">订阅</div>
            <div className="setting-hint">检查仅在应用打开时进行；关闭时错过的检查会在下次启动补做一次。</div>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Space align="center">
                <span style={{ minWidth: 96, display: 'inline-block' }}>自动检查更新</span>
                <Switch checked={s.subscriptionAutoCheck} data-testid="set-subs-auto"
                  onChange={(v) => setS({ ...s, subscriptionAutoCheck: v })} />
              </Space>
              <Space align="center">
                <span style={{ minWidth: 96, display: 'inline-block' }}>检查频率</span>
                <Segmented value={s.subscriptionScheduleMode} data-testid="set-subs-mode"
                  onChange={(v) => setS({ ...s, subscriptionScheduleMode: v as 'daily' | 'interval' })}
                  options={[{ label: '每天某时刻', value: 'daily' }, { label: '每隔N小时', value: 'interval' }]} />
              </Space>
              {s.subscriptionScheduleMode === 'daily' ? (
                <Space align="center">
                  <span style={{ minWidth: 96, display: 'inline-block' }}>每日检查时刻</span>
                  <input type="time" value={s.subscriptionCheckTime} data-testid="set-subs-time"
                    onChange={(e) => setS({ ...s, subscriptionCheckTime: e.target.value })}
                    style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }} />
                </Space>
              ) : (
                <Space align="center">
                  <span style={{ minWidth: 96, display: 'inline-block' }}>每隔</span>
                  <InputNumber min={1} max={24} value={s.subscriptionIntervalHours} data-testid="set-subs-interval"
                    onChange={(v) => setS({ ...s, subscriptionIntervalHours: v ?? 6 })} addonAfter="小时" />
                </Space>
              )}
              <Space align="center">
                <span style={{ minWidth: 96, display: 'inline-block' }}>发现新文章时</span>
                <Select value={s.subscriptionNewArticleAction} style={{ width: 160 }} data-testid="set-subs-action"
                  onChange={(v) => setS({ ...s, subscriptionNewArticleAction: v })}
                  options={[{ value: 'notify', label: '仅提示' }, { value: 'download', label: '自动下载' }]} />
              </Space>
              <Space align="center">
                <span style={{ minWidth: 96, display: 'inline-block' }}>检查日志</span>
                <Button size="small" onClick={() => api.subscriptionsOpenLog()} data-testid="set-open-checklog">📄 打开检查日志</Button>
                <span className="faint" style={{ fontSize: 12.5 }}>完整检查历史,含每次失败原因</span>
              </Space>
            </Space>
          </div>

          <div className="setting-block">
            <div className="setting-label">
              站点同步
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
            </div>
            <div className="setting-hint">
              开启后，文库选中文章时会多出「同步到站点」——按个人站点的发布规范生成
              <code>YYYY-MM-DD-slug/index.md</code> 与同目录图片。纯本地文件操作，不联网。
            </div>
            <Space align="center" style={{ marginTop: 8 }}>
              <Switch checked={s.siteSyncEnabled} data-testid="set-site-sync"
                onChange={(v) => setS({ ...s, siteSyncEnabled: v })} />
              <span>{s.siteSyncEnabled ? '已开启' : '已关闭'}</span>
            </Space>
            {s.siteSyncEnabled && (
              <Space.Compact style={{ width: '100%', marginTop: 10 }}>
                <Input value={s.siteSyncPostsDir} data-testid="set-site-sync-dir"
                  onChange={(e) => setS({ ...s, siteSyncPostsDir: e.target.value })}
                  placeholder="站点 content/posts 目录" />
                <Button icon={<FolderOpenOutlined />} onClick={async () => {
                  const dir = await api.chooseDir()
                  if (dir) setS({ ...s, siteSyncPostsDir: dir })
                }}>选择目录</Button>
              </Space.Compact>
            )}
          </div>

          {cliLink?.supported && (
            <div className="setting-block">
              <div className="setting-label">命令行快捷方式</div>
              <div className="setting-hint">
                在 <code>{cliLink.dir}</code> 创建指向应用的快捷命令，便于在终端运行 <code>wx-kit</code>（供 AI agent 调用）。
                当前状态：{cliLink.status === 'linked' ? '已创建' : cliLink.status === 'conflict' ? '该位置被占用（创建将覆盖）' : '未创建'}
                {!cliLink.inPath && '；~/bin 不在 PATH，创建时会引导写入 shell 配置'}。
              </div>
              <Button style={{ marginTop: 8 }} onClick={createCliLink} data-testid="set-cli-link">
                {cliLink.status === 'linked' ? '重新创建' : '创建命令行快捷方式'}
              </Button>
            </div>
          )}
          <div className="setting-block">
            <div className="setting-label">关于</div>
            <div className="setting-hint">
              wx-kit（微信百宝箱）当前版本 <strong data-testid="about-version">v{ver || '—'}</strong>
              ——与命令行 <code>wx-kit --version</code> 同源。
            </div>
            <Space style={{ marginTop: 8 }} wrap>
              <Button size="small" data-testid="about-homepage"
                onClick={() => api.openExternal('https://github.com/monkeychen/wx-kit')}>项目主页</Button>
              <Button size="small" data-testid="about-check-update" loading={updState === 'checking'}
                onClick={checkUpdateNow}>检查更新</Button>
              {updState === 'done' && upd && !upd.hasUpdate && (
                <span className="faint" data-testid="about-up-to-date">已是最新 v{upd.latest}</span>
              )}
              {updState === 'failed' && (
                <span className="faint" data-testid="about-check-failed">暂时查不到(网络问题),稍后再试</span>
              )}
            </Space>

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

            <div style={{ marginTop: 12 }}>
              <Space align="center">
                <Switch checked={s.updateCheckEnabled} data-testid="set-update-check"
                  onChange={(v) => setS({ ...s, updateCheckEnabled: v })} />
                <span>启动时检查更新</span>
              </Space>
              <div className="setting-hint" style={{ marginTop: 4 }}>
                每天最多查一次，只向 GitHub 请求版本信息，<b>不上传任何数据</b>；关掉后仅在你点「检查更新」时联网。
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <Button type="primary" size="large" onClick={save} style={{ paddingInline: 32 }}>保存设置</Button>
        </div>
      </div>
    </div>
  )
}
