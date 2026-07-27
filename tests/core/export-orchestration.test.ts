// tests/core/export-orchestration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { exportArticle, type ExportDeps, type ExportInput } from '../../src/core/exporter/index'
import type { ParsedArticle } from '../../src/core/types'

describe('exportArticle: failed-image data-src strip', () => {
  it('strips data-src attrs for failed images and keeps local path for succeeded images', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wxk-orch-'))

    const successUrl = 'https://img.example.com/success.jpg'
    const failUrl = 'https://img.example.com/fail.jpg'

    const parsed: ParsedArticle = {
      title: 'Test Article',
      author: 'Test Author',
      account: 'TestAccount',
      publishTime: '2026-06-06',
      digest: 'Test digest',
      coverUrl: '',
      contentHtml: `<p><img data-src="${successUrl}" /></p><p><img data-src="${failUrl}" /></p>`,
      imageUrls: [successUrl, failUrl], videos: [], itemShowType: 0, warnings: []
    }

    const deps: ExportDeps = {
      fetchBinary: async (url: string) => {
        if (url === successUrl) {
          return { data: Buffer.from('fakeimgdata'), contentType: 'image/jpeg' }
        }
        throw new Error('network error for failed image')
      },
      BrowserWindowCtor: undefined as any, // pdf not selected, won't be called
      now: () => '2026-06-06T00:00:00.000Z',
    }

    const input: ExportInput = {
      parsed,
      id: 'test-id-1',
      sourceUrl: 'https://mp.weixin.qq.com/s/test',
      dir: join(tmpDir, 'article'),
      formats: ['html'],
    }

    await exportArticle(input, deps)

    const htmlContent = readFileSync(join(tmpDir, 'article', 'index.html'), 'utf-8')

    // Succeeded image should use local path
    expect(htmlContent).toContain('images/img-1.jpg')

    // No data-src attributes should remain (failed images stripped)
    expect(htmlContent).not.toContain('data-src=')

    // No remote URL from the failed image
    expect(htmlContent).not.toContain(failUrl)

    // Image file actually written to disk
    expect(existsSync(join(tmpDir, 'article', 'images', 'img-1.jpg'))).toBe(true)
  })
})

describe('exportArticle: 告警落进 meta（M40）', () => {
  const base = (over: Partial<ParsedArticle> = {}): ParsedArticle => ({
    title: 'T', author: 'A', account: 'Acc', publishTime: '2026-07-28',
    digest: '', coverUrl: '', contentHtml: '<p>正文</p>',
    imageUrls: [], videos: [], itemShowType: 0, warnings: [], ...over,
  })
  const deps = (): ExportDeps => ({
    fetchBinary: async () => { throw new Error('不该被调用') },
    BrowserWindowCtor: undefined as any,
    now: () => '2026-07-28T00:00:00.000Z',
  })

  it('解析告警写进 meta.json——否则 GUI 下载完就再也查不到了', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wxk-warn-')), 'article')
    const meta = await exportArticle({
      parsed: base({ warnings: ['未识别的消息类型 99,已按普通图文解析'] }),
      id: 'i1', sourceUrl: 'https://mp.weixin.qq.com/s/x', dir, formats: ['meta'],
    }, deps())
    expect(meta.warnings).toEqual(['未识别的消息类型 99,已按普通图文解析'])
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')).warnings).toHaveLength(1)
  })

  it('视频下载失败的告警也进 meta（它在 buildMeta 之后才产生，容易漏）', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wxk-warn2-')), 'article')
    const meta = await exportArticle({
      parsed: base({
        videos: [{ videoId: 'v1', formatId: 'f1', width: 640, height: 360, filesize: 1000, durationMs: 1000, qualityWording: '高清', url: 'https://v.example.com/a.mp4' }],
      }),
      id: 'i2', sourceUrl: 'https://mp.weixin.qq.com/s/y', dir, formats: ['meta'],
    }, { ...deps(), fetchBinary: async () => { throw new Error('视频下载失败') } })
    expect(meta.warnings?.length).toBe(1)
    expect(meta.warnings?.[0]).toMatch(/视频/)
  })

  it('没有告警时不写该字段——不给全库多一个空数组', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wxk-warn3-')), 'article')
    const meta = await exportArticle({
      parsed: base(), id: 'i3', sourceUrl: 'https://mp.weixin.qq.com/s/z', dir, formats: ['meta'],
    }, deps())
    expect(meta.warnings).toBeUndefined()
    expect('warnings' in JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'))).toBe(false)
  })
})
