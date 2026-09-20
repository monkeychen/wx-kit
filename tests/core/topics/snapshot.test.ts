import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArticleMeta } from '../../../src/core/types'
import { resolveTopicWindow } from '../../../src/core/topics/time-window'
import {
  MAX_TOPIC_ARTICLES,
  MAX_TOPIC_MODEL_CHARS,
  TopicInputLimitError,
  buildTopicSnapshot,
} from '../../../src/core/topics/snapshot'

const AS_OF = Date.parse('2026-09-20T04:00:00Z')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempRoot(prefix = 'wxk-topic-snapshot-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function article(root: string, id: string, opts: Partial<ArticleMeta> = {}): ArticleMeta {
  return {
    id, title: '同名文章', author: '合成作者', account: '合成账号', accountId: 'synthetic-account',
    publishTime: '2026-09-20 09:00', sourceUrl: `https://example.invalid/articles/${id}`,
    digest: '', coverUrl: '', downloadTime: '2026-09-20T03:30:00Z', formats: ['md'],
    dir: join(root, id), ...opts,
  }
}

async function put(meta: ArticleMeta, markdown: string): Promise<void> {
  await mkdir(meta.dir, { recursive: true })
  await writeFile(join(meta.dir, 'content.md'), markdown, 'utf8')
}

describe('本地选题素材快照', () => {
  it('保留文章身份，按规范正文合并完全重复内容，并生成稳定段落', async () => {
    const root = await tempRoot()
    const first = article(root, 'first', { warnings: ['合成告警'] })
    const duplicate = article(root, 'duplicate', { account: '另一个合成账号', accountId: 'synthetic-other' })
    const sameTitle = article(root, 'same-title')
    const warned = article(root, 'warned')
    const imagesOnly = article(root, 'images-only', { itemShowType: 8 })
    const missing = article(root, 'missing')
    const outsideRoot = await tempRoot('wxk-topic-outside-')
    const outside = article(root, 'outside', { dir: join(outsideRoot, 'article') })

    await put(first, '---\ntitle: "T"\n---\n# 标题\n\n第一段有足够的合成文字。\n\n第二段继续说明。\n')
    await put(duplicate, '---\r\ntitle: "T"\r\n---\r\n# 标题  \r\n\r\n第一段有足够的合成文字。  \r\n\r\n第二段继续说明。\r\n')
    await put(sameTitle, '# 标题\n\n这是另一篇内容，不应因为标题相同而合并。')
    await put(warned, '# 有正文\n\n即使存在普通下载告警，正文仍可分析。')
    await put(imagesOnly, '![合成图片](images/sample.png)')
    await put(outside, '# 越界正文\n\n即使文件存在也不能读取。')

    const input = Object.freeze([first, duplicate, sameTitle, warned, imagesOnly, missing, outside])
    const before = JSON.stringify(input)
    const snapshot = await buildTopicSnapshot({ libraryRoot: root, now: () => new Date(AS_OF) }, {
      runId: 'run-snapshot-1', window: resolveTopicWindow(undefined, AS_OF), articles: input,
    })

    expect(snapshot.articles.map(item => item.id)).toEqual(['first', 'duplicate', 'same-title', 'warned'])
    expect(snapshot.groups).toHaveLength(3)
    expect(snapshot.groups[0]).toMatchObject({
      id: 'g001', representativeArticleId: 'first', memberArticleIds: ['first', 'duplicate'],
      paragraphIds: ['g001:p001', 'g001:p002', 'g001:p003'],
    })
    expect(snapshot.articles[0].warnings).toEqual(['合成告警'])
    expect(snapshot.articles[0].contentHash).toBe(snapshot.articles[1].contentHash)
    expect(snapshot.articles[0].groupId).toBe(snapshot.articles[1].groupId)
    expect(snapshot.articles[0].contentHash).not.toBe(snapshot.articles[2].contentHash)
    expect(snapshot.paragraphs.filter(p => p.groupId === 'g001').map(p => p.text)).toEqual([
      '# 标题', '第一段有足够的合成文字。', '第二段继续说明。',
    ])
    expect(snapshot.excluded).toEqual([
      { id: 'images-only', reason: 'insufficient-text' },
      { id: 'missing', reason: 'content-missing' },
      { id: 'outside', reason: 'path-outside-library' },
    ])
    expect(snapshot.totalModelChars).toBe(snapshot.groups.reduce((sum, group) =>
      sum + snapshot.paragraphs.filter(p => p.groupId === group.id).reduce((n, p) => n + p.text.length, 0), 0))
    expect(snapshot.createdAt).toBe('2026-09-20T04:00:00.000Z')
    expect(JSON.stringify(input)).toBe(before)
  })

  it('把超过 6000 字符的单段切块且不丢字', async () => {
    const root = await tempRoot()
    const meta = article(root, 'long')
    const text = '甲'.repeat(6001)
    await put(meta, text)
    const snapshot = await buildTopicSnapshot({ libraryRoot: root }, {
      runId: 'run-long', window: resolveTopicWindow(undefined, AS_OF), articles: [meta],
    })
    expect(snapshot.paragraphs.map(p => p.id)).toEqual(['g001:p001', 'g001:p001:c002'])
    expect(snapshot.paragraphs.map(p => p.text.length)).toEqual([6000, 1])
    expect(snapshot.paragraphs.map(p => p.text).join('')).toBe(text)
  })

  it('正文读取失败与不存在分别留痕，不把错误文章送给模型', async () => {
    const root = await tempRoot()
    const unreadable = article(root, 'unreadable')
    const missing = article(root, 'missing')
    const snapshot = await buildTopicSnapshot({
      libraryRoot: root,
      readContent: async dir => {
        if (dir === missing.dir) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
        throw new Error('permission denied')
      },
    }, { runId: 'run-read-errors', window: resolveTopicWindow(undefined, AS_OF), articles: [unreadable, missing] })
    expect(snapshot.excluded).toEqual([
      { id: 'unreadable', reason: 'content-unreadable', detail: 'permission denied' },
      { id: 'missing', reason: 'content-missing' },
    ])
  })
})

describe('素材成本护栏', () => {
  it('有效文章身份超过 30 篇时在模型调用前失败，即使正文完全重复', async () => {
    const root = await tempRoot()
    const articles = Array.from({ length: MAX_TOPIC_ARTICLES + 1 }, (_, i) => article(root, `a-${i}`))
    const run = buildTopicSnapshot({ libraryRoot: root, readContent: async () => '重复但有效的正文内容。' }, {
      runId: 'run-too-many', window: resolveTopicWindow(undefined, AS_OF), articles,
    })
    await expect(run).rejects.toMatchObject({ code: 'TOO_MANY_ARTICLES', actual: 31, limit: 30 })
  })

  it('唯一正文字符超过 120000 时失败且不截断', async () => {
    const root = await tempRoot()
    const meta = article(root, 'too-long')
    const run = buildTopicSnapshot({ libraryRoot: root, readContent: async () => '甲'.repeat(MAX_TOPIC_MODEL_CHARS + 1) }, {
      runId: 'run-too-long', window: resolveTopicWindow(undefined, AS_OF), articles: [meta],
    })
    await expect(run).rejects.toSatisfy(error => error instanceof TopicInputLimitError
      && error.code === 'TOO_MANY_CHARACTERS' && error.actual === 120001 && error.limit === 120000)
  })
})
