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

  it('throws a clear error on corrupt index', async () => {
    writeFileSync(join(root, 'library.json'), '{ not json')
    await expect(lib.list()).rejects.toThrow(/corrupt/)
  })

  it('remove with empty dir does not throw and clears entry', async () => {
    await lib.add(meta('2', '无目录')) // dir: ''
    await lib.remove('2')
    expect(await lib.has('2')).toBe(false)
  })

  it('remove refuses to delete a dir outside the library root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'wxk-outside-'))
    writeFileSync(join(outside, 'keep.txt'), 'x')
    const m = meta('3', '越界'); m.dir = outside
    await lib.add(m)
    await lib.remove('3')
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true) // NOT deleted
    expect(await lib.has('3')).toBe(false)                    // index entry still removed
  })
})

// —— M13: 并发写不丢更新 ——
const concMeta = (id: string, root: string): ArticleMeta => ({
  id, title: 'T' + id, author: '', account: 'acc', publishTime: '', sourceUrl: '',
  digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(root, 'acc', id),
})

describe('Library concurrent writes (M13)', () => {
  it('serializes concurrent add across instances — no lost update', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-lib-conc-'))
    const a = new Library(root); const b = new Library(root)
    await Promise.all([a.add(concMeta('1', root)), b.add(concMeta('2', root))])
    const ids = (await new Library(root).list()).map((x) => x.id).sort()
    expect(ids).toEqual(['1', '2'])
  })
})

describe('跨 URL 形态的去重查找(M36)', () => {
  // 同一篇文章:后台列表给短链、分享链接给长链,算出的 id 形态不同。
  // get/has 必须按 canonical 比,否则老库里的文章会被重下一遍(v0.8.2 真实故障)。
  const mk = (id: string, title = 't'): ArticleMeta => ({
    id, title, author: 'a', account: 'acc', publishTime: '2026-07-01 10:00',
    sourceUrl: 'https://x', digest: '', coverUrl: '', downloadTime: '2026-07-01T00:00:00Z',
    formats: ['md'], dir: '/tmp/none',
  })

  it('老库的 mid_idx_sn 记录,用新的 mid_idx 能查到', async () => {
    const lib = new Library(mkdtempSync(join(tmpdir(), 'wxk-canon-')))
    await lib.add(mk('2247494971_1_6ce948b6802fa74b8e4fd21386e8e487'))
    expect(await lib.has('2247494971_1')).toBe(true)
    expect((await lib.get('2247494971_1'))?.id).toBe('2247494971_1_6ce948b6802fa74b8e4fd21386e8e487')
  })

  it('反向也成立:新格式入库,老格式(带 sn)能查到', async () => {
    const lib = new Library(mkdtempSync(join(tmpdir(), 'wxk-canon2-')))
    await lib.add(mk('2247494971_1'))
    expect(await lib.has('2247494971_1_anysnvalue')).toBe(true)
  })

  it('idx 不同不得互相命中(同一次群发的头条与次条是两篇)', async () => {
    const lib = new Library(mkdtempSync(join(tmpdir(), 'wxk-canon3-')))
    await lib.add(mk('2247494971_1_aaa'))
    expect(await lib.has('2247494971_2')).toBe(false)
  })

  it('mid 不同不得互相命中(周更同名文章靠 mid 区分)', async () => {
    const lib = new Library(mkdtempSync(join(tmpdir(), 'wxk-canon4-')))
    await lib.add(mk('2247495909_1_x', '下周策略'))
    expect(await lib.has('2247495866_1')).toBe(false)
  })

  it('短链哈希形态不与 mid_idx 混淆', async () => {
    const lib = new Library(mkdtempSync(join(tmpdir(), 'wxk-canon5-')))
    await lib.add(mk('h_dc8cec68196f808b'))
    expect(await lib.has('2247494971_1')).toBe(false)
    expect(await lib.has('h_dc8cec68196f808b')).toBe(true)
  })

  it('remove 仍按字面 id —— 删除必须精确,不能 canonical 误删同篇的另一条记录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-canon6-'))
    const lib = new Library(root)
    await lib.add(mk('2247494971_1_oldsn'))
    await lib.add(mk('h_newcopy'))
    await lib.remove('h_newcopy')
    const left = (await lib.list()).map((a) => a.id)
    expect(left).toEqual(['2247494971_1_oldsn'])
  })
})
