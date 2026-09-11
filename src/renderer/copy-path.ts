import type { ArticleMeta } from '../core/types'

// 复制到剪贴板的文本：meta.dir 本身就是绝对路径（types.ts:39），
// 不拼接 libraryRoot——拼接反而会在 Windows 上引入分隔符问题。
export function copyPathText(meta: ArticleMeta): string {
  return meta.dir
}

export interface CardMenuItem {
  key: 'read' | 'reveal' | 'copy-path' | 'delete'
  label: string
  danger?: boolean
  disabled?: boolean
}

// 卡片右键菜单内容：与 hover 按钮同一组动作（阅读/文件夹/复制路径/删除），
// 右键菜单是发现性补充，不替换 hover 入口（PRD v0.11.0 R1）。
export function cardMenuItems(readable: boolean): CardMenuItem[] {
  return [
    { key: 'read', label: '阅读', disabled: !readable },
    { key: 'reveal', label: '文件夹' },
    { key: 'copy-path', label: '📋 复制路径' },
    { key: 'delete', label: '删除', danger: true },
  ]
}
