// src/core/rebuild-library.ts
// 从库根各文章目录的 meta.json 重建 library.json。文库结构是 root/<公众号>/<文章>/meta.json（两层深），
// 故递归扫描；跳过 exports/（M14 的素材导出目录）与点目录。索引损坏时的恢复手段。
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import type { ArticleMeta } from './types'

export interface RebuildResult { scanned: number; rebuilt: number; skipped: number }

async function findMetaFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.') || e.name === 'exports') continue
    const sub = join(dir, e.name)
    const inner = await readdir(sub, { withFileTypes: true }).catch(() => [])
    if (inner.some((f) => f.isFile() && f.name === 'meta.json')) {
      out.push(join(sub, 'meta.json'))
    }
    // 继续向下递归（兼容更深层级），但不重复收集同目录
    for (const f of inner) {
      if (f.isDirectory() && !f.name.startsWith('.')) {
        out.push(...await findMetaFiles(sub))
        break
      }
    }
  }
  return [...new Set(out)]
}

export async function rebuildLibrary(root: string): Promise<RebuildResult> {
  const metaPaths = await findMetaFiles(root)
  const articles: ArticleMeta[] = []
  let skipped = 0
  for (const p of metaPaths) {
    try {
      articles.push(JSON.parse(await readFile(p, 'utf-8')) as ArticleMeta)
    } catch {
      skipped++
    }
  }
  await atomicWriteFile(join(root, 'library.json'), JSON.stringify({ version: 1, articles }, null, 2))
  return { scanned: metaPaths.length, rebuilt: articles.length, skipped }
}
