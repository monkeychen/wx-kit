import { useEffect, useState } from 'react'
import { Input, Button, Checkbox, Space, message } from 'antd'
import { api } from '../api'
import type { AppSettings } from '../../../electron/services/settings'
import type { DownloadFormat } from '../../core/types'

const FORMATS: DownloadFormat[] = ['cover', 'md', 'html', 'pdf', 'meta']

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null)

  useEffect(() => { api.getSettings().then(setS) }, [])

  const choose = async () => {
    const dir = await api.chooseDir()
    if (dir && s) setS({ ...s, libraryRoot: dir })
  }
  const save = async () => {
    if (!s) return
    try {
      await api.saveSettings(s)
      message.success('已保存')
    } catch (e) {
      message.error('保存失败：' + (e as Error).message)
    }
  }

  if (!s) return <div className="p-6">加载中…</div>
  return (
    <div className="p-6" style={{ maxWidth: 640 }}>
      <h2>设置</h2>
      <div className="mb-2">文章库根目录</div>
      <Space.Compact style={{ width: '100%' }}>
        <Input value={s.libraryRoot} readOnly />
        <Button onClick={choose}>选择目录</Button>
      </Space.Compact>
      <div className="mt-4 mb-2">默认下载格式</div>
      <Checkbox.Group options={FORMATS.map(f => ({ label: f, value: f }))}
        value={s.defaultFormats} onChange={(v) => setS({ ...s, defaultFormats: v as DownloadFormat[] })} />
      <div className="mt-6"><Button type="primary" onClick={save}>保存</Button></div>
    </div>
  )
}
