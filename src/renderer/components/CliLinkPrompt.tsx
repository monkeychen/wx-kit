// src/renderer/components/CliLinkPrompt.tsx
import { useEffect, useState } from 'react'
import { Modal, message } from 'antd'
import { api } from '../api'
import type { CliLinkInfo } from '../api'

// 首启一次性引导:平台支持 + 未问过 + 未建链 → 弹窗。无论接受/忽略都记 cliLinkPrompted。
export default function CliLinkPrompt() {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<CliLinkInfo | null>(null)

  useEffect(() => {
    (async () => {
      const i = await api.cliLinkStatus()
      if (!i.supported || i.status === 'linked') return
      if ((await api.getSettings()).cliLinkPrompted) return
      setInfo(i); setOpen(true)
    })().catch(() => { /* 引导失败不阻塞应用 */ })
  }, [])

  const dismiss = async () => { await api.saveSettings({ cliLinkPrompted: true }); setOpen(false) }

  const create = async () => {
    try {
      await api.cliLinkCreate(info?.status === 'conflict')
      if (info && !info.inPath) {
        const r = await api.cliLinkAddToPath()
        message.success(`已创建快捷方式，并将 ~/bin 写入 ${r.profilePath}，重开终端后生效`)
      } else {
        message.success('已创建命令行快捷方式，可在终端运行 wx-kit')
      }
    } catch (e) {
      message.error('创建失败：' + (e as Error).message)
    } finally {
      await dismiss()
    }
  }

  if (!info) return null
  return (
    <Modal open={open} title="为 wx-kit 创建命令行快捷方式？"
      okText="创建" cancelText="暂不" onOk={create} onCancel={dismiss}
      data-testid="cli-link-modal">
      <p>创建后可在终端直接运行 <code>wx-kit …</code>，供 AI agent 调用。</p>
      <p className="faint">
        将在 <code>{info.dir}</code> 下创建指向应用的软链
        {info.status === 'conflict' && '（该位置已有同名文件，将被覆盖）'}
        {!info.inPath && '；并把 ~/bin 加入 PATH（写入 shell 配置）'}。
      </p>
    </Modal>
  )
}
