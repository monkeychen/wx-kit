// tests/core/mowen/mowen-to-article.test.ts
import { describe, it, expect } from 'vitest'
import { noteShowToParsedArticle } from '../../../src/core/mowen/mowen-to-article'
import type { NoteShowResult } from '../../../src/core/mowen/note-show'

const base = (over: Partial<NoteShowResult>): NoteShowResult => ({
  uuid: 'n1', title: '标题', digest: '摘要', contentHtml: '<p>正文</p>',
  publicAt: 1789088785, authorUid: 'u1', authorName: '池建强',
  images: new Map(), audios: [], refNoteIds: [], warnings: [],
  ...over,
})

describe('noteShowToParsedArticle', () => {
  it('基础映射：作者名兼任 account（目录名），publicAt 转北京时间', () => {
    const p = noteShowToParsedArticle(base({}))
    expect(p.title).toBe('标题')
    expect(p.account).toBe('池建强')
    expect(p.author).toBe('池建强')
    expect(p.publishTime).toBe('2026-09-11 09:06')   // 1789088785 北京时间
    expect(p.digest).toBe('摘要')
    expect(p.coverUrl).toBe('')
    expect(p.videos).toEqual([])
  })

  it('图片：<img uuid> 重写为 <img src=w_1200>，imageUrls 按出现顺序', () => {
    const p = noteShowToParsedArticle(base({
      contentHtml: '<p>a</p><img uuid="i2"><p>b</p><img uuid="i1"><img uuid="gone-uuid-1234567">',
      images: new Map([['i1', 'https://x/1.png'], ['i2', 'https://x/2.png']]),
      // 缺映射的 warning 由 fetchNoteShow 产生（见 note-show.test），适配器只透传
      warnings: ['图片映射缺失（uuid=gone-uuid-1234567），该图未下载'],
    }))
    expect(p.imageUrls).toEqual(['https://x/2.png', 'https://x/1.png'])
    expect(p.contentHtml).toContain('<img src="https://x/2.png"')
    expect(p.contentHtml).toContain('<img src="https://x/1.png"')
    // 缺映射的 uuid 保留原标签（fetchNoteShow 已给 warning），不做静默删除
    expect(p.warnings.some((w) => w.includes('图片映射缺失'))).toBe(true)
  })

  it('音频：注入 <audio controls> 到正文尾部', () => {
    const p = noteShowToParsedArticle(base({ audios: ['https://a/a.m4a'] }))
    expect(p.contentHtml).toContain('<audio controls src="https://a/a.m4a"')
  })

  it('合集引用：refNoteIds 非空 → 尾部渲染引用块（uuid 前 8 位占位链接）', () => {
    const p = noteShowToParsedArticle(base({ refNoteIds: ['6ipCTiFtt0yQRXNeSDA1w', 'uhMLoeBwwxLEglwJ6-DV7'] }))
    expect(p.contentHtml).toContain('mowen-refs')
    expect(p.contentHtml).toContain('https://note.mowen.cn/detail/6ipCTiFtt0yQRXNeSDA1w')
    expect(p.contentHtml).toContain('6ipCTiFt')   // uuid 前 8 位占位
    expect(p.warnings.some((w) => w.includes('引用') && w.includes('2'))).toBe(true)
  })

  it('无引用不追加引用块', () => {
    const p = noteShowToParsedArticle(base({}))
    expect(p.contentHtml).not.toContain('mowen-refs')
  })

  it('代码块 HTML 原样保留', () => {
    const html = '<pre class="shiki"><code>const a = 1</code></pre>'
    const p = noteShowToParsedArticle(base({ contentHtml: html }))
    expect(p.contentHtml).toContain('<pre class="shiki">')
  })
})
