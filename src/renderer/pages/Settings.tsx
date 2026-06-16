import { useEffect, useState } from 'react'
import { Input, Button, Space, InputNumber, Popconfirm, Switch, Select, message } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { api } from '../api'
import FormatPicker from '../components/FormatPicker'
import type { AppSettings } from '../../../electron/services/settings'
import type { DownloadFormat } from '../../core/types'

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null)

  useEffect(() => { api.getSettings().then(setS) }, [])

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

  if (!s) return <div className="page"><div className="page-narrow faint">加载中…</div></div>

  return (
    <div className="page">
      <div className="page-narrow fade-in">
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
                <span style={{ minWidth: 96, display: 'inline-block' }}>每日检查时刻</span>
                <input type="time" value={s.subscriptionCheckTime} data-testid="set-subs-time"
                  onChange={(e) => setS({ ...s, subscriptionCheckTime: e.target.value })}
                  style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }} />
              </Space>
              <Space align="center">
                <span style={{ minWidth: 96, display: 'inline-block' }}>发现新文章时</span>
                <Select value={s.subscriptionNewArticleAction} style={{ width: 160 }} data-testid="set-subs-action"
                  onChange={(v) => setS({ ...s, subscriptionNewArticleAction: v })}
                  options={[{ value: 'notify', label: '仅提示' }, { value: 'download', label: '自动下载' }]} />
              </Space>
            </Space>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <Button type="primary" size="large" onClick={save} style={{ paddingInline: 32 }}>保存设置</Button>
        </div>
      </div>
    </div>
  )
}
