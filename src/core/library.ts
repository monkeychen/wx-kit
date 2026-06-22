// src/core/library.ts
import { readFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { ArticleMeta } from './types'
import { atomicWriteFile } from './atomic-write'
import { withPathLock } from './path-lock'

interface LibraryFile { version: number; articles: ArticleMeta[] }

export class Library {
  private indexPath: string
  constructor(private root: string) {
    this.indexPath = join(root, 'library.json')
  }

  private async read(): Promise<LibraryFile> {
    try {
      return JSON.parse(await readFile(this.indexPath, 'utf-8')) as LibraryFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, articles: [] }
      throw new Error(`library index is corrupt at ${this.indexPath} — run "library rebuild" to rebuild it from article folders`)
    }
  }

  private async write(data: LibraryFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await atomicWriteFile(this.indexPath, JSON.stringify(data, null, 2))
  }

  async list(): Promise<ArticleMeta[]> {
    return (await this.read()).articles
  }

  async has(id: string): Promise<boolean> {
    return (await this.read()).articles.some(a => a.id === id)
  }

  async get(id: string): Promise<ArticleMeta | undefined> {
    return (await this.read()).articles.find(a => a.id === id)
  }

  async add(meta: ArticleMeta): Promise<void> {
    await withPathLock(this.indexPath, async () => {
      const data = await this.read()
      const i = data.articles.findIndex(a => a.id === meta.id)
      if (i >= 0) data.articles[i] = meta
      else data.articles.push(meta)
      await this.write(data)
    })
  }

  /** 按标题（文件名）大小写不敏感匹配 */
  async search(keyword: string): Promise<ArticleMeta[]> {
    const k = keyword.trim().toLowerCase()
    if (!k) return this.list()
    return (await this.read()).articles.filter(a => a.title.toLowerCase().includes(k))
  }

  /** 删除索引项并清理磁盘文件夹 */
  async remove(id: string): Promise<void> {
    await withPathLock(this.indexPath, async () => {
      const data = await this.read()
      const entry = data.articles.find(a => a.id === id)
      if (entry?.dir) {
        const resolvedDir = resolve(entry.dir)
        const resolvedRoot = resolve(this.root)
        if (resolvedDir !== resolvedRoot && resolvedDir.startsWith(resolvedRoot + sep)) {
          await rm(resolvedDir, { recursive: true, force: true })
        }
      }
      data.articles = data.articles.filter(a => a.id !== id)
      await this.write(data)
    })
  }
}
