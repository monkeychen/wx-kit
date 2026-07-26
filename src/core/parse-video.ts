// src/core/parse-video.ts
// 从微信文章页提取内嵌上传视频(mpvideo.qpic.cn)的可下载直链。
// 只处理「作者直接上传到公众号」的视频;视频号卡片(findermp.video.qq.com,encfilekey 加密)不在本模块范围。

/** 一个视频的选定清晰度档(url 有时效,不得持久化) */
export interface MpVideoSource {
  videoId: string
  formatId: string
  /** 已解码、可直接请求的 mp4 直链。带 dis_t/auth_key 签名,**有时效** */
  url: string
  width: number
  height: number
  filesize: number
  durationMs: number
  /** 微信自己的清晰度说法(「超清」/「流畅」),仅供展示 */
  qualityWording: string
}

/**
 * 还原脚本里的 URL:先解 JS 的 \xNN 转义,再解 HTML 实体 &amp;。
 * 页面里的形态是 `...mp4?dis_k=xxx\x26amp;dis_t=...` —— 两层都不解就会带着
 * 字面 `&amp;` 去请求,参数解析必然出错。
 */
function decodeUrl(raw: string): string {
  return raw
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .trim()
}

function num(seg: string, key: string): number {
  const m = seg.match(new RegExp(`${key}:\\s*'(\\d+)'`))
  return m ? Number(m[1]) : 0
}

/**
 * 提取页面里所有内嵌视频,每个视频返回**一个**清晰度档:分辨率最大的那个。
 *
 * 择档不能按 format_id 数值——实测 f10002 是 1572×1080/133.5MB(最高清)、
 * f10104 是 480×328/12.9MB(最低),数值大小与画质**无关**。
 * `video_quality_wording` 只有「超清/流畅」两档且会重复,也不足以排序。
 * 故按 width×height 降序,filesize 做 tie-break。
 */
export function extractMpVideos(html: string): MpVideoSource[] {
  const out: MpVideoSource[] = []
  // 先按 video_page_info 逐个切段再匹配:整页匹配会撞上别处的同名字段(M19 的教训)
  const infoRe = /video_page_info:\s*\{/g
  for (let m = infoRe.exec(html); m; m = infoRe.exec(html)) {
    const seg = html.slice(m.index, m.index + 20000)
    const vid = seg.match(/video_id:\s*'([^']+)'/)?.[1] ?? ''
    const transStart = seg.indexOf('mp_video_trans_info: [')
    if (!vid || transStart < 0) continue

    const tiers: MpVideoSource[] = []
    // 每一档是一个 { ... } 项;url 必须存在才算可下
    for (const item of seg.slice(transStart).matchAll(/\{([^{}]*?url:\s*'[^']*'[^{}]*?)\}/g)) {
      const t = item[1]
      const rawUrl = t.match(/url:\s*'([^']*)'/)?.[1] ?? ''
      if (!rawUrl.includes('mpvideo.qpic.cn')) continue
      tiers.push({
        videoId: vid,
        formatId: t.match(/format_id:\s*'(\d+)'/)?.[1] ?? '',
        url: decodeUrl(rawUrl),
        width: num(t, 'width'),
        height: num(t, 'height'),
        filesize: num(t, 'filesize'),
        durationMs: num(t, 'duration_ms'),
        qualityWording: t.match(/video_quality_wording:\s*'([^']*)'/)?.[1] ?? '',
      })
    }
    if (!tiers.length) continue
    tiers.sort((a, b) => b.width * b.height - a.width * a.height || b.filesize - a.filesize)
    out.push(tiers[0])
  }
  return out
}
