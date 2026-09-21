import type { AppSettings } from '../../electron/services/settings'
import type { TopicAiConfigStatus } from '../../electron/services/topic-ai-config'

export type SettingsCategory = 'content' | 'accounts' | 'automation' | 'ai' | 'system'

export interface SettingsCategoryDefinition {
  id: SettingsCategory
  label: string
  description: string
  icon: string
}

export interface TopicAiDraft {
  baseUrl: string
  model: string
  apiKey: string
}

export const SETTINGS_CATEGORIES: readonly SettingsCategoryDefinition[] = [
  { id: 'content', label: '文库与下载', description: '保存位置、格式、历史', icon: '▣' },
  { id: 'accounts', label: '账号与平台', description: '微信读书、墨问', icon: '◎' },
  { id: 'automation', label: '自动化与发布', description: '订阅检查、站点同步', icon: '↻' },
  { id: 'ai', label: 'AI 与工具', description: '选题模型、命令行', icon: '✦' },
  { id: 'system', label: '系统与支持', description: '保护、诊断、更新', icon: '⚙' },
] as const

export function isSettingsDirty(input: {
  savedSettings: AppSettings | null
  draftSettings: AppSettings | null
  savedTopic: TopicAiConfigStatus | null
  topicDraft: TopicAiDraft
}): boolean {
  const { savedSettings, draftSettings, savedTopic, topicDraft } = input
  if (!savedSettings || !draftSettings) return false
  if (JSON.stringify(savedSettings) !== JSON.stringify(draftSettings)) return true
  const savedBaseUrl = savedTopic?.baseUrl.trim() ?? ''
  const savedModel = savedTopic?.model.trim() ?? ''
  return topicDraft.baseUrl.trim() !== savedBaseUrl
    || topicDraft.model.trim() !== savedModel
    || topicDraft.apiKey.trim().length > 0
}
