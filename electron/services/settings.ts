// electron/services/settings.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DownloadFormat } from '../../src/core/types'
import type { CachedRelease } from '../../src/core/update-gate'

export interface ListColumnWidths { account: number; publish: number; download: number }
export type NewArticleAction = 'notify' | 'download'

export interface AppSettings {
  libraryRoot: string
  defaultFormats: DownloadFormat[]
  /** 下载文中内嵌视频(M35):默认开。视频是内容不是格式,故不进 defaultFormats;
   *  留开关让 URL 下载时可以控制上百 MB 的单个视频。 */
  downloadVideos: boolean
  /** 启动时静默检查新版本(M37):默认开。只请求 GitHub 的 releases/latest,不上传任何数据 */
  updateCheckEnabled: boolean
  /** 上次检查更新的时刻,用于「每天最多自动查一次」 */
  lastUpdateCheckAt: number | null
  /**
   * 上次查到的 release(M39)。**存的是「查到了什么」,不是「要不要提示」**——
   * `hasUpdate` 按当前版本实时算,所以升级后提示自动消失,不需要清理逻辑。
   * 有了它,静默检查被每日限流拦下时才能给出上次的结论,而不是把结论一起吞掉。
   */
  lastKnownRelease: CachedRelease | null
  historyRetentionDays: number
  listColumnWidths: ListColumnWidths
  subscriptionAutoCheck: boolean
  subscriptionCheckTime: string          // "HH:MM"
  subscriptionNewArticleAction: NewArticleAction
  subscriptionScheduleMode: 'daily' | 'interval'
  subscriptionIntervalHours: number
  cliLinkPrompted: boolean
  libraryExpandedGroups: string[]        // 文库分组视图的展开集(M23;默认空=全部收起)
  librarySort: LibrarySort               // 文库排序选择(M25;跨会话记忆,默认发布时间降序)
  siteSyncEnabled: boolean               // 站点同步(M32):默认关,开启后文库批量栏才出现「同步到站点」
  siteSyncPostsDir: string               // 站点 content/posts 目录(同步产物的落点)
}

// 与 renderer 的 library-view 排序键/方向一致;定义在此避免主进程 import renderer
export interface LibrarySort { key: 'download' | 'publish' | 'title'; dir: 'asc' | 'desc' }

export class SettingsService {
  private path: string
  constructor(private storeDir: string, private defaultLibraryRoot: string) {
    this.path = join(storeDir, 'settings.json')
  }

  private defaults(): AppSettings {
    return {
      libraryRoot: this.defaultLibraryRoot,
      defaultFormats: ['md', 'html', 'meta'],
      downloadVideos: true,
      updateCheckEnabled: true,
      lastUpdateCheckAt: null,
      lastKnownRelease: null,
      historyRetentionDays: 365,
      listColumnWidths: { account: 132, publish: 150, download: 110 },
      subscriptionAutoCheck: false,
      subscriptionCheckTime: '09:00',
      subscriptionNewArticleAction: 'notify',
      subscriptionScheduleMode: 'daily',
      subscriptionIntervalHours: 6,
      cliLinkPrompted: false,
      libraryExpandedGroups: [],
      librarySort: { key: 'publish', dir: 'desc' },
      siteSyncEnabled: false,
      siteSyncPostsDir: '/Users/chenzhian/workspace/ai/dreamble/site/content/posts',
    }
  }

  async get(): Promise<AppSettings> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf-8'))
      return { ...this.defaults(), ...raw }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return this.defaults()
      throw new Error(`settings file is corrupt at ${this.path} — delete it to reset`)
    }
  }

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...(await this.get()), ...patch }
    await mkdir(this.storeDir, { recursive: true })
    await writeFile(this.path, JSON.stringify(next, null, 2), 'utf-8')
    return next
  }
}
