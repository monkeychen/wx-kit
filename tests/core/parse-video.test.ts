// tests/core/parse-video.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractMpVideos } from '../../src/core/parse-video'

const videoHtml = readFileSync(join(__dirname, '../fixtures/video-message.html'), 'utf-8')
const plainHtml = readFileSync(join(__dirname, '../fixtures/sample-article.html'), 'utf-8')
const picHtml = readFileSync(join(__dirname, '../fixtures/picture-message.html'), 'utf-8')

describe('extractMpVideos', () => {
  it('从视频消息页提取到一个视频,带 videoId', () => {
    const vs = extractMpVideos(videoHtml)
    expect(vs).toHaveLength(1)
    expect(vs[0].videoId).toBe('wxv_4601001312020021250')
  })

  it('择档按分辨率取最高清——不是按 format_id 数值最大', () => {
    const [v] = extractMpVideos(videoHtml)
    // 实测四档:f10002=1572x1080(133.5MB) / f10102=1080x740 / f10004=698x480 / f10104=480x328(12.9MB)
    // format_id 最大的 f10104 恰恰是最小的一档,所以按 format_id 排序会选出 480x328 的垃圾画质
    expect(v.formatId).toBe('10002')
    expect(v.width).toBe(1572)
    expect(v.height).toBe(1080)
    expect(v.filesize).toBe(139984916)
  })

  it('URL 解码到可直接请求的形态(\\x26amp; → &)', () => {
    const [v] = extractMpVideos(videoHtml)
    expect(v.url).toContain('mpvideo.qpic.cn')
    expect(v.url).toContain('.f10002.mp4')
    expect(v.url).toContain('&dis_t=')
    expect(v.url).toContain('&auth_key=')
    // 两种未解码残留都不许出现,否则请求必然 403/参数错
    expect(v.url).not.toContain('\\x26')
    expect(v.url).not.toContain('&amp;')
  })

  it('带出时长与清晰度描述(给用户看的信息)', () => {
    const [v] = extractMpVideos(videoHtml)
    expect(v.durationMs).toBe(992000)
    expect(v.qualityWording).toBe('超清')
  })

  it('普通图文页 / 图文消息页没有视频 → 空数组', () => {
    expect(extractMpVideos(plainHtml)).toEqual([])
    expect(extractMpVideos(picHtml)).toEqual([])
  })

  it('有 video_page_info 但 mp_video_trans_info 为空 → 空数组(没有可下的档)', () => {
    const empty = videoHtml.replace(/mp_video_trans_info: \[[\s\S]*?\n\s*\],/, 'mp_video_trans_info: [\n],')
    expect(extractMpVideos(empty)).toEqual([])
  })
})
