// src/core/library.ts
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ArticleMeta } from './types'

interface LibraryFile { version: number; articles: ArticleMeta[] }

export class Library {
  private indexPath: string
  constructor(private root: string) {
    this.indexPath = join(root, 'library.json')
  }

  private async read(): Promise<LibraryFile> {
    if (!existsSync(this.indexPath)) return { version: 1, articles: [] }
    return JSON.parse(await readFile(this.indexPath, 'utf-8')) as LibraryFile
  }

  private async write(data: LibraryFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(this.indexPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  async list(): Promise<ArticleMeta[]> {
    return (await this.read()).articles
  }

  async has(id: string): Promise<boolean> {
    return (await this.read()).articles.some(a => a.id === id)
  }

  async add(meta: ArticleMeta): Promise<void> {
    const data = await this.read()
    const i = data.articles.findIndex(a => a.id === meta.id)
    if (i >= 0) data.articles[i] = meta
    else data.articles.push(meta)
    await this.write(data)
  }

  /** 按标题（文件名）大小写不敏感匹配 */
  async search(keyword: string): Promise<ArticleMeta[]> {
    const k = keyword.trim().toLowerCase()
    if (!k) return this.list()
    return (await this.read()).articles.filter(a => a.title.toLowerCase().includes(k))
  }

  /** 删除索引项并清理磁盘文件夹 */
  async remove(id: string): Promise<void> {
    const data = await this.read()
    const entry = data.articles.find(a => a.id === id)
    if (entry?.dir && existsSync(entry.dir)) await rm(entry.dir, { recursive: true, force: true })
    data.articles = data.articles.filter(a => a.id !== id)
    await this.write(data)
  }
}
