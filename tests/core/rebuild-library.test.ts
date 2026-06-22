import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rebuildLibrary } from '../../src/core/rebuild-library'
import type { ArticleMeta } from '../../src/core/types'

const meta = (id: string, dir: string): ArticleMeta => ({
  id, title: 'T' + id, author: '', account: 'acc', publishTime: '', sourceUrl: '',
  digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir,
})

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'wxk-rebuild-'))
  const a1 = join(root, 'acc1', 'art1'); mkdirSync(a1, { recursive: true })
  writeFileSync(join(a1, 'meta.json'), JSON.stringify(meta('1', a1)))
  const a2 = join(root, 'acc1', 'art2'); mkdirSync(a2, { recursive: true })
  writeFileSync(join(a2, 'meta.json'), JSON.stringify(meta('2', a2)))
  const a3 = join(root, 'acc2', 'art3'); mkdirSync(a3, { recursive: true })
  writeFileSync(join(a3, 'meta.json'), JSON.stringify(meta('3', a3)))
  mkdirSync(join(root, 'acc1', 'art-nometa'), { recursive: true })           // 无 meta → 不计
  mkdirSync(join(root, 'exports'), { recursive: true })                       // 应忽略
  writeFileSync(join(root, 'exports', 'x.json'), '{"any":"thing"}')
  return root
}

describe('rebuildLibrary', () => {
  it('rebuilds library.json from all article meta.json, ignoring exports/', async () => {
    const root = tree()
    const res = await rebuildLibrary(root)
    expect(res).toEqual({ scanned: 3, rebuilt: 3, skipped: 0 })
    const idx = JSON.parse(readFileSync(join(root, 'library.json'), 'utf-8'))
    expect(idx.version).toBe(1)
    expect(idx.articles.map((a: ArticleMeta) => a.id).sort()).toEqual(['1', '2', '3'])
  })

  it('counts a corrupt meta.json as skipped, keeps the rest', async () => {
    const root = tree()
    const bad = join(root, 'acc2', 'art-bad'); mkdirSync(bad, { recursive: true })
    writeFileSync(join(bad, 'meta.json'), '{ not json')
    const res = await rebuildLibrary(root)
    expect(res).toEqual({ scanned: 4, rebuilt: 3, skipped: 1 })
  })
})
