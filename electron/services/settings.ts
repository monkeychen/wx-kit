// electron/services/settings.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DownloadFormat } from '../../src/core/types'

export interface ListColumnWidths { account: number; publish: number; download: number }
export type NewArticleAction = 'notify' | 'download'

export interface AppSettings {
  libraryRoot: string
  defaultFormats: DownloadFormat[]
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
