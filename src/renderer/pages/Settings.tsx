import { useEffect, useState } from 'react'
import { Input, Button, Space, InputNumber, Popconfirm, Switch, Select, Segmented, message } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { api } from '../api'
import FormatPicker from '../components/FormatPicker'
import type { AppSettings } from '../../../electron/services/settings'
import type { DownloadFormat } from '../../core/types'

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [cliLink, setCliLink] = useState<Awaited<ReturnType<typeof api.cliLinkStatus>> | null>(null)

  useEffect(() => { api.getSettings().then(setS) }, [])
  useEffect(() => { api.cliLinkStatus().then(setCliLink) }, [])

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

  if (!s) return <div className="page"><div className="faint">加载中…</div></div>

  return (
    <div className="page">
      <div className="fade-in">
        <div className="page-head">
          <div className="eyebrow">Settings</div>
          <h1 className="page-title">设置</h1>
        </div>

        <div className="surface">
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
        </div>

        <div style={{ marginTop: 24 }}>
          <Button type="primary" size="large" onClick={save} style={{ paddingInline: 32 }}>保存设置</Button>
        </div>
      </div>
    </div>
  )
}
