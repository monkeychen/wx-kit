import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../../electron/services/settings'
import type { TopicAiConfigStatus } from '../../electron/services/topic-ai-config'
import { SETTINGS_CATEGORIES, isSettingsDirty } from '../../src/renderer/settings-view'

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
}

const topic: TopicAiConfigStatus = {
  baseUrl: 'https://api.example/v1', model: 'model-a', keyConfigured: true, keyPersistent: true,
}

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
      topicDraft: { baseUrl: topic.baseUrl, model: topic.model, apiKey: '   ' },
    })).toBe(false)
  })

  it('普通设置的嵌套值改变也能识别 dirty', () => {
    const draft = structuredClone(settings)
    draft.listColumnWidths.account = 200
    expect(isSettingsDirty({
      savedSettings: settings, draftSettings: draft, savedTopic: topic,
      topicDraft: { baseUrl: topic.baseUrl, model: topic.model, apiKey: '' },
    })).toBe(true)
  })

  it.each([
    { baseUrl: 'https://other.example/v1', model: topic.model, apiKey: '' },
    { baseUrl: topic.baseUrl, model: 'model-b', apiKey: '' },
    { baseUrl: topic.baseUrl, model: topic.model, apiKey: 'new-key' },
  ])('AI base/model 或新 Key 改变时识别 dirty：%#', topicDraft => {
    expect(isSettingsDirty({ savedSettings: settings, draftSettings: settings, savedTopic: topic, topicDraft })).toBe(true)
  })

  it('设置尚未加载时不误报 dirty', () => {
    expect(isSettingsDirty({
      savedSettings: null, draftSettings: null, savedTopic: null,
      topicDraft: { baseUrl: '', model: '', apiKey: '' },
    })).toBe(false)
  })
})
