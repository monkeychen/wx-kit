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

export type { HistoryEvent } from '../core/download-history'
export type { SubscribedAccount, CheckLogEntry } from '../core/subscriptions'
export type { RunCheckResult, PerAccountResult } from '../../electron/services/subscription-check'
export type { UpdateInfo, UpdateAsset } from '../core/check-update'
export type { InstallChannel } from '../core/install-channel'
export type { MpProtectionStatus } from '../../electron/services/mp-request-gateway'

export interface UpdateChannelInfo { channel: InstallChannel; command: string | null; platform: string; arch: string }
export interface UpdateProgress { name: string; done: number; total: number }
export interface MpSessionInfo { loggedIn: boolean; loginAt: number | null }
export interface MpAuthActionResult { ok: boolean; error?: string; code?: string; failedSteps?: string[] }

export interface SubscriptionsState { accounts: SubscribedAccount[]; authExpired: boolean; lastRunAt: number | null; checkLog: CheckLogEntry[]; nextCheckAt: number | null }
export interface SubscriptionDownloadProgress { fakeid: string; total: number; done: number; phase: string }


export type CliLinkStatus = 'linked' | 'unlinked' | 'conflict'
export interface CliLinkInfo { supported: boolean; status: CliLinkStatus; inPath: boolean; dir: string }

export interface WxApi {
  download(urls: string[], formats: DownloadFormat[]): Promise<DownloadSummary>
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
  copyText(text: string): Promise<void>
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
  subscriptionsDismissNew(fakeid: string, ids?: string[]): Promise<void>
  subscriptionsOpenLog(): Promise<void>
  onSubscriptionsUpdated(cb: () => void): () => void
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
  cliLinkCreate(force: boolean): Promise<{ status: CliLinkStatus }>
  cliLinkAddToPath(): Promise<{ profilePath: string; result: 'added' | 'present' }>
}

declare global {
  interface Window { api: WxApi }
}

export const api: WxApi = window.api
