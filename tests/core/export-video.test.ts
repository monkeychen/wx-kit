// tests/core/export-video.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportArticle, type ExportDeps } from '../../src/core/exporter/index'
import type { ParsedArticle, DownloadFormat } from '../../src/core/types'
import type { MpVideoSource } from '../../src/core/parse-video'

const VIDEO: MpVideoSource = {
  videoId: 'wxv_test001',
  formatId: '10002',
  url: 'http://mpvideo.qpic.cn/abc.f10002.mp4?dis_t=1&auth_key=k',
  width: 1572, height: 1080, filesize: 12, durationMs: 992000,
  qualityWording: '超清',
}

const parsedWithVideo = (): ParsedArticle => ({
  title: '带视频的文章', author: '作者', account: '某号',
  publishTime: '2026-07-12 13:20', digest: '摘要', coverUrl: '',
  contentHtml: '<p>视频的描述文字。</p>',
  imageUrls: [], videos: [VIDEO], itemShowType: 0, warnings: []
})

const run = async (formats: DownloadFormat[], opts: { downloadVideos?: boolean; fetchBinary?: ExportDeps['fetchBinary'] } = {}) => {
  const { downloadVideos = true, fetchBinary } = opts
  const dir = join(mkdtempSync(join(tmpdir(), 'wxk-vid-')), 'art')
  const calls: string[] = []
  const deps: ExportDeps = {
    fetchBinary: fetchBinary ?? (async (url) => {
      calls.push(url)
      return { data: Buffer.from('MP4BYTESxxxx'), contentType: 'video/mp4' }
    }),
    BrowserWindowCtor: undefined as never,
    now: () => '2026-07-26T00:00:00.000Z',
  }
  const wrapped: ExportDeps = { ...deps, fetchBinary: async (u) => { calls.push(u); return deps.fetchBinary(u) } }
  const meta = await exportArticle({ parsed: parsedWithVideo(), id: 'id1', sourceUrl: 'https://x', dir, formats, downloadVideos }, wrapped)
  return { dir, meta, calls }
}

describe('exportArticle: 视频格式', () => {
  it('默认(有视频就下):视频落盘 videos/video-1.mp4,字节即下载内容', async () => {
    const { dir } = await run(['md', 'meta'])
    const p = join(dir, 'videos', 'video-1.mp4')
    expect(existsSync(p)).toBe(true)
    expect(readFileSync(p).toString()).toBe('MP4BYTESxxxx')
  })

  it('md 正文给出指向本地 mp4 的可点链接(纯文本无法内联播放)', async () => {
    const { dir } = await run(['md'])
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('(videos/video-1.mp4)')
    expect(md).toContain('1572×1080')   // 让用户知道拿到的是哪一档
    expect(md).toContain('16:32')       // 992000ms → 时长可读
  })

  it('html 正文给出可直接播放的 <video>(不依赖脚本,阅读器 iframe sandbox 下也能播)', async () => {
    const { dir } = await run(['html'])
    const html = readFileSync(join(dir, 'index.html'), 'utf-8')
    expect(html).toContain('<video controls')
    expect(html).toContain('src="videos/video-1.mp4"')
  })

  it('meta.json 记视频明细:下载成功不落 streamUrl(本地文件永久,直链无用),fallbackUrl 缺省补 sourceUrl', async () => {
    const { dir } = await run(['meta'])
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'))
    expect(meta.videos).toHaveLength(1)
    expect(meta.videos[0]).toMatchObject({ videoId: 'wxv_test001', formatId: '10002', width: 1572, path: 'videos/video-1.mp4' })
    expect(meta.videos[0].streamUrl).toBeUndefined()
    expect(meta.videos[0].fallbackUrl).toBe('https://x')   // 解析器未给 fallbackUrl → exporter 补 sourceUrl
  })

  it('设置里关掉视频下载:不下载、不建目录,md 给永久跳转链接并如实标注直链可能过期(不静默丢弃)', async () => {
    const { dir, meta, calls } = await run(['md', 'meta'], { downloadVideos: false })
    expect(existsSync(join(dir, 'videos'))).toBe(false)
    expect(calls).toEqual([])   // 一个请求都不该发
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('(https://x)')     // 指向文章原页(fallbackUrl 缺省=sourceUrl)
    expect(md).toContain('可能已过期')        // 诚实性红线:直链时效必须说
    // meta 仍记有视频这件事，只是没有 path
    expect(meta.videos?.[0].path).toBeUndefined()
    // streamUrl 落 meta(当次直链,阅读器可试播;PRD R1 裁决:不是长期副本而是双入口)
    expect(meta.videos?.[0].streamUrl).toBe(VIDEO.url)
  })

  it('未下载 + 有 streamUrl:html 给在线播放器 + 永久「在微信里打开」入口(Q1=C 双入口)', async () => {
    const { dir } = await run(['html'], { downloadVideos: false })
    const html = readFileSync(join(dir, 'index.html'), 'utf-8')
    expect(html).toContain('<video controls')
    expect(html).toContain(`src="${VIDEO.url}"`)   // 当次直链可播
    expect(html).toContain('href="https://x"')     // 永久跳转入口
    expect(html).toContain('可能已过期')             // 标注时效
  })

  it('无直链条目(墨问视频号嵌入):不发请求,html/md 给视频号页跳转链接,fallbackUrl 不被 sourceUrl 覆盖', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wxk-chv-')), 'art')
    const entry = { videoId: 'export/abc123', formatId: 'channels-embed', width: 0, height: 0, filesize: 0, durationMs: 0, fallbackUrl: 'https://channels.weixin.qq.com/export/abc123' }
    const parsed: ParsedArticle = { ...parsedWithVideo(), videos: [entry] }
    const calls: string[] = []
    const meta = await exportArticle({ parsed, id: 'i', sourceUrl: 'https://note.example/x', dir, formats: ['md', 'html', 'meta'] }, {
      fetchBinary: async (u) => { calls.push(u); throw new Error('should not be called') },
      BrowserWindowCtor: undefined as never, now: () => '2026-07-26T00:00:00.000Z',
    })
    expect(calls).toEqual([])
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('(https://channels.weixin.qq.com/export/abc123)')
    const html = readFileSync(join(dir, 'index.html'), 'utf-8')
    expect(html).toContain('href="https://channels.weixin.qq.com/export/abc123"')
    expect(html).not.toContain('<video')   // 无直链就没有播放器,不渲染一个必然播不出的空壳
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')).videos[0].fallbackUrl).toBe('https://channels.weixin.qq.com/export/abc123')
    expect(meta.videos?.[0].streamUrl).toBeUndefined()
  })

  it('inline 条目(墨问 channel-video 已原地替换):不再追加片段,正文只有原位置一个入口', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wxk-inline-')), 'art')
    const entry = { videoId: 'export/abc123', formatId: 'channels-embed', width: 0, height: 0, filesize: 0, durationMs: 0, fallbackUrl: 'https://channels.weixin.qq.com/export/abc123', inline: true }
    const parsed: ParsedArticle = {
      ...parsedWithVideo(), videos: [entry],
      contentHtml: '<p>看视频</p><p><a href="https://channels.weixin.qq.com/export/abc123">▶ 视频号视频（点击去观看）</a></p>',
    }
    await exportArticle({ parsed, id: 'i', sourceUrl: 'https://note.example/x', dir, formats: ['md', 'html', 'meta'] }, {
      fetchBinary: async () => { throw new Error('should not be called') },
      BrowserWindowCtor: undefined as never, now: () => '2026-07-26T00:00:00.000Z',
    })
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect((md.match(/channels\.weixin\.qq\.com\/export\/abc123/g) || []).length).toBe(1)   // 只有原位置一个
    const html = readFileSync(join(dir, 'index.html'), 'utf-8')
    expect((html.match(/channels\.weixin\.qq\.com\/export\/abc123/g) || []).length).toBe(1)
    // meta 仍记视频这件事(ArticleCard 📹 标记与阅读器入口靠它)
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')).videos).toHaveLength(1)
  })

  it('视频下载失败:其余格式照常产出,meta 里该视频无 path,不抛异常', async () => {
    const { dir, meta } = await run(['md', 'meta'], { fetchBinary: async () => { throw new Error('network down') } })
    expect(existsSync(join(dir, 'content.md'))).toBe(true)
    expect(existsSync(join(dir, 'videos', 'video-1.mp4'))).toBe(false)
    expect(meta.videos?.[0].path).toBeUndefined()
  })

  it('视频下载失败:说明保留,并补永久跳转链接(读者还有路可走)', async () => {
    const { dir } = await run(['md'], { fetchBinary: async () => { throw new Error('network down') } })
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('下载失败')
    expect(md).toContain('(https://x)')
  })

  it('无视频的文章:不受影响,meta 无 videos 字段', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wxk-novid-')), 'art')
    const parsed: ParsedArticle = { ...parsedWithVideo(), videos: [] }
    const meta = await exportArticle({ parsed, id: 'i', sourceUrl: 'https://x', dir, formats: ['md', 'meta'] }, {
      fetchBinary: async () => { throw new Error('should not be called') },
      BrowserWindowCtor: undefined as never, now: () => '2026-07-26T00:00:00.000Z',
    })
    expect(meta.videos).toBeUndefined()
    // 断言正文里没有视频引用标记（不能断言「不含'视频'」——这篇 fixture 标题本身就叫「带视频的文章」）
    expect(readFileSync(join(dir, 'content.md'), 'utf-8')).not.toContain('📹')
  })
})
