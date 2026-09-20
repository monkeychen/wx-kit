import { app, ipcMain, safeStorage } from 'electron'
import { SettingsService } from './settings'
import { TopicAiConfigService } from './topic-ai-config'
import { TopicService } from './topics-service'

export function registerTopicIpc(settings: SettingsService): void {
  const config = new TopicAiConfigService(settings, app.getPath('userData'), safeStorage)
  const topics = new TopicService({ settings, config })

  ipcMain.handle('topics:getConfig', () => topics.getConfig())
  ipcMain.handle('topics:saveConfig', (_event, input) => topics.saveConfig(input))
  ipcMain.handle('topics:clearKey', () => topics.clearKey())
  ipcMain.handle('topics:analyze', (event, input) => topics.analyze(input, stage => {
    if (!event.sender.isDestroyed()) event.sender.send('topics:progress', { stage })
  }))
  ipcMain.handle('topics:cancel', () => topics.cancel())
  ipcMain.handle('topics:brief', (_event, input) => topics.brief(input))
  ipcMain.handle('topics:feedback', (_event, input) => topics.feedback(input))
}
