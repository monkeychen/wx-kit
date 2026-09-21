// src/renderer/api.ts
import type { ArticleMeta, DownloadFormat, DownloadSummary, ProgressEvent } from '../core/types'
import type { AppSettings } from '../../electron/services/settings'
import type { ReadableKind } from '../core/read-article'
import type { MpAccount } from '../core/mp-types'
import type { HistoryEvent } from '../core/download-history'
import type { SubscribedAccount, CheckLogEntry } from '../core/subscriptions'
import type { SyncSummary } from '../core/site-sync'
import type { RunCheckResult } from '../../electron/services/subscription-check'
import type { UpdateInfo, UpdateAsset } from '../core/check-update'
import type { InstallChannel } from '../core/install-channel'
import type { MpProtectionStatus } from '../../electron/services/mp-request-gateway'
import type { TopicAiConfigStatus } from '../../electron/services/topic-ai-config'
import type { TopicAnalyzeResponse, TopicBriefResponse, TopicFeedbackResponse } from '../../electron/services/topics-service'
import type { TopicFeedbackDecision, TopicTraceEvent, TopicWindowInput } from '../core/topics/types'

export type { HistoryEvent } from '../core/download-history'
export type { SubscribedAccount, CheckLogEntry } from '../core/subscriptions'
export type { RunCheckResult, PerAccountResult } from '../../electron/services/subscription-check'
export type { MowenCheckResult } from '../../electron/services/mowen-subscription-check'
import type { MowenCheckResult } from '../../electron/services/mowen-subscription-check'
import type { MowenSubscribedAuthor, MowenNoteRef } from '../core/mowen/subscription'
import type { MowenUser } from '../core/mowen/types'
export type { MowenSubscribedAuthor, MowenNoteRef, MowenUser }
export type { UpdateInfo, UpdateAsset } from '../core/check-update'
export type { InstallChannel } from '../core/install-channel'
export type { MpProtectionStatus } from '../../electron/services/mp-request-gateway'
export type { TopicAiConfigStatus } from '../../electron/services/topic-ai-config'
export type { TopicAnalyzeResponse, TopicBriefResponse, TopicFeedbackResponse } from '../../electron/services/topics-service'
export type { TopicDecisionCard, TopicFeedbackDecision, TopicRunResult, TopicTraceEvent, TopicWindowInput } from '../core/topics/types'

export interface UpdateChannelInfo { channel: InstallChannel; command: string | null; platform: string; arch: string }
export interface UpdateProgress { name: string; done: number; total: number }
export interface MpSessionInfo { loggedIn: boolean; loginAt: number | null }
export interface MpAuthActionResult { ok: boolean; error?: string; code?: string; failedSteps?: string[] }

export interface SubscriptionsState { accounts: SubscribedAccount[]; authExpired: boolean; lastRunAt: number | null; checkLog: CheckLogEntry[]; nextCheckAt: number | null }
export interface SubscriptionDownloadProgress {
  fakeid: string; total: number; done: number; phase: string
  allTotal?: number; allDone?: number; nickname?: string
}


export type CliLinkStatus = 'linked' | 'unlinked' | 'conflict'
export interface CliLinkInfo { supported: boolean; status: CliLinkStatus; inPath: boolean; dir: string; transient?: boolean }

export interface WxApi {
  download(urls: string[], formats: DownloadFormat[], opts?: { expandRefs?: boolean }): Promise<DownloadSummary>
  onDownloadProgress(cb: (e: ProgressEvent) => void): () => void
  libraryList(): Promise<ArticleMeta[]>
  librarySearch(keyword: string): Promise<ArticleMeta[]>
  libraryRemove(id: string): Promise<void>
  libraryRemoveMany(ids: string[]): Promise<void>
  libraryRebuild(): Promise<{ scanned: number; rebuilt: number; skipped: number }>
  libraryExportMaterial(ids: string[]): Promise<{ path: string; count: number; prompt: string }>
  librarySyncToSite(items: { id: string; slug: string }[], postsDir?: string): Promise<SyncSummary>
  /** 返回文章目录内封面文件名（cover.<ext>），无则 null。用于书架缩略图。 */
  coverName(dir: string): Promise<string | null>
  readContent(dir: string, kind: ReadableKind): Promise<string>
  getSettings(): Promise<AppSettings>
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  chooseDir(): Promise<string | null>
  reveal(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  appVersion(): Promise<string>
  /** M60 R3:立即检测一次 mocli 并刷新 settings 缓存。 */
  mowenDetect(): Promise<{ installed: boolean; path: string | null; version: string | null }>
  /** M61:墨问发现链路（GUI tab）。未装 mocli → ok:false + error.code=MOCLI_NOT_FOUND。 */
  mowenSearchUsers(keyword: string): Promise<{ ok: boolean; users?: { uid: string; name: string; intro: string; homeUrl: string }[]; error?: { code: string; message: string } }>
  mowenListUserNotes(uid: string, opts?: { filter?: string; recent?: string; count?: number }): Promise<{ ok: boolean; notes?: { noteId: string; uid: string; title: string; brief: string; url: string; publicAt: number | null; withFee: boolean; withImage: boolean; withText: boolean; wordCount: number | null; viewCount: number | null; favorCount: number | null }[]; error?: { code: string; message: string } }>
  /** M65:全站按关键词搜笔记。notes 条目带 authorName（跨作者场景的第一判断信号），
   *  authors 为完整作者映射——点作者名联动展开该作者清单要用。 */
  mowenSearchNotes(keyword: string, count?: number): Promise<{ ok: boolean; notes?: { noteId: string; uid: string; title: string; brief: string; url: string; publicAt: number | null; withFee: boolean; withImage: boolean; withText: boolean; wordCount: number | null; viewCount: number | null; favorCount: number | null; authorName?: string }[]; authors?: { uid: string; name: string; intro: string; homeUrl: string }[]; error?: { code: string; message: string } }>
  copyText(text: string): Promise<void>
  topicsGetConfig(): Promise<TopicAiConfigStatus>
  topicsSaveConfig(input: { baseUrl: string; model: string; apiKey?: string }): Promise<TopicAiConfigStatus>
  topicsClearKey(): Promise<TopicAiConfigStatus>
  topicsAnalyze(input: { window: TopicWindowInput }): Promise<TopicAnalyzeResponse>
  topicsCancel(): Promise<{ ok: boolean; error?: { code: string; message: string } }>
  topicsBrief(runId: string, topicId: string): Promise<TopicBriefResponse>
  topicsFeedback(runId: string, topicId: string, decision: TopicFeedbackDecision): Promise<TopicFeedbackResponse>
  onTopicsProgress(cb: (stage: TopicTraceEvent['stage']) => void): () => void
  // —— M3.5 批量爬取 ——
  mpAuthStatus(): Promise<{ status: 'missing' | 'present'; valid: false | null; checkedAt?: number }>
  mpLogin(): Promise<MpAuthActionResult>
  mpRelogin(): Promise<MpAuthActionResult>
  /** 只读本地会话文件，不发登录探测。 */
  mpSessionInfo(): Promise<MpSessionInfo>
  /** 纯本地彻底退出，不受请求频控状态影响。 */
  mpLogout(): Promise<MpAuthActionResult>
  /** v0.10.0 微信读书扫码：二维码 confirmUrl（渲染层自行画码）与轮询状态推送 */
  onWereadLoginQr(cb: (e: { confirmUrl: string }) => void): () => void
  onWereadLoginState(cb: (e: { state: string }) => void): () => void
  cancelWereadLogin(): void
  mpProtectionStatus(): Promise<MpProtectionStatus>
  mpProtectionPause(): Promise<MpProtectionStatus>
  mpProtectionResume(): Promise<MpProtectionStatus>
  mpSearch(name: string): Promise<{ ok: boolean; list?: MpAccount[]; error?: { code: string; message: string } }>
  // —— M6 下载历史 ——
  historyList(offset: number, limit: number): Promise<{ events: HistoryEvent[]; total: number }>
  historyRemove(id: string): Promise<void>
  historyClear(): Promise<void>
  // —— M11 公众号订阅 ——
  subscriptionsList(): Promise<SubscriptionsState>
  subscriptionsAddAccount(fakeid: string, nickname: string): Promise<void>
  subscriptionsSetSubscribed(fakeid: string, nickname: string, subscribed: boolean): Promise<void>
  subscriptionsRemove(fakeid: string): Promise<void>
  /** M34:返回逐号明细(此前 IPC 把返回值丢了,渲染层想提示也无从提示) */
  subscriptionsCheckNow(fakeids?: string[]): Promise<RunCheckResult>
  /**
   * M40:ids 省略 = 全部待处理;给了就只下这几篇,其余仍留在待处理里。
   * 返回值里的 `kept` 是**没下成、仍留在待处理里等重试**的篇数——失败不该静默消失。
   */
  subscriptionsDownloadNew(fakeid: string, ids?: string[]): Promise<{ downloaded: number; skipped: number; failed: number; kept: number } | undefined>
  subscriptionsDownloadAllNew(): Promise<{ accounts: number; total: number; downloaded: number; skipped: number; failed: number; kept: number }>
  subscriptionsDismissNew(fakeid: string, ids?: string[]): Promise<void>
  subscriptionsOpenLog(): Promise<void>
  onSubscriptionsUpdated(cb: () => void): () => void
  // —— M63 墨问作者订阅 ——
  mowenSubsList(): Promise<{ authors: MowenSubscribedAuthor[]; lastRunAt: number | null; checkLog?: CheckLogEntry[] }>
  mowenSubsAdd(keyword: string, uid?: string): Promise<{ ok: boolean; authors?: MowenUser[]; subscribed?: { uid: string; name: string; intro: string }; error?: { code: string; message: string } }>
  mowenSubsRemove(uid: string): Promise<void>
  mowenSubsSetSubscribed(uid: string, subscribed: boolean): Promise<void>
  mowenSubsCheckNow(uids?: string[]): Promise<MowenCheckResult>
  mowenSubsDownloadNotes(uid: string, noteIds: string[]): Promise<{ downloaded: number; existed: number; failed: number }>
  mowenSubsDismissNotes(uid: string, noteIds: string[]): Promise<void>
  onMowenSubsUpdated(cb: () => void): () => void
  /** 卡片行动弹窗：按需拉取引用子笔记的标题与库内状态（用户点开才发请求） */
  mowenRefNotes(sourceUrl: string): Promise<{ ok: boolean; notes?: { noteId: string; title: string; available: boolean; inLibrary: boolean }[]; error?: { code: string; message: string } }>
  onSubscriptionDownloadProgress(cb: (e: SubscriptionDownloadProgress) => void): () => void
  // —— M18 命令行软链 ——
  /**
   * M37:查最新版。silent=true 时受设置开关与「每天一次」约束。
   * M39 起被限流拦下时**返回上次查到的结论**(而不是 null),否则「有新版」会被限流一起吞掉。
   */
  updateCheck(opts?: { silent?: boolean }): Promise<UpdateInfo | null>
  /** M39:主进程低频 tick 查到新版时推送——关窗驻留时渲染层的 effect 早停了,只能靠主进程 */
  onUpdateAvailable(cb: (info: UpdateInfo) => void): () => void
  updateChannel(): Promise<UpdateChannelInfo>
  updateDownload(assets: UpdateAsset[]): Promise<{ ok: boolean; path?: string; error?: string }>
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void

  cliLinkStatus(): Promise<CliLinkInfo>
  cliLinkCreate(force: boolean): Promise<{ status: CliLinkStatus; transient?: boolean }>
  cliLinkAddToPath(): Promise<{ profilePath: string; result: 'added' | 'present' }>

  /** M66 诊断:打开日志文件夹(Finder 选中 main.log);返回日志路径用于展示 */
  diagOpenLogsFolder(): Promise<{ ok: boolean; path?: string; error?: string }>
  diagLogPath(): Promise<{ path: string | null }>
}

declare global {
  interface Window { api: WxApi }
}

export const api: WxApi = window.api
