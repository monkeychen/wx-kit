import { useEffect, useState } from 'react'
import { Input, Button, Space, message } from 'antd'
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
            <div className="setting-hint">下载的文章与图片都保存在这里。修改后旧文章不会自动迁移。</div>
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
        </div>

        <div style={{ marginTop: 24 }}>
          <Button type="primary" size="large" onClick={save} style={{ paddingInline: 32 }}>保存设置</Button>
        </div>
      </div>
    </div>
  )
}
