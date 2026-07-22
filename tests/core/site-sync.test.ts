// tests/core/site-sync.test.ts
import { describe, it, expect } from 'vitest'
import { validateSlug, buildSitePost, syncToSite } from '../../src/core/site-sync'
import type { ArticleMeta } from '../../src/core/types'

const meta = (over: Partial<ArticleMeta> = {}): ArticleMeta => ({
  id: 'h_1', title: '南芯科技，跌近年内低点...', author: 'a', account: '聊哉梦呓',
  publishTime: '2026-07-18 09:30', sourceUrl: 'https://mp.weixin.qq.com/s/X', digest: '',
  coverUrl: '', downloadTime: '2026-07-20T01:00:00.000Z', formats: ['md'], dir: '/lib/acc/post',
  ...over,
})

// 真实 wx-kit content.md 形态:frontmatter + 与 title 同文的 H1 + 正文(图片引用 images/)
const CONTENT_MD = `---
title: "南芯科技，跌近年内低点..."
account: "聊哉梦呓"
author: "a"
publishTime: "2026-07-18 09:30"
source: "https://mp.weixin.qq.com/s/X"
downloadTime: "2026-07-20T01:00:00.000Z"
---
# 南芯科技，跌近年内低点...

正文第一段。

![](images/img-1.png)

| 列A | 列B |
| --- | --- |
| 甲 | 1 |

![](images/img-2.jpg)
`

describe('validateSlug', () => {
  const empty = new Set<string>()

  it('接受合法 slug(小写字母/数字/连字符)', () => {
    for (const s of ['nanxin-tech-analysis', 'post2026', 'a', 'a-b-c-1']) {
      expect(validateSlug(s, empty)).toEqual({ ok: true })
    }
  })

  it('拒绝大写/下划线/空格/中文/空串', () => {
    for (const s of ['Nanxin', 'a_b', 'a b', '南芯', '']) {
      const r = validateSlug(s, empty)
      expect(r.ok).toBe(false)
    }
  })

  it('拒绝以连字符开头或结尾', () => {
    expect(validateSlug('-abc', empty).ok).toBe(false)
    expect(validateSlug('abc-', empty).ok).toBe(false)
  })

  it('拒绝与已占用 slug 冲突(批量内重复或站点已存在)', () => {
    const r = validateSlug('taken-slug', new Set(['taken-slug']))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('已存在')
  })
})

describe('buildSitePost', () => {
  it('目录名 = 发布日期-slug(日期取 publishTime 前 10 位)', () => {
    const r = buildSitePost(meta(), CONTENT_MD, 'nanxin-tech-analysis')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.dirName).toBe('2026-07-18-nanxin-tech-analysis')
  })

  it('frontmatter 只含 title/date/source(site schema 是 strict)', () => {
    const r = buildSitePost(meta(), CONTENT_MD, 'x-post')
    if (!r.ok) throw new Error(r.error)
    const fm = r.indexMd.slice(0, r.indexMd.indexOf('\n---\n', 4) + 5)
    expect(fm).toContain('title: "南芯科技，跌近年内低点..."')
    expect(fm).toContain('date: 2026-07-18')
    expect(fm).toContain('source: wechat')
    // 不得混入 wx-kit 自己的字段,否则 site 构建失败
    for (const k of ['account:', 'author:', 'publishTime:', 'downloadTime:']) expect(fm).not.toContain(k)
  })

  it('正文去掉 frontmatter 与重复的首个 H1', () => {
    const r = buildSitePost(meta(), CONTENT_MD, 'x-post')
    if (!r.ok) throw new Error(r.error)
    const body = r.indexMd.split('\n---\n')[1]
    expect(body).not.toContain('# 南芯科技')
    expect(body.trimStart().startsWith('正文第一段')).toBe(true)
  })

  it('图片引用从 images/ 改写为同目录 ./', () => {
    const r = buildSitePost(meta(), CONTENT_MD, 'x-post')
    if (!r.ok) throw new Error(r.error)
    expect(r.indexMd).toContain('![](./img-1.png)')
    expect(r.indexMd).toContain('![](./img-2.jpg)')
    expect(r.indexMd).not.toContain('](images/')
  })

  it('保留正文表格等 markdown 结构', () => {
    const r = buildSitePost(meta(), CONTENT_MD, 'x-post')
    if (!r.ok) throw new Error(r.error)
    expect(r.indexMd).toContain('| 列A | 列B |')
    expect(r.indexMd).toContain('| --- | --- |')
  })

  it('缺 publishTime 时报错(目录日期必须等于发布日期,不能静默用今天)', () => {
    const r = buildSitePost(meta({ publishTime: '' }), CONTENT_MD, 'x-post')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('发布时间')
  })

  it('title 含引号/反斜杠时正确转义', () => {
    const r = buildSitePost(meta({ title: '他说"你好"\\结束' }), CONTENT_MD, 'x-post')
    if (!r.ok) throw new Error(r.error)
    expect(r.indexMd).toContain('title: "他说\\"你好\\"\\\\结束"')
  })
})

describe('commitSitePost + syncToSite(落盘)', () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')

  /** 造一篇 wx-kit 产物目录:content.md + images/ */
  const makeArticle = (root: string, name = 'post') => {
    const dir = join(root, name)
    mkdirSync(join(dir, 'images'), { recursive: true })
    writeFileSync(join(dir, 'content.md'), CONTENT_MD)
    writeFileSync(join(dir, 'images', 'img-1.png'), 'PNG1')
    writeFileSync(join(dir, 'images', 'img-2.jpg'), 'JPG2')
    return dir
  }

  it('写入站点目录:index.md + 图片同目录(不带 images 子目录)', async () => {
    const src = mkdtempSync(join(tmpdir(), 'wxk-src-'))
    const posts = mkdtempSync(join(tmpdir(), 'wxk-posts-'))
    const dir = makeArticle(src)
    const r = await syncToSite([{ meta: meta({ dir }), slug: 'my-post' }], posts)
    expect(r.succeeded).toBe(1)
    expect(r.failed).toBe(0)
    const target = join(posts, '2026-07-18-my-post')
    expect(existsSync(join(target, 'index.md'))).toBe(true)
    expect(readFileSync(join(target, 'img-1.png'), 'utf8')).toBe('PNG1')
    expect(readFileSync(join(target, 'img-2.jpg'), 'utf8')).toBe('JPG2')
    expect(existsSync(join(target, 'images'))).toBe(false)
    expect(readFileSync(join(target, 'index.md'), 'utf8')).toContain('![](./img-1.png)')
  })

  it('slug 与站点已有目录冲突 → 该篇失败且不覆盖已有内容', async () => {
    const src = mkdtempSync(join(tmpdir(), 'wxk-src-'))
    const posts = mkdtempSync(join(tmpdir(), 'wxk-posts-'))
    mkdirSync(join(posts, '2026-01-01-taken'), { recursive: true })
    writeFileSync(join(posts, '2026-01-01-taken', 'index.md'), 'ORIGINAL')
    const dir = makeArticle(src)
    const r = await syncToSite([{ meta: meta({ dir }), slug: 'taken' }], posts)
    expect(r.succeeded).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.results[0].error).toContain('已存在')
    expect(readFileSync(join(posts, '2026-01-01-taken', 'index.md'), 'utf8')).toBe('ORIGINAL')
  })

  it('批量:单篇失败不阻断其他篇,且失败不留残留目录', async () => {
    const src = mkdtempSync(join(tmpdir(), 'wxk-src-'))
    const posts = mkdtempSync(join(tmpdir(), 'wxk-posts-'))
    const okDir = makeArticle(src, 'ok')
    const badDir = join(src, 'missing')      // 没有 content.md → 读取失败
    const r = await syncToSite([
      { meta: meta({ dir: badDir, id: 'bad' }), slug: 'bad-post' },
      { meta: meta({ dir: okDir, id: 'ok' }), slug: 'good-post' },
    ], posts)
    expect(r.succeeded).toBe(1)
    expect(r.failed).toBe(1)
    expect(existsSync(join(posts, '2026-07-18-good-post', 'index.md'))).toBe(true)
    // 失败篇不留目录,也不留暂存
    expect(existsSync(join(posts, '2026-07-18-bad-post'))).toBe(false)
    expect(readdirSync(posts).some((d: string) => d.startsWith('.staging-'))).toBe(false)
  })

  it('批量内 slug 重复 → 后一篇失败(预检),先一篇正常', async () => {
    const src = mkdtempSync(join(tmpdir(), 'wxk-src-'))
    const posts = mkdtempSync(join(tmpdir(), 'wxk-posts-'))
    const d1 = makeArticle(src, 'a'), d2 = makeArticle(src, 'b')
    const r = await syncToSite([
      { meta: meta({ dir: d1, id: '1' }), slug: 'dup' },
      { meta: meta({ dir: d2, id: '2' }), slug: 'dup' },
    ], posts)
    expect(r.succeeded).toBe(1)
    expect(r.failed).toBe(1)
    expect(r.results.find((x) => !x.ok)?.error).toContain('已存在')
  })

  it('非法 slug → 该篇失败,不写盘', async () => {
    const src = mkdtempSync(join(tmpdir(), 'wxk-src-'))
    const posts = mkdtempSync(join(tmpdir(), 'wxk-posts-'))
    const dir = makeArticle(src)
    const r = await syncToSite([{ meta: meta({ dir }), slug: 'Bad_Slug' }], posts)
    expect(r.failed).toBe(1)
    expect(readdirSync(posts).length).toBe(0)
  })
})
