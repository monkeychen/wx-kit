import { app, ipcMain, safeStorage } from 'electron'
import type { WebContents } from 'electron'
import { SettingsService } from './settings'
import { TopicAiConfigService } from './topic-ai-config'
import { TopicService } from './topics-service'

/**
 * 流式增量节流器：token 级事件直发会淹死 IPC 通道，150ms 合并一段。
 * 阶段/类型切换时先把积压冲出再改段，保证 UI 分段不错序。
 */
function createStreamThrottle(send: (payload: { stage: string; kind: string; text: string }) => void) {
  let stage: string | null = null
  let kind: string | null = null
  let buffer = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (stage && buffer) send({ stage, kind: kind ?? 'content', text: buffer })
    buffer = ''
  }
  return {
    push(event: { stage: string; kind: string; text: string }) {
      if (stage !== event.stage || kind !== event.kind) flush()
      stage = event.stage; kind = event.kind
      buffer += event.text
      timer ??= setTimeout(() => { timer = null; flush() }, 150)
    },
    flush,
  }
}

export function registerTopicIpc(settings: SettingsService): void {
  const config = new TopicAiConfigService(settings, app.getPath('userData'), safeStorage)
  let throttle: ReturnType<typeof createStreamThrottle> | null = null
  const topics = new TopicService({
    settings,
    config,
    onStream: event => throttle?.push(event),
  })

  ipcMain.handle('topics:getConfig', () => topics.getConfig())
  ipcMain.handle('topics:providerCatalog', () => topics.getProviderCatalog())
  ipcMain.handle('topics:saveConfig', (_event, input) => topics.saveConfig(input))
  ipcMain.handle('topics:clearKey', () => topics.clearKey())
  ipcMain.handle('topics:testConnection', (_event, input) => topics.testConnection(input))
  ipcMain.handle('topics:analyze', (event, input) => {
    const sender: WebContents = event.sender
    throttle = createStreamThrottle(payload => {
      if (!sender.isDestroyed()) sender.send('topics:stream', payload)
    })
    return topics.analyze(input, stage => {
      if (!sender.isDestroyed()) sender.send('topics:progress', { stage })
    }).finally(() => {
      throttle?.flush()
      throttle = null
    })
  })
  ipcMain.handle('topics:runningStatus', () => topics.getRunningStatus())
  ipcMain.handle('topics:cancel', () => topics.cancel())
  ipcMain.handle('topics:brief', (_event, input) => topics.brief(input))
  ipcMain.handle('topics:feedback', (_event, input) => topics.feedback(input))
}
