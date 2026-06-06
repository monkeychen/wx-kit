// tests/core/library.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../../src/core/library'
import type { ArticleMeta } from '../../src/core/types'

function meta(id: string, title: string, account = '号A'): ArticleMeta {
  return {
    id, title, author: account, account, publishTime: '2026-02-25',
    sourceUrl: `https://x/${id}`, digest: '', coverUrl: '',
    downloadTime: '2026-06-06T00:00:00.000Z', formats: ['md'], dir: '',
  }
}

describe('Library', () => {
  let root: string
  let lib: Library
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wxk-'))
    lib = new Library(root)
  })

  it('add then list returns the entry', async () => {
    await lib.add(meta('1', '第一篇'))
    expect((await lib.list()).map(e => e.id)).toEqual(['1'])
  })

  it('has() detects existing id for dedup', async () => {
    await lib.add(meta('1', '第一篇'))
    expect(await lib.has('1')).toBe(true)
    expect(await lib.has('2')).toBe(false)
  })

  it('search matches title case-insensitively', async () => {
    await lib.add(meta('1', '深度长文'))
    await lib.add(meta('2', '短讯'))
    expect((await lib.search('深度')).map(e => e.id)).toEqual(['1'])
  })

  it('remove deletes index entry and on-disk folder', async () => {
    const m = meta('1', '第一篇')
    const dir = join(root, 'art1')
    mkdirSync(dir); writeFileSync(join(dir, 'content.md'), 'x')
    m.dir = dir
    await lib.add(m)
    await lib.remove('1')
    expect(await lib.has('1')).toBe(false)
    expect(existsSync(dir)).toBe(false)
  })
})
