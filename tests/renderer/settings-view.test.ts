import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../../electron/services/settings'
import type { TopicAiConfigStatus } from '../../electron/services/topic-ai-config'
import { SETTINGS_CATEGORIES, isSettingsDirty, type TopicAiDraft } from '../../src/renderer/settings-view'

const settings: AppSettings = {
  libraryRoot: '/library', defaultFormats: ['md', 'meta'], downloadVideos: true,
  updateCheckEnabled: true, lastUpdateCheckAt: null, lastKnownRelease: null,
  historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 },
  subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify',
  subscriptionScheduleMode: 'daily', subscriptionIntervalHours: 6, cliLinkPrompted: true,
  libraryExpandedGroups: [], librarySort: { key: 'publish', dir: 'desc' },
  siteSyncEnabled: false, siteSyncPostsDir: '/site/posts', mowenMocliPath: null,
  mowenMocliVersion: null, mowenDetectedAt: null, topicAiBaseUrl: 'https://api.example/v1',
  topicAiModel: 'model-a', topicDefaultRange: '24h',
  topicAiProvider: 'custom', topicAiPlan: 'payg', topicAiReasoning: true, topicAiEffort: 'high',
}

const topic: TopicAiConfigStatus = {
  providerId: 'custom', plan: 'payg', baseUrl: 'https://api.example/v1', model: 'model-a',
  reasoning: true, effort: 'high', keyConfigured: true, keyPersistent: true,
}

const draftOf = (overrides: Partial<TopicAiDraft> = {}): TopicAiDraft => ({
  providerId: topic.providerId,
  plan: topic.plan,
  baseUrl: topic.baseUrl,
  model: topic.model,
  reasoning: topic.reasoning,
  effort: topic.effort,
  apiKey: '',
  ...overrides,
})

describe('设置页分类与草稿', () => {
  it('按用户目标提供五个固定分类', () => {
    expect(SETTINGS_CATEGORIES.map(item => [item.id, item.label])).toEqual([
      ['content', '文库与下载'],
      ['accounts', '账号与平台'],
      ['automation', '自动化与发布'],
      ['ai', 'AI 与工具'],
      ['system', '系统与支持'],
    ])
  })

  it('完全相同的普通设置和 AI 公开配置为 clean', () => {
    expect(isSettingsDirty({
      savedSettings: settings, draftSettings: structuredClone(settings), savedTopic: topic,
      topicDraft: draftOf({ apiKey: '   ' }),
    })).toBe(false)
  })

  it('普通设置的嵌套值改变也能识别 dirty', () => {
    const draft = structuredClone(settings)
    draft.listColumnWidths.account = 200
    expect(isSettingsDirty({
      savedSettings: settings, draftSettings: draft, savedTopic: topic,
      topicDraft: draftOf(),
    })).toBe(true)
  })

  it.each([
    { label: '厂商', overrides: { providerId: 'zhipu' } },
    { label: '计费模式', overrides: { plan: 'plan' as const } },
    { label: '模型', overrides: { model: 'model-b' } },
    { label: '推理开关', overrides: { reasoning: false } },
    { label: '推理等级', overrides: { effort: 'medium' as const } },
    { label: '自定义端点', overrides: { baseUrl: 'https://other.example/v1' } },
    { label: '新 Key', overrides: { apiKey: 'new-key' } },
  ])('AI 草稿改变时识别 dirty：$label', ({ overrides }) => {
    expect(isSettingsDirty({ savedSettings: settings, draftSettings: settings, savedTopic: topic, topicDraft: draftOf(overrides) })).toBe(true)
  })

  it('非 custom 厂商的 baseUrl 由目录派生，不参与 dirty 判断', () => {
    expect(isSettingsDirty({
      savedSettings: settings, draftSettings: settings,
      savedTopic: { ...topic, providerId: 'zhipu' },
      topicDraft: draftOf({ providerId: 'zhipu', baseUrl: 'https://totally.different/v9' }),
    })).toBe(false)
  })

  it('设置尚未加载时不误报 dirty', () => {
    expect(isSettingsDirty({
      savedSettings: null, draftSettings: null, savedTopic: null,
      topicDraft: draftOf(),
    })).toBe(false)
  })
})
