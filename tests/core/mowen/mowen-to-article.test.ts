// tests/core/mowen/mowen-to-article.test.ts
import { describe, it, expect } from 'vitest'
import { noteShowToParsedArticle, type RefNoteMeta } from '../../../src/core/mowen/mowen-to-article'
import type { NoteShowResult } from '../../../src/core/mowen/note-show'

const base = (over: Partial<NoteShowResult>): NoteShowResult => ({
  uuid: 'n1', title: '标题', digest: '摘要', contentHtml: '<p>正文</p>',
  publicAt: 1789088785, authorUid: 'u1', authorName: '池建强',
  images: new Map(), audios: [], refNoteIds: [], hasVideo: false, warnings: [],
  ...over,
})

const meta = (uuid: string, over: Partial<RefNoteMeta> = {}): RefNoteMeta => ({
  uuid, title: '发布第一款 Mac App：CatBar', digest: '极简 Mac 菜单栏图标管理工具',
  authorName: '池建强', publicAt: 1788506303, state: 'ok', ...over,
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
    // 封面取正文首图（exporter 的 cover 分支靠 coverUrl 触发，此前硬编码空串是死参数）
    expect(p.coverUrl).toBe('https://x/2.png')
    // 缺映射的 uuid 保留原标签（fetchNoteShow 已给 warning），不做静默删除
    expect(p.warnings.some((w) => w.includes('图片映射缺失'))).toBe(true)
  })

  it('无图笔记 coverUrl 保持空串（exporter 跳过 cover，不产出空文件）', () => {
    const p = noteShowToParsedArticle(base({}))
    expect(p.coverUrl).toBe('')
  })

  it('音频：注入 <audio controls> 到正文尾部', () => {
    const p = noteShowToParsedArticle(base({ audios: ['https://a/a.m4a'] }))
    expect(p.contentHtml).toContain('<audio controls src="https://a/a.m4a"')
  })

  describe('引用卡片（v0.11.2 R1：正文 <note uuid> 原地替换，尾部块退场）', () => {
    const REF_HTML = '<p>关联阅读：</p><note uuid="6ipCTiFtt0yQRXNeSDA1w"></note><p>2026年9月9日</p>'

    it('ok 卡：标签原地替换为 blockquote 卡片（标题链接 + 作者 + 摘要）', () => {
      const p = noteShowToParsedArticle(
        base({ contentHtml: REF_HTML, refNoteIds: ['6ipCTiFtt0yQRXNeSDA1w'] }),
        new Map([['6ipCTiFtt0yQRXNeSDA1w', meta('6ipCTiFtt0yQRXNeSDA1w')]]),
      )
      expect(p.contentHtml).toContain('<blockquote class="mowen-ref-card">')
      expect(p.contentHtml).toContain('《发布第一款 Mac App：CatBar》')
      expect(p.contentHtml).toContain('池建强')
      expect(p.contentHtml).toContain('极简 Mac 菜单栏图标管理工具')
      expect(p.contentHtml).toContain('https://note.mowen.cn/detail/6ipCTiFtt0yQRXNeSDA1w')
      // 原生占位标签不再出现（不留空白）
      expect(p.contentHtml).not.toContain('<note')
      expect(p.contentHtml).toContain('<p>关联阅读：</p>')
    })

    it('ok 卡 digest 为空：只渲染标题行', () => {
      const p = noteShowToParsedArticle(
        base({ contentHtml: REF_HTML, refNoteIds: ['6ipCTiFtt0yQRXNeSDA1w'] }),
        new Map([['6ipCTiFtt0yQRXNeSDA1w', meta('6ipCTiFtt0yQRXNeSDA1w', { digest: '' })]]),
      )
      const card = p.contentHtml.slice(p.contentHtml.indexOf('<blockquote'))
      expect(card.startsWith('<blockquote class="mowen-ref-card"><p><a')).toBe(true)
    })

    it('paid 卡：如实标注付费、不出现标题、链接保留', () => {
      const p = noteShowToParsedArticle(
        base({ contentHtml: REF_HTML, refNoteIds: ['6ipCTiFtt0yQRXNeSDA1w'] }),
        new Map([['6ipCTiFtt0yQRXNeSDA1w', meta('6ipCTiFtt0yQRXNeSDA1w', { state: 'paid', title: undefined, digest: undefined, authorName: undefined })]]),
      )
      expect(p.contentHtml).toContain('付费')
      expect(p.contentHtml).toContain('https://note.mowen.cn/detail/6ipCTiFtt0yQRXNeSDA1w')
      expect(p.contentHtml).not.toContain('《')
    })

    it('failed 卡：无法获取标题 + 链接', () => {
      const p = noteShowToParsedArticle(
        base({ contentHtml: REF_HTML, refNoteIds: ['6ipCTiFtt0yQRXNeSDA1w'] }),
        new Map([['6ipCTiFtt0yQRXNeSDA1w', meta('6ipCTiFtt0yQRXNeSDA1w', { state: 'failed', title: undefined, digest: undefined, authorName: undefined })]]),
      )
      expect(p.contentHtml).toContain('标题获取失败')
      expect(p.contentHtml).toContain('https://note.mowen.cn/detail/6ipCTiFtt0yQRXNeSDA1w')
    })

    it('无第二参（旧调用方兼容）：refNoteIds 非空时按 failed 卡渲染，不留裸标签', () => {
      const p = noteShowToParsedArticle(base({ contentHtml: REF_HTML, refNoteIds: ['6ipCTiFtt0yQRXNeSDA1w'] }))
      expect(p.contentHtml).not.toContain('<note')
      expect(p.contentHtml).toContain('https://note.mowen.cn/detail/6ipCTiFtt0yQRXNeSDA1w')
    })

    it('refNoteIds 有、正文无对应标签 → 文末追加卡片（信息不丢）', () => {
      const p = noteShowToParsedArticle(
        base({ contentHtml: '<p>正文</p>', refNoteIds: ['orphanRefUuid1234567890'] }),
        new Map([['orphanRefUuid1234567890', meta('orphanRefUuid1234567890')]]),
      )
      expect(p.contentHtml).toContain('<blockquote class="mowen-ref-card">')
      expect(p.contentHtml).toContain('《发布第一款 Mac App：CatBar》')
      expect(p.warnings.some((w) => w.includes('未在正文出现'))).toBe(true)
    })

    it('正文有标签、refNoteIds 无（防御）：failed 卡 + warning，不留裸标签', () => {
      const p = noteShowToParsedArticle(base({ contentHtml: REF_HTML, refNoteIds: [] }))
      expect(p.contentHtml).not.toContain('<note')
      expect(p.contentHtml).toContain('https://note.mowen.cn/detail/6ipCTiFtt0yQRXNeSDA1w')
      expect(p.warnings.some((w) => w.includes('不在引用清单'))).toBe(true)
    })

    it('尾部 mowen-refs 追加块不再出现；引用引导 warning 保留一条', () => {
      const p = noteShowToParsedArticle(
        base({ contentHtml: REF_HTML, refNoteIds: ['6ipCTiFtt0yQRXNeSDA1w'] }),
        new Map([['6ipCTiFtt0yQRXNeSDA1w', meta('6ipCTiFtt0yQRXNeSDA1w')]]),
      )
      expect(p.contentHtml).not.toContain('mowen-refs')
      expect(p.warnings.some((w) => w.includes('引用子笔记') && w.includes('展开'))).toBe(true)
    })

    it('卡片文本做 HTML 转义（标题/摘要/作者来自外部接口）', () => {
      const p = noteShowToParsedArticle(
        base({ contentHtml: REF_HTML, refNoteIds: ['6ipCTiFtt0yQRXNeSDA1w'] }),
        new Map([['6ipCTiFtt0yQRXNeSDA1w', meta('6ipCTiFtt0yQRXNeSDA1w', { title: '标题<script>', digest: '<b>摘要</b>', authorName: '作者&名' })]]),
      )
      expect(p.contentHtml).toContain('标题&lt;script&gt;')
      expect(p.contentHtml).not.toContain('<script>')
      expect(p.contentHtml).toContain('作者&amp;名')
    })

    it('无引用：不产生卡片', () => {
      const p = noteShowToParsedArticle(base({}))
      expect(p.contentHtml).not.toContain('mowen-ref-card')
    })
  })

  it('代码块 HTML 原样保留', () => {
    const html = '<pre class="shiki"><code>const a = 1</code></pre>'
    const p = noteShowToParsedArticle(base({ contentHtml: html }))
    expect(p.contentHtml).toContain('<pre class="shiki">')
  })

  describe('视频入口（v0.12.2 R1：<channel-video> 视频号嵌入，spike 2026-09-30）', () => {
    it('正文 channel-video 原地替换为视频号页跳转链接，videos 带 fallbackUrl', () => {
      const p = noteShowToParsedArticle(base({
        contentHtml: '<p>看视频</p><channel-video uuid="cv1" feed-id="export/abc"></channel-video>',
        hasVideo: true,
      }))
      expect(p.contentHtml).toContain('href="https://channels.weixin.qq.com/export/abc"')
      expect(p.contentHtml).not.toContain('<channel-video')   // 不留裸标签（阅读器会静默吞）
      expect(p.videos).toHaveLength(1)
      expect(p.videos[0]).toMatchObject({
        videoId: 'export/abc', formatId: 'channels-embed',
        fallbackUrl: 'https://channels.weixin.qq.com/export/abc',
      })
    })

    it('自闭合形态也认', () => {
      const p = noteShowToParsedArticle(base({ contentHtml: '<channel-video feed-id="export/x1"/>' }))
      expect(p.contentHtml).toContain('https://channels.weixin.qq.com/export/x1')
      expect(p.videos).toHaveLength(1)
    })

    it('多视频按出现顺序', () => {
      const p = noteShowToParsedArticle(base({
        contentHtml: '<channel-video feed-id="export/a"></channel-video><p>中间</p><channel-video feed-id="export/b"></channel-video>',
      }))
      expect(p.videos.map((v) => v.fallbackUrl)).toEqual([
        'https://channels.weixin.qq.com/export/a',
        'https://channels.weixin.qq.com/export/b',
      ])
    })

    it('标签缺 feed-id：替换为说明文字 + warning，不静默丢', () => {
      const p = noteShowToParsedArticle(base({ contentHtml: '<channel-video uuid="cv2"></channel-video>' }))
      expect(p.contentHtml).not.toContain('<channel-video')
      expect(p.contentHtml).toContain('未能解析出')
      expect(p.warnings.some((w) => w.includes('feed-id'))).toBe(true)
      expect(p.videos).toEqual([])
    })

    it('hasVideo:true 但正文无视频标签：warning 如实报告，不静默丢弃', () => {
      const p = noteShowToParsedArticle(base({ contentHtml: '<p>纯文字</p>', hasVideo: true }))
      expect(p.videos).toEqual([])
      expect(p.warnings.some((w) => w.includes('hasVideo'))).toBe(true)
    })

    it('hasVideo:true 且解析出入口：不产生该告警', () => {
      const p = noteShowToParsedArticle(base({
        contentHtml: '<channel-video feed-id="export/ok"></channel-video>',
        hasVideo: true,
      }))
      expect(p.warnings.some((w) => w.includes('hasVideo'))).toBe(false)
    })

    it('hasVideo 缺省（false）：无告警', () => {
      const p = noteShowToParsedArticle(base({}))
      expect(p.warnings.some((w) => w.includes('hasVideo'))).toBe(false)
    })
  })
})
