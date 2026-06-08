// electron/services/settings.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DownloadFormat } from '../../src/core/types'

export interface AppSettings {
  libraryRoot: string
  defaultFormats: DownloadFormat[]
  historyRetentionDays: number
}

export class SettingsService {
  private path: string
  constructor(private storeDir: string, private defaultLibraryRoot: string) {
    this.path = join(storeDir, 'settings.json')
  }

  private defaults(): AppSettings {
    return { libraryRoot: this.defaultLibraryRoot, defaultFormats: ['md', 'html', 'meta'], historyRetentionDays: 365 }
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
