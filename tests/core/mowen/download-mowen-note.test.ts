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
  contentHtml: '<p>正文</p>', publicAt: 1789088785, hasVideo: false,
  authorUid: 'u1', authorName: '池建强',
  images: new Map(), audios: [], refNoteIds: [], warnings: [],
  ...over,
})

// 截获 exportArticle 产出的 ParsedArticle 形态：通过导出的 md 检查
const makeDeps = (libraryRoot: string, notes: Map<string, NoteShowResult>, opts?: { expandRefs?: boolean; minIntervalMs?: number }) => ({
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
  minIntervalMs: opts?.minIntervalMs ?? 0,   // 测试默认不限速（限速有专门用例真实等待）
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

  it('父笔记已在库 + expandRefs：本体判重跳过，子笔记仍要补下（卡片「补下引用」场景，v0.11.0）', async () => {
    const notes = new Map<string, NoteShowResult>([
      ['parentNoteUuid1234567890', noteShowOf({ uuid: 'parentNoteUuid1234567890', title: '父', refNoteIds: ['childNoteUuid123456789012'] })],
      ['childNoteUuid123456789012', noteShowOf({ uuid: 'childNoteUuid123456789012', title: '子' })],
    ])
    const deps = makeDeps(root, notes, { expandRefs: true })
    // 先不带 expandRefs 下载父（模拟「之前只下了本体」）
    await downloadMowenNote('parentNoteUuid1234567890', ['meta'], { ...deps, expandRefs: false })
    expect(await deps.library.has('mowen_parentNoteUuid1234567890')).toBe(true)
    expect(await deps.library.has('mowen_childNoteUuid123456789012')).toBe(false)
    // 带 expandRefs 重下：父判重 skip，但引用展开必须照走——
    // 此前提前 return 让展开永远不生效（卡片「下载未入库的引用笔记」点了没反应的根因）
    const r = await downloadMowenNote('parentNoteUuid1234567890', ['meta'], deps)
    expect(r.skipped).toBe(true)
    expect(await deps.library.has('mowen_childNoteUuid123456789012')).toBe(true)
    expect(r.refResults?.total).toBe(1)
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

describe('downloadMowenNote · 引用元信息与请求缓存（v0.11.2 R1）', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'wxk-mowen-refs-')) })

  const PARENT = 'parentNoteUuid1234567890'
  const CHILD = 'childNoteUuid123456789012'
  const parentNote = () => noteShowOf({
    uuid: PARENT, title: '父',
    contentHtml: '<p>关联阅读：</p><note uuid="childNoteUuid123456789012"></note><p>完</p>',
    refNoteIds: [CHILD],
  })

  /** spy 版 deps：记录每次真实 fetchNoteShow 调用（uuid + 时刻） */
  const spyDeps = (notes: Map<string, NoteShowResult>, opts?: { expandRefs?: boolean }) => {
    const calls: string[] = []
    const at: number[] = []
    const inner = makeDeps(root, notes, opts)
    return {
      deps: {
        ...inner,
        fetchNoteShow: async (uuid: string) => {
          calls.push(uuid); at.push(Date.now())
          return inner.fetchNoteShow(uuid)
        },
      } as typeof inner,
      calls, at,
    }
  }

  it('含引用笔记：元信息成功 → 卡片进 md（blockquote + 标题），父仅 2 次请求（父 + 子元信息）', async () => {
    const { deps, calls } = spyDeps(new Map([
      [PARENT, parentNote()],
      [CHILD, noteShowOf({ uuid: CHILD, title: '子标题甲', digest: '子摘要', authorName: '子作者' })],
    ]))
    const r = await downloadMowenNote(PARENT, ['md'], deps)
    expect(r.ok).toBe(true)
    const md = readFileSync(join(r.dir!, 'content.md'), 'utf-8')
    expect(md).toContain('子标题甲')          // 标题进 md（turndown blockquote 不丢）
    expect(md).toContain('子作者')
    expect(md).toContain('> ')                 // blockquote → 引用块
    expect(calls).toEqual([PARENT, CHILD])     // 父 1 + 元信息 1，无第三次
  })

  it('expandRefs 复用：元信息与子下载共享缓存，同一 uuid 只请求一次', async () => {
    const { deps, calls } = spyDeps(new Map([
      [PARENT, parentNote()],
      [CHILD, noteShowOf({ uuid: CHILD, title: '子' })],
    ]), { expandRefs: true })
    const r = await downloadMowenNote(PARENT, ['md'], deps)
    expect(r.ok).toBe(true)
    expect(await deps.library.has('mowen_' + CHILD)).toBe(true)
    expect(calls).toEqual([PARENT, CHILD])     // 子下载命中缓存，不再请求
  })

  it('付费子笔记：元信息归类 paid 卡如实标注（md 含「付费」），父笔记 ok 落库', async () => {
    const notes = new Map([[PARENT, parentNote()]])
    const { deps } = spyDeps(notes)
    const inner = deps.fetchNoteShow
    deps.fetchNoteShow = async (uuid: string) => {
      if (uuid === CHILD) throw new MowenNoteUnavailable()
      return inner(uuid)
    }
    const r = await downloadMowenNote(PARENT, ['md'], deps)
    expect(r.ok).toBe(true)
    const md = readFileSync(join(r.dir!, 'content.md'), 'utf-8')
    expect(md).toContain('付费')
    expect(md).toContain('https://note.mowen.cn/detail/' + CHILD)
  })

  it('元信息获取失败（非付费异常）：父笔记仍 ok 落库，failed 卡 + warning，不伪装', async () => {
    const notes = new Map([[PARENT, parentNote()]])
    const { deps } = spyDeps(notes)
    const inner = deps.fetchNoteShow
    const warns: string[] = []
    deps.fetchNoteShow = async (uuid: string) => {
      if (uuid === CHILD) throw new Error('network boom')
      return inner(uuid)
    }
    deps.onWarning = (w?: string) => { if (w) warns.push(w) }
    const r = await downloadMowenNote(PARENT, ['md'], deps)
    expect(r.ok).toBe(true)
    const md = readFileSync(join(r.dir!, 'content.md'), 'utf-8')
    expect(md).toContain('标题获取失败')
    expect(warns.some((w) => w.includes('元信息获取失败'))).toBe(true)
  })

  it('限速（默认 500ms）：两次真实请求间隔不小于 500ms（PRD-v0.11.0 契约补课）', async () => {
    const { deps, at } = spyDeps(new Map([
      [PARENT, parentNote()],
      [CHILD, noteShowOf({ uuid: CHILD, title: '子' })],
    ]))
    delete (deps as { minIntervalMs?: number }).minIntervalMs   // 走默认 500ms 闸
    await downloadMowenNote(PARENT, ['md'], deps)
    expect(at.length).toBe(2)
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(480)   // 计时器容差
  })

  it('限速跨调用生效：批量下载逐篇新建 deps 时，篇与篇之间仍隔 500ms（模块级共享闸）', async () => {
    // 复现调用方真实形态：DownloadQueue 的 mapper 每篇 URL 都新建 deps 字面量
    // （GUI `ipc.ts` 写 `{...deps, onVideoProgress}`、CLI `mowen import` 写内联字面量），
    // 所以 per-deps 闸会在每篇开头重置——本用例钉死「上提为模块级」后的跨篇行为。
    const noteA = 'Ni2ZIpWVBtm1qu8sAmihb'
    const noteB = 'AbCdEfGhIjKlMnOpQrStu'
    const first = spyDeps(new Map([[noteA, noteShowOf({ uuid: noteA, title: '甲' })]]))
    const second = spyDeps(new Map([[noteB, noteShowOf({ uuid: noteB, title: '乙' })]]))
    delete (first.deps as { minIntervalMs?: number }).minIntervalMs
    delete (second.deps as { minIntervalMs?: number }).minIntervalMs

    await downloadMowenNote(noteA, ['meta'], first.deps)
    await downloadMowenNote(noteB, ['meta'], second.deps)

    expect(first.at.length).toBe(1)
    expect(second.at.length).toBe(1)
    // 不同 deps 实例之间也要满足间隔——这正是 per-deps 闸漏掉的那半
    expect(second.at[0]! - first.at[0]!).toBeGreaterThanOrEqual(480)
  })
})
