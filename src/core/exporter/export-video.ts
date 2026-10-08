// src/core/exporter/export-video.ts
// 内嵌视频的落盘与正文引用。视频动辄上百 MB(实测最高清档 133MB),故:
// ① 只在显式选了 video 格式时下载;② 串行,不并发;③ 没选/失败都要在正文说清,不静默丢弃。
// v0.12.2 R1:视频从「说明文字」升级为「入口」——能播就播(当次直链),失效有永久跳转兜底。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VideoEntry } from '../parse-video'
import { globalRequestStopCode } from '../mp-errors'

/** meta.json 里记的视频明细。
 *  streamUrl 是**带时效的当次直链**——仅未下载/下载失败的条目落盘,供阅读器试播、
 *  失效自动降级;下载成功的条目本地文件永久,直链是冗余,不留。fallbackUrl 永久有效。
 *  (v0.12.2 R1 裁决:存的不是签名直链的长期副本,而是「当次可用则用、不可用则降级」的双入口。) */
export interface VideoRecord {
  videoId: string
  formatId: string
  width: number
  height: number
  filesize: number
  durationMs: number
  /** 库内相对路径;未下载(没选 video 格式)或下载失败时缺省 */
  path?: string
  /** 当次签名直链(可能已过期);下载成功后不落 */
  streamUrl?: string
  /** 永久有效的跳转目标(微信=文章原页;墨问=视频号页) */
  fallbackUrl?: string
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
  /** 追加到 html 正文的片段(可播 <video> 或入口链接);无视频时空串 */
  htmlSuffix: string
  /** 追加到 markdown 的片段(可点链接);<video> 是 turndown 不认识的标签,必须分开给 */
  mdSuffix: string
  /** 视频相关的告警(失败原因),供上层上报——失败不该只躺在文件里 */
  warnings: string[]
}

/** 无直链条目(墨问视频号嵌入)的入口片段:只有跳转一条路,不渲染必然播不出的空播放器 */
function channelsEntryHtml(v: VideoEntry): string {
  return `<p><a href="${v.fallbackUrl}">▶ 视频号视频（点击去观看）</a></p>`
}
function channelsEntryMd(v: VideoEntry): string {
  return `[▶ 视频号视频（点击去观看）](${v.fallbackUrl})`
}

/**
 * 按需下载视频并产出正文追加片段。
 * `download=false` 时不发任何请求:有直链的给「在线播放器 + 永久跳转」双入口,
 * 无直链的给跳转链接——用户仍然知道「这里有个视频、怎么看」,且直链时效如实标注。
 */
export async function downloadVideos(
  videos: VideoEntry[],
  dir: string,
  download: boolean,
  fetchBinary: (url: string, timeoutMs?: number) => Promise<{ data: Buffer; contentType: string }>,
  onProgress?: (e: { index: number; total: number; video: VideoEntry }) => void,
): Promise<DownloadVideosResult> {
  if (!videos.length) return { records: [], htmlSuffix: '', mdSuffix: '', warnings: [] }

  const records: VideoRecord[] = videos.map((v) => ({
    videoId: v.videoId, formatId: v.formatId, width: v.width, height: v.height,
    filesize: v.filesize, durationMs: v.durationMs,
    ...(v.url ? { streamUrl: v.url } : {}),
    ...(v.fallbackUrl ? { fallbackUrl: v.fallbackUrl } : {}),
  }))
  const spec = (v: VideoEntry) => `${v.width}×${v.height}, ${formatDuration(v.durationMs)}, ${sizeMb(v.filesize)}`

  if (!download) {
    const htmlParts: string[] = []
    const mdParts: string[] = []
    videos.forEach((v, i) => {
      if (v.inline) return   // 正文原位置已有入口(墨问 channel-video),不再追加
      if (!v.url || !v.fallbackUrl) {
        // 无直链(墨问视频号嵌入):只有视频号页一条路
        htmlParts.push(channelsEntryHtml(v))
        mdParts.push(channelsEntryMd(v))
        return
      }
      // 有直链:html 给播放器 + 永久跳转(直链当次有效);md 纯文本存不住播放器,给永久链接并标注时效
      htmlParts.push(
        `<p><video controls preload="metadata" width="100%" src="${v.url}"></video></p>` +
        `<p><a href="${v.fallbackUrl}">▶ 在微信里打开</a>（在线播放的直链有时效，可能已过期）</p>`,
      )
      mdParts.push(`[▶ 视频 ${i + 1}（${spec(v)}，在线播放，直链可能已过期）](${v.fallbackUrl})`)
    })
    return { records, htmlSuffix: htmlParts.join('\n'), mdSuffix: mdParts.join('\n\n'), warnings: [] }
  }

  await mkdir(join(dir, 'videos'), { recursive: true })
  const htmlParts: string[] = []
  const mdParts: string[] = []
  const warnings: string[] = []
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]
    const n = i + 1
    if (v.inline) continue   // 正文原位置已有入口(墨问 channel-video),不再追加
    onProgress?.({ index: n, total: videos.length, video: v })
    if (!v.url || !v.fallbackUrl) {
      htmlParts.push(channelsEntryHtml(v))
      mdParts.push(channelsEntryMd(v))
      continue
    }
    const rel = `videos/video-${n}.mp4`
    try {
      const { data } = await fetchBinary(v.url, videoTimeoutMs(v.filesize))
      await writeFile(join(dir, rel), data)
      records[i].path = rel
      delete records[i].streamUrl   // 本地文件永久,直链是不留为好的冗余
      // <video> 不依赖脚本,阅读器的 iframe(sandbox 无 allow-scripts)里也能播
      htmlParts.push(`<p><video controls preload="metadata" width="100%" src="${rel}"></video></p>`)
      // md 是纯文本,只能给可点链接;附上参数,免得点开才发现是 480p
      mdParts.push(`[📹 视频 ${n}（${v.width}×${v.height}, ${formatDuration(v.durationMs)}）](${rel})`)
    } catch (e) {
      if (globalRequestStopCode(e)) throw e
      // 视频失败不该拖垮整篇(其余格式已写好),但必须说出来——两处正文都写,并上报告警;
      // 同时补永久跳转链接,读者永远有路可走
      const why = (e as Error).message
      const note = `📹 视频 ${n} 下载失败（${spec(v)}）：${why}`
      htmlParts.push(`<p>${note}</p><p><a href="${v.fallbackUrl}">▶ 在微信里打开</a></p>`)
      mdParts.push(`${note}\n\n[▶ 在微信里打开](${v.fallbackUrl})`)
      warnings.push(note)
    }
  }
  return { records, htmlSuffix: htmlParts.join('\n'), mdSuffix: mdParts.join('\n\n'), warnings }
}
