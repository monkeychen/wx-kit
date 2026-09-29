#!/usr/bin/env node
// 生成 README 用的下载统计：SVG 趋势图 + 各平台安装包直链。
//
// 为什么是脚本而不是手画：download_count 是 GitHub 的累计值（见下方「数据口径」），
// 手画一次就固定死了，发版后不会更新。脚本让数据可复现、可在发版时重跑。
//
// 用法：
//   node scripts/update-download-stats.mjs              # 拉数据、生成 SVG、更新 README
//   node scripts/update-download-stats.mjs --check# 只校验不改写（CI 用）
//   node scripts/update-download-stats.mjs --tag v0.12.1# 指定「最新版本」指向
//
// 前置：gh 已登录且能读本仓库（`gh auth status`）。国内网络需unset 代理直连。
//
// ── 数据口径（README 里必须原样保留这段说明，否则图表会被误读）────────────
// GitHub 的 asset.download_count 是**该资产自发布以来的累计下载次数**，
// 不是按天/按周的增量。GitHub 不提供下载量的时间序列 API，历史快照无法追溯。
// 因此本图只能画「每个版本的累计下载数」，不能画「每日下载趋势」——
// 后者需要每天跑一次 API 记录快照，属于自建数据，从本脚本启用之日起才开始积累。
// 另注：老版本累计数高于新版本是正常的（有人从收藏的旧 release 链接取包），
// 不代表最新版不受欢迎。
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const README = join(ROOT, 'README.md')
const SVG_DIR = join(ROOT, 'docs', 'images')
const SVG_FILE = join(SVG_DIR, 'downloads.svg')
const REPO = 'monkeychen/wx-kit'

function gh(args) {
  // 显式清掉代理：走 8118 传 GitHub 大文件会卡死（项目发版规约已录）。
  const env = { ...process.env }
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete env[k]
  return execFileSync('gh', args, { encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 })
}

// blockmap 是 electron-builder 的差分更新元数据，不是用户会手动点的安装包——
// 统计和链接都不该把它们算进去，否则数字虚高、链接点了没反应。
function classify(name) {
  if (name.endsWith('.blockmap')) return null
  const v = '(v?[0-9.]+)'
  if (new RegExp(`^wx-kit-${v}-arm64\\.dmg$`).test(name)) return 'macos-arm64'
  if (new RegExp(`^wx-kit-${v}\\.dmg$`).test(name)) return 'macos-intel'
  if (new RegExp(`^wx-kit\\.Setup\\.${v}\\.exe$`).test(name)) return 'windows'
  return null
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const tagArgIdx = args.indexOf('--tag')
const latestTag = tagArgIdx >= 0 ? args[tagArgIdx + 1] : null

// ── 1. 拉数据 ──────────────────────────────────────────────────────────
const releases = JSON.parse(gh(['api', `repos/${REPO}/releases?per_page=100`]))
if (!releases.length) {
  console.error('未取到任何 release，终止（不写坏 README）')
  process.exit(1)
}
const published = releases.filter(r => !r.draft && r.published_at).sort((a, b) => a.published_at.localeCompare(b.published_at))

const versions = published.map(r => {
  const installers = r.assets.filter(a => classify(a.name))
  return {
    tag: r.tag_name,
    date: r.published_at.slice(0, 10),
    count: installers.reduce((s, a) => s + a.download_count, 0),   // 只算安装包，不含 blockmap
    assets: installers.map(a => ({ name: a.name, role: classify(a.name), downloads: a.download_count, size: a.size })),
  }
})
const total = versions.reduce((s, v) => s + v.count, 0)

// 「最新版本」以 GitHub 标记的 latest 为准，不靠版本号大小比较。
// gh 的 `-q` 输出是裸字符串（不是 JSON），这里直接用字符串。
const latestTagResolved = latestTag || gh(['api', `repos/${REPO}/releases/latest`, '-q', '.tag_name']).trim()
const latest = versions.find(v => v.tag === latestTagResolved)

if (!latest) {
  console.error(`找不到最新版本（tag=${latestTag}），终止`)
  process.exit(1)
}
console.log(`[download-stats] repo=${REPO}  latest=${latest.tag}  ${versions.length} 个版本  合计 ${total} 次下载`)

const byRole = (role) => latest.assets.find(a => a.role === role)

// ── 2. 生成 SVG（手绘风：细线条、无渐变无阴影，随 GitHub 深浅色主题切换）──────
// 画布宽度按「每个版本都标全 + 垂直排列」反推，不是拍脑袋定的：
// 垂直标签不吃 cos45 的折扣，每个标签占满整个字宽（字号 9px × 7 字符 ≈ 38px），
// 33 个版本 ≈ 1250px，加左右留白取 1360px。版本数增长时按同一公式自动加宽，
// 不会出现「后加的版本标签被挤掉」。垂直排比斜排更易读，代价是图更宽——
// README 里会横向滚动，可接受。
const LABEL_FONT = 9
const LABEL_CHAR_W = 0.6         // 无衬线字体平均字宽 / 字号的经验值
const LABEL_W = LABEL_FONT * LABEL_CHAR_W * 7   // 「v0.12.1」7 字符全宽
const nVer = versions.length
const PAD = { t: 30, r: 24, b: 40, l: 44 }
const W = Math.max(900, Math.ceil((nVer * LABEL_W + PAD.l + PAD.r) / 40) * 40)
const H = 300
const plotW = W - PAD.l - PAD.r
const plotH = H - PAD.t - PAD.b
const maxN = Math.max(...versions.map(v => v.count))
const niceMax = Math.max(10, Math.ceil(maxN / 20) * 20)
const slot = plotW / nVer
const barW = Math.max(3, Math.min(slot * 0.56, 16))

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const y = (n) => PAD.t + plotH - (n / niceMax) * plotH

const FONT = 'ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif'

// 单份 SVG 的构造函数。**所有样式必须是元素内联属性，不能有 <style> 块**——
// GitHub 的 blob 预览会净化含 <style> 的 SVG 并报「Invalid image source」
// （2026-09-29 实录：raw 直连 200 + image/svg+xml正常，但仓库页炸）。
// 深色主题因此不能用 CSS 媒体查询，改由 <picture> 提供第二份 SVG——
// 那是 GitHub 原生支持的方式，且不依赖 SVG 内部样式。
function buildSvg(c) {
  let grid = ''
  const ticks = 4
  for (let i = 0; i <= ticks; i++) {
    const v = (niceMax / ticks) * i
    const yy = (y(v)).toFixed(1)
    grid += `<line x1="${PAD.l}" y1="${yy}" x2="${W - PAD.r}" y2="${yy}" stroke="${c.grid}" stroke-width="1"/>`
    grid += `<text x="${PAD.l - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" font-size="11" font-family='${FONT}' fill="${c.axis}">${Math.round(v)}</text>`
  }

  let bars = ''
  versions.forEach((v, i) => {
    const x = PAD.l + i * slot + (slot - barW) / 2
    const h = Math.max(v.count > 0 ? 2 : 0, (v.count / niceMax) * plotH)
    const fill = v.tag === latest.tag ? c.accent : c.bar
    bars += `<rect x="${x.toFixed(1)}" y="${(PAD.t + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}"/>`
  })

  // 横轴标签：**每个版本都标全**、垂直排列（不旋转）、统一完整 vX.Y.Z 写法。
  // 垂直排比 45° 斜排易读得多，代价是画布更宽（宽度已按标签数反推）。
  // text-anchor=middle 让标签以柱子中线对齐；标签槽位比标签宽时不会互相压字。
  let labels = ''
  versions.forEach((v, i) => {
    const isLatest = v.tag === latest.tag
    const cx = PAD.l + i * slot + slot / 2
    labels += `<text x="${cx.toFixed(1)}" y="${H - PAD.b + 16}" text-anchor="middle" font-size="${LABEL_FONT}" font-weight="${isLatest ? 600 : 400}" font-family='${FONT}' fill="${isLatest ? c.accent : c.axis}" letter-spacing="-0.2">${esc(v.tag)}</text>`
  })

  // 峰值标注（v0.8.5 = 82），给图一个「有故事」的锚点
  const peak = versions.reduce((a, b) => (b.count > a.count ? b : a))
  const peakIdx = versions.indexOf(peak)
  const peakNote = peak.count > 0
    ? `<text x="${(PAD.l + peakIdx * slot + slot / 2).toFixed(1)}" y="${(y(peak.count) - 7).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" font-family='${FONT}' fill="${c.accent}">${peak.count}</text>`
    : ''

  const stamp = new Date().toISOString().slice(0, 10)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="dlTitle dlDesc">
<title id="dlTitle">wx-kit 各版本 GitHub 安装包累计下载数</title>
<desc id="dlDesc">共 ${versions.length} 个已发布版本，合计 ${total} 次下载。数据来自 GitHub Releases API 的 asset.download_count（安装包资产，不含 blockmap），统计时间 ${stamp}。该数字是每个版本发布至今的累计值，不是按天增量，GitHub 不提供时间序列。</desc>
<rect width="${W}" height="${H}" rx="8" fill="${c.bg}"/>
<text x="${PAD.l}" y="18" font-size="12" font-weight="600" font-family='${FONT}' fill="${c.title}">各版本安装包累计下载数</text>
<text x="${W - PAD.r}" y="18" text-anchor="end" font-size="11" font-family='${FONT}' fill="${c.sub}">${versions.length} 个版本 · 合计 ${total} 次 · GitHub API ${stamp}</text>
${grid}
${bars}
${peakNote}
${labels}
</svg>
`
}

// 配色：数据柱用**冷调蓝灰**，与项目「暖色纸感」形成冷暖对比——柱子在暖白纸上
// 比同明度的土褐柱更跳，数值一眼可读；最新版用设计系统的朱砂色（--cinnabar）
// 强调，与 UI 里的主色一致。
// **同一色相在两个主题下取不同明度阶**：浅色主题用中明度（#5b7c99，在暖白纸上
// 够深、看得清），深色主题用高明度（#7aa8c9，在近黑底上够亮、不糊）——
// 不能一套色值通吃，那是「看着能显示但读不清」的典型。
const LIGHT = { bg: '#fffdf8', title: '#211c15', sub: '#a59c89', axis: '#6c6354', grid: '#eae3d6', bar: '#5b7c99', accent: '#b5462f' }
const DARK = { bg: '#14120f', title: '#f3ede1', sub: '#8a8271', axis: '#a59c89', grid: '#2e2a24', bar: '#7aa8c9', accent: '#c9603f' }

if (!existsSync(SVG_DIR)) mkdirSync(SVG_DIR, { recursive: true })
writeFileSync(SVG_FILE, buildSvg(LIGHT), 'utf8')
writeFileSync(join(SVG_DIR, 'downloads-dark.svg'), buildSvg(DARK), 'utf8')
console.log(`[download-stats] 已写 downloads.svg与 downloads-dark.svg`)


// ── 3. 徽章与直链（shields.io 代理 GitHub API，数字自动跟随，零维护）─────
// 徽章不走本地数据而是实时取 shields.io——README 里的数字永远是最新的，
// 只有 SVG 图受限于「GitHub 不提供时间序列」才需要重跑脚本。
//
// 端点不要加 `.json` 后缀：shields.io 的 `.json` 变体返回的是 **JSON 文本**，
// 而 README 里的徽章是 `<img>` 标签，浏览器拿到 JSON 渲染不出图——表现为一排
// 破图标alt 文字（2026-09-29 实录，v0.12.1 首版就是这么挂的）。
// 不带后缀（或用 `?` 起query）才返回 image/svg+xml。
const badge = (label, url) =>
  `[![${label}](${url})](https://github.com/${REPO}/releases/tag/${latest.tag})`

const PLATFORMS = [
  { role: 'windows', badgeLabel: 'Windows', rowLabel: 'Windows x64' },
  { role: 'macos-arm64', badgeLabel: 'mac Apple Silicon', rowLabel: 'macOS Apple Silicon' },
  { role: 'macos-intel', badgeLabel: 'mac Intel', rowLabel: 'macOS Intel' },
]

const badgeRow = [
  badge(`下载 ${latest.tag}`, `https://img.shields.io/github/downloads/${REPO}/${latest.tag}/total?style=flat-square&label=%E6%80%BB%E4%B8%8B%E8%BD%BD&color=brightgreen`),
  ...PLATFORMS.map(({ role, badgeLabel }) => {
    const a = byRole(role)
    if (!a) return null
    return badge(`${badgeLabel} 下载`, `https://img.shields.io/github/downloads/${REPO}/${latest.tag}/${encodeURIComponent(a.name)}?style=flat-square&label=${encodeURIComponent(badgeLabel)}&color=blue`)
  }).filter(Boolean),
].join('\n')

const link = (role, text) => {
  const a = byRole(role)
  if (!a) return null
  return `[${text}](https://github.com/${REPO}/releases/download/${latest.tag}/${encodeURIComponent(a.name)})`
}

const block = `
<!-- download-stats:begin （由 scripts/update-download-stats.mjs 生成，勿手工编辑）-->
## 下载

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/downloads-dark.svg">
  <img alt="各版本安装包累计下载数" src="docs/images/downloads.svg">
</picture>

${badgeRow}

**v${latest.tag.replace(/^v/, '')} 直链**（未签名，macOS 需 \`xattr -cr\`，Windows 遇 SmartScreen 选「仍要运行」）：

| 平台 | 安装包 | 文件 | 大小 | 下载量 |
|---|---|---|---|---|
${PLATFORMS.map(({ role, rowLabel }) => {
  const a = byRole(role)
  if (!a) return null
  const mb = (a.size / 1048576).toFixed(0)
  return `| ${rowLabel} | ${link(role, '⬇ 下载')} | \`${a.name}\` | ${mb} MB | ${a.downloads} 次 |`
}).filter(Boolean).join('\n')}

> 图中数字是**每个版本自发布至今的累计下载数**（GitHub Releases API 的 \`asset.download_count\`，
> 只计安装包不含 blockmap），**不是按天增量**——GitHub 不提供下载量时间序列，图只能到版本粒度。
> 老版本数字高于新版本是正常的（有人从收藏的旧 release 链接取包），不代表最新版不受欢迎。

<!-- download-stats:end -->
`

// ── 4. 写回 README（幂等：整段替换，重复跑不会累积）────────────────────
const readme = readFileSync(README, 'utf8')
const BEGIN = '<!-- download-stats:begin'
const END = '<!-- download-stats:end -->'

if (checkOnly) {
  const inSync = readme.includes(BEGIN) && readme.includes(`v${latest.tag.replace(/^v/, '')} 直链`) && readme.includes('docs/images/downloads.svg')
  console.log(`[download-stats] --check: ${inSync ? 'README 与数据一致' : 'README 已漂移，需重跑脚本'}`)
  process.exit(inSync ? 0 : 1)
}

let next = readme
if (readme.includes(BEGIN)) {
  next = readme.replace(/<!-- download-stats:begin[\s\S]*?<!-- download-stats:end -->/, block.trim())
} else {
  // 首次插入：放在「下载安装包」小节之前，访客先看到数字和直链再看到安装说明
  const anchor = '## 快速开始'
  if (!next.includes(anchor)) {
    console.error('找不到锚点「## 快速开始」，终止（不写坏 README）')
    process.exit(1)
  }
  next = next.replace(anchor, block.trim() + '\n\n' + anchor)
}

if (next === readme) {
  console.log('[download-stats] README 已是最新，无需改动')
} else {
  writeFileSync(README, next, 'utf8')
  console.log(`[download-stats] 已更新 README（latest=${latest.tag}）`)
}
