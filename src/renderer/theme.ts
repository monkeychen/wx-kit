import type { ThemeConfig } from 'antd'

// antd 主题 token：让所有 antd 控件（Input/Button/Checkbox/message/Popconfirm…）
// 自动套上「暖色编辑杂志风」的配色、字体与圆角，与自定义 CSS 协调一致。
const SERIF = '"Source Han Serif SC", "Noto Serif SC", "Songti SC", serif'

export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#b5462f',
    colorInfo: '#b5462f',
    colorSuccess: '#3f6b51',
    colorWarning: '#9a6b1e',
    colorError: '#b5462f',
    colorText: '#211c15',
    colorTextSecondary: '#6c6354',
    colorTextTertiary: '#a59c89',
    colorBgBase: '#faf7f0',
    colorBgContainer: '#fffdf8',
    colorBgElevated: '#fffdf8',
    colorBorder: 'rgba(33, 28, 21, 0.18)',
    colorBorderSecondary: 'rgba(33, 28, 21, 0.10)',
    borderRadius: 8,
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif',
    fontSize: 14,
    controlHeight: 38,
  },
  components: {
    Button: { fontWeight: 600, primaryShadow: 'none' },
    Input: { activeShadow: '0 0 0 2px rgba(181, 70, 47, 0.12)' },
    Segmented: { itemSelectedBg: '#fffdf8', trackBg: '#f3ede1' },
    Modal: { titleFontSize: 18 },
  },
} satisfies ThemeConfig

export const SERIF_FONT = SERIF
