// src/core/exporter/export-video.ts
// 内嵌视频的落盘与正文引用。视频动辄上百 MB(实测最高清档 133MB),故:
// ① 只在显式选了 video 格式时下载;② 串行,不并发;③ 没选/失败都要在正文说清,不静默丢弃。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MpVideoSource } from '../parse-video'

/** meta.json 里记的视频明细。**不含 url**——直链带 auth_key/dis_t 签名有时效。 */
export interface VideoRecord {
  videoId: string
  formatId: string
  width: number
  height: number
  filesize: number
  durationMs: number
  /** 库内相对路径;未下载(没选 video 格式)或下载失败时缺省 */
  path?: string
}

/** 毫秒 → m:ss(给人看的时长) */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const sizeMb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)}MB`

/**
 * 按体积算超时:图片用的 20 秒对视频完全不够(133MB 在 2.66MB/s 下要 50 秒)。
 * 下限速度按 200KB/s 估——比国内直连 GitHub 还慢的网也能下完;最少给 60 秒。
 * 固定一个大常数不行:小视频等 20 分钟才报错,大视频又可能不够。
 */
export function videoTimeoutMs(filesize: number): number {
  return Math.max(60_000, Math.ceil(filesize / 200_000) * 1000)
}

export interface DownloadVideosResult {
  records: VideoRecord[]
  /** 追加到 html 正文的片段(可播 <video> 或说明);无视频时空串 */
  htmlSuffix: string
  /** 追加到 markdown 的片段(可点链接或说明);<video> 是 turndown 不认识的标签,必须分开给 */
  mdSuffix: string
  /** 视频相关的告警(失败原因),供上层上报——失败不该只躺在文件里 */
  warnings: string[]
}

/**
 * 按需下载视频并产出正文追加片段。
 * `download=false` 时不发任何请求,只产出说明——用户仍然知道「这里有个视频」。
 */
export async function downloadVideos(
  videos: MpVideoSource[],
  dir: string,
  download: boolean,
  fetchBinary: (url: string, timeoutMs?: number) => Promise<{ data: Buffer; contentType: string }>,
  onProgress?: (e: { index: number; total: number; video: MpVideoSource }) => void,
): Promise<DownloadVideosResult> {
  if (!videos.length) return { records: [], htmlSuffix: '', mdSuffix: '', warnings: [] }

  const records: VideoRecord[] = videos.map((v) => ({
    videoId: v.videoId, formatId: v.formatId, width: v.width, height: v.height,
    filesize: v.filesize, durationMs: v.durationMs,
  }))
  const spec = (v: MpVideoSource) => `${v.width}×${v.height}, ${formatDuration(v.durationMs)}, ${sizeMb(v.filesize)}`

  if (!download) {
    // 不静默丢弃:说清有几个、多大、怎么才能拿到
    const note = `📹 本文含 ${videos.length} 个视频（未下载；${videos.map(spec).join('；')}）。下载时勾选「视频」格式即可保存。`
    return { records, htmlSuffix: `<p>${note}</p>`, mdSuffix: note, warnings: [] }
  }

  await mkdir(join(dir, 'videos'), { recursive: true })
  const htmlParts: string[] = []
  const mdParts: string[] = []
  const warnings: string[] = []
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]
    const rel = `videos/video-${i + 1}.mp4`
    onProgress?.({ index: i + 1, total: videos.length, video: v })
    try {
      const { data } = await fetchBinary(v.url, videoTimeoutMs(v.filesize))
      await writeFile(join(dir, rel), data)
      records[i].path = rel
      // <video> 不依赖脚本,阅读器的 iframe(sandbox 无 allow-scripts)里也能播
      htmlParts.push(`<p><video controls preload="metadata" width="100%" src="${rel}"></video></p>`)
      // md 是纯文本,只能给可点链接;附上参数,免得点开才发现是 480p
      mdParts.push(`[📹 视频 ${i + 1}（${v.width}×${v.height}, ${formatDuration(v.durationMs)}）](${rel})`)
    } catch (e) {
      // 视频失败不该拖垮整篇(其余格式已写好),但必须说出来——两处正文都写,并上报告警
      const why = (e as Error).message
      const note = `📹 视频 ${i + 1} 下载失败（${spec(v)}）：${why}`
      htmlParts.push(`<p>${note}</p>`)
      mdParts.push(note)
      warnings.push(note)
    }
  }
  return { records, htmlSuffix: htmlParts.join('\n'), mdSuffix: mdParts.join('\n\n'), warnings }
}
