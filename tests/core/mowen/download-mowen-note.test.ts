// tests/core/mowen/download-mowen-note.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadMowenNote } from '../../../src/core/mowen/download-mowen-note'
import { MowenNoteUnavailable } from '../../../src/core/mowen/errors'
import type { NoteShowResult } from '../../../src/core/mowen/note-show'
import { Library } from '../../../src/core/library'

// exportArticle 的最小 deps（图片/封面/PDF 不真正下载时 fetchBinary 不会被调）
const baseDeps = () => ({
  fetchBinary: async (_url: string) => ({ data: Buffer.from('img'), contentType: 'image/png' }),
  BrowserWindowCtor: class {} as never,
  now: () => '2026-09-12T00:00:00.000Z',
  onWarning: () => {},
})

const noteShowOf = (over: Partial<NoteShowResult>): NoteShowResult => ({
  uuid: 'Ni2ZIpWVBtm1qu8sAmihb', title: '测试笔记', digest: '摘要',
  contentHtml: '<p>正文</p>', publicAt: 1789088785,
  authorUid: 'u1', authorName: '池建强',
  images: new Map(), audios: [], refNoteIds: [], warnings: [],
  ...over,
})

// 截获 exportArticle 产出的 ParsedArticle 形态：通过导出的 md 检查
const makeDeps = (libraryRoot: string, notes: Map<string, NoteShowResult>, opts?: { expandRefs?: boolean }) => ({
  ...baseDeps(),
  fetchHtml: async () => '',   // mowen 分支不用；DownloadArticleDeps 必填（微信分支用）
  library: new Library(libraryRoot),
  libraryRoot,
  fetchNoteShow: async (uuid: string) => {
    const n = notes.get(uuid)
    if (!n) throw new Error('unexpected uuid ' + uuid)
    return n
  },
  expandRefs: opts?.expandRefs,
})

describe('downloadMowenNote', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'wxk-mowen-dl-')) })

  it('公开笔记：入库、目录按作者/日期建、md 含正文', async () => {
    const deps = makeDeps(root, new Map([['Ni2ZIpWVBtm1qu8sAmihb', noteShowOf({})]]))
    const r = await downloadMowenNote('https://note.mowen.cn/detail/Ni2ZIpWVBtm1qu8sAmihb', ['md', 'meta'], deps)
    expect(r.ok).toBe(true)
    expect(r.id).toBe('mowen_Ni2ZIpWVBtm1qu8sAmihb')
    expect(r.title).toBe('测试笔记')
    expect(r.dir).toBeTruthy()
    const mdPath = join(r.dir!, 'content.md')
    expect(existsSync(mdPath)).toBe(true)
    expect(readFileSync(mdPath, 'utf-8')).toContain('正文')
  })

  it('裸 noteId 归一：sourceUrl 是完整 detail URL', async () => {
    const deps = makeDeps(root, new Map([['Ni2ZIpWVBtm1qu8sAmihb', noteShowOf({})]]))
    const r = await downloadMowenNote('Ni2ZIpWVBtm1qu8sAmihb', ['meta'], deps)
    expect(r.ok).toBe(true)
    const meta = JSON.parse(readFileSync(join(r.dir!, 'meta.json'), 'utf-8'))
    expect(meta.sourceUrl).toBe('https://note.mowen.cn/detail/Ni2ZIpWVBtm1qu8sAmihb')
  })

  it('已在文库 → skipped:true 不重复下载', async () => {
    const deps = makeDeps(root, new Map([['Ni2ZIpWVBtm1qu8sAmihb', noteShowOf({})]]))
    await downloadMowenNote('Ni2ZIpWVBtm1qu8sAmihb', ['meta'], deps)
    const r2 = await downloadMowenNote('Ni2ZIpWVBtm1qu8sAmihb', ['meta'], deps)
    expect(r2.skipped).toBe(true)
    expect(r2.title).toBe('测试笔记')
  })

  it('付费笔记 → MowenNoteUnavailable 上抛（不产出空目录）', async () => {
    const deps = makeDeps(root, new Map())
    deps.fetchNoteShow = async () => { throw new MowenNoteUnavailable() }
    await expect(downloadMowenNote('Ni2ZIpWVBtm1qu8sAmihb', ['md'], deps)).rejects.toBeInstanceOf(MowenNoteUnavailable)
  })

  it('引用块：默认不递归，但正文含引用块与 warning', async () => {
    const deps = makeDeps(root, new Map([
      ['parentNoteUuid1234567890', noteShowOf({ uuid: 'parentNoteUuid1234567890', refNoteIds: ['childNoteUuid123456789012'] })],
    ]))
    const r = await downloadMowenNote('parentNoteUuid1234567890', ['md'], deps)
    const md = readFileSync(join(r.dir!, 'content.md'), 'utf-8')
    expect(md).toContain('引用笔记')
    expect(md).toContain('https://note.mowen.cn/detail/childNoteUuid123456789012')
    expect(r.warnings?.some((w) => w.includes('引用'))).toBe(true)
  })

  it('expandRefs：递归下子笔记，父子的下载都入库；重复引用只下一次', async () => {
    const shared = 'sharedNoteUuid12345678901'
    const notes = new Map<string, NoteShowResult>([
      ['parentNoteUuid1234567890', noteShowOf({
        uuid: 'parentNoteUuid1234567890', title: '父',
        refNoteIds: ['childNoteUuid123456789012', shared],
      })],
      ['childNoteUuid123456789012', noteShowOf({ uuid: 'childNoteUuid123456789012', title: '子', refNoteIds: [shared] })],
      [shared, noteShowOf({ uuid: shared, title: '共享叶子' })],
    ])
    const deps = makeDeps(root, notes, { expandRefs: true })
    const r = await downloadMowenNote('parentNoteUuid1234567890', ['meta'], deps)
    expect(r.ok).toBe(true)
    // 父 + 子 + 共享叶子 = 3 条入库；共享叶子被引用两次只下一次（第二次 skipped）
    expect(await deps.library.has('mowen_parentNoteUuid1234567890')).toBe(true)
    expect(await deps.library.has('mowen_childNoteUuid123456789012')).toBe(true)
    expect(await deps.library.has('mowen_' + shared)).toBe(true)
    expect(r.refResults).toBeTruthy()
    // total 语义 = 本级「新下载」的子笔记数。child 先下（递归把共享叶子顺带入库），
    // 轮到父级循环里的 shared 时它已在库 → skip 不计。去重语义正是这么工作的。
    expect(r.refResults!.total).toBe(1)
    // 全链入库数 = 父 + 子 + 共享叶子 = 3
    expect((await deps.library.list()).length).toBe(3)
  })

  it('expandRefs：付费子笔记 unavailable 不阻塞父级，如实进 refResults', async () => {
    const notes = new Map<string, NoteShowResult>([
      ['parentNoteUuid1234567890', noteShowOf({ uuid: 'parentNoteUuid1234567890', title: '父', refNoteIds: ['paidChildNoteUuid12345678'] })],
    ])
    const deps = makeDeps(root, notes, { expandRefs: true })
    const orig = deps.fetchNoteShow
    deps.fetchNoteShow = async (uuid) => {
      if (uuid === 'paidChildNoteUuid12345678') throw new MowenNoteUnavailable()
      return orig(uuid)
    }
    const r = await downloadMowenNote('parentNoteUuid1234567890', ['meta'], deps)
    expect(r.ok).toBe(true)
    expect(r.refResults?.unavailable).toContain('paidChildNoteUuid12345678')
  })

  it('深度上限 3：链式第 4 层不再展开，warning 提示', async () => {
    const notes = new Map<string, NoteShowResult>()
    const chain = ['l1aaaaaaaaaaaaaaaaaaaa', 'l2aaaaaaaaaaaaaaaaaaaa', 'l3aaaaaaaaaaaaaaaaaaaa', 'l4aaaaaaaaaaaaaaaaaaaa']
    chain.forEach((uuid, i) => notes.set(uuid, noteShowOf({
      uuid, title: '层' + (i + 1),
      refNoteIds: i < chain.length - 1 ? [chain[i + 1]] : [],
    })))
    const deps = makeDeps(root, notes, { expandRefs: true })
    const r = await downloadMowenNote(chain[0], ['meta'], deps)
    expect(r.ok).toBe(true)
    // 深度 3 上限：l1+l2+l3 入库，l4 不展开
    expect(await deps.library.has('mowen_l3aaaaaaaaaaaaaaaaaaaa')).toBe(true)
    expect(await deps.library.has('mowen_l4aaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })

  it('微信 URL 不受影响：downloadMowenNote 只处理墨问形态（路由在 download-article，这里守卫）', async () => {
    const deps = makeDeps(root, new Map())
    await expect(downloadMowenNote('https://mp.weixin.qq.com/s/ABC', ['md'], deps))
      .rejects.toThrow(/mowen/i)
  })
})
