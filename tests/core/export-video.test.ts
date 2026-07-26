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
  imageUrls: [], videos: [VIDEO],
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

  it('meta.json 记视频明细,但不记 url(直链有时效,存下来只会误导)', async () => {
    const { dir } = await run(['meta'])
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'))
    expect(meta.videos).toHaveLength(1)
    expect(meta.videos[0]).toMatchObject({ videoId: 'wxv_test001', formatId: '10002', width: 1572, path: 'videos/video-1.mp4' })
    expect(JSON.stringify(meta)).not.toContain('auth_key')
  })

  it('设置里关掉视频下载:不下载、不建目录,但正文留一行知情提示(不静默丢弃)', async () => {
    const { dir, meta, calls } = await run(['md', 'meta'], { downloadVideos: false })
    expect(existsSync(join(dir, 'videos'))).toBe(false)
    expect(calls).toEqual([])   // 一个请求都不该发
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('本文含 1 个视频')
    expect(md).toContain('未下载')
    // meta 仍记有视频这件事，只是没有 path
    expect(meta.videos?.[0].path).toBeUndefined()
  })

  it('视频下载失败:其余格式照常产出,meta 里该视频无 path,不抛异常', async () => {
    const { dir, meta } = await run(['md', 'meta'], { fetchBinary: async () => { throw new Error('network down') } })
    expect(existsSync(join(dir, 'content.md'))).toBe(true)
    expect(existsSync(join(dir, 'videos', 'video-1.mp4'))).toBe(false)
    expect(meta.videos?.[0].path).toBeUndefined()
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
