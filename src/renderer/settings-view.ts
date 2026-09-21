import type { AppSettings } from '../../electron/services/settings'
import type { TopicAiConfigStatus } from '../../electron/services/topic-ai-config'

export type SettingsCategory = 'content' | 'accounts' | 'automation' | 'ai' | 'system'

export interface SettingsCategoryDefinition {
  id: SettingsCategory
  label: string
  /** 左导航副标题（短） */
  description: string
  /** 面板头描述（对齐原型的一整句话） */
  panelDescription: string
  icon: string
}

/** AI 模型设置草稿（M73）：custom 厂商的 baseUrl 可编辑，其余厂商由目录派生。 */
export interface TopicAiDraft {
  providerId: string
  plan: 'payg' | 'plan'
  baseUrl: string
  model: string
  apiKey: string
  reasoning: boolean
  effort: 'high' | 'medium' | 'low'
}

export const SETTINGS_CATEGORIES: readonly SettingsCategoryDefinition[] = [
  { id: 'content', label: '文库与下载', description: '保存位置、格式、历史', panelDescription: '决定内容保存在哪里，以及默认下载什么。', icon: '▣' },
  { id: 'accounts', label: '账号与平台', description: '微信读书、墨问', panelDescription: '集中管理需要登录或安装外部工具的平台能力。', icon: '◎' },
  { id: 'automation', label: '自动化与发布', description: '订阅检查、站点同步', panelDescription: '控制应用打开期间的定时检查，以及可选的站点输出。', icon: '↻' },
  { id: 'ai', label: 'AI 与工具', description: '模型、命令行', panelDescription: '配置选题分析使用的模型，以及供 Agent 调用的命令行入口。', icon: '✦' },
  { id: 'system', label: '系统与支持', description: '保护、诊断、更新', panelDescription: '运行保护、故障诊断和版本更新集中在这里。', icon: '⚙' },
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
  if (!savedTopic) return topicDraft.apiKey.trim().length > 0
  const topicDirty = topicDraft.providerId !== savedTopic.providerId
    || topicDraft.plan !== savedTopic.plan
    || topicDraft.model.trim() !== savedTopic.model.trim()
    || topicDraft.reasoning !== savedTopic.reasoning
    || topicDraft.effort !== savedTopic.effort
    || (savedTopic.providerId === 'custom' && topicDraft.baseUrl.trim() !== savedTopic.baseUrl.trim())
    || topicDraft.apiKey.trim().length > 0
  return topicDirty
}
