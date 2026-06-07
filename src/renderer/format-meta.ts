import type { DownloadFormat } from '../core/types'

// 格式的中文友好名 + 一句话说明。用户不该面对 cover/md/html/pdf/meta 这种代号。
export interface FormatInfo {
  value: DownloadFormat
  name: string
  desc: string
}

export const FORMAT_INFOS: FormatInfo[] = [
  { value: 'md', name: 'Markdown', desc: '纯文本，适合二次编辑' },
  { value: 'html', name: '网页', desc: '保留原文排版样式' },
  { value: 'pdf', name: 'PDF', desc: '便于打印与归档' },
  { value: 'cover', name: '封面图', desc: '保存文章头图' },
  { value: 'meta', name: '元信息', desc: '标题/作者/时间 JSON' },
]
