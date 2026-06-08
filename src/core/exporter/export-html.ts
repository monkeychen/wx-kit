// src/core/exporter/export-html.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleMeta } from '../types'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const STYLE = `
  body{max-width:720px;margin:0 auto;padding:24px;font-family:-apple-system,system-ui,"PingFang SC",sans-serif;line-height:1.75;color:#222}
  img{max-width:100%;height:auto}
  .wxk-header{border-bottom:1px solid #eee;padding-bottom:12px;margin-bottom:24px;color:#888;font-size:14px}
  h1{font-size:22px;line-height:1.4}
  /* R4：导出 PDF（printToPDF 用打印媒介）时，图片/表格/代码块/引用整体不被页边界切断。
     仅作用于打印态，屏幕阅读器零影响；用户自行 Ctrl+P 打印这份 HTML 也受益。 */
  @media print {
    img { break-inside: avoid; page-break-inside: avoid; display: block; max-width: 100%; height: auto; margin: 0 auto }
    figure, table, pre, blockquote { break-inside: avoid; page-break-inside: avoid }
    h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid }
    p { orphans: 3; widows: 3 }
  }
`

export function buildHtml(meta: ArticleMeta, contentHtml: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(meta.title)}</title>
<style>${STYLE}</style>
</head><body>
<h1>${esc(meta.title)}</h1>
<div class="wxk-header">${esc(meta.account)} · ${esc(meta.publishTime)} · <a href="${esc(meta.sourceUrl)}">原文</a></div>
<article>${contentHtml}</article>
</body></html>`
}

export async function writeHtml(dir: string, meta: ArticleMeta, contentHtml: string): Promise<void> {
  await writeFile(join(dir, 'index.html'), buildHtml(meta, contentHtml), 'utf-8')
}
