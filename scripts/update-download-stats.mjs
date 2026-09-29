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
const W = 900, H = 300
const PAD = { t: 30, r: 16, b: 46, l: 44 }
const plotW = W - PAD.l - PAD.r
const plotH = H - PAD.t - PAD.b
const maxN = Math.max(...versions.map(v => v.count))
const niceMax = Math.max(10, Math.ceil(maxN / 20) * 20)
const slot = plotW / versions.length
const barW = Math.max(4, slot * 0.66)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const y = (n) => PAD.t + plotH - (n / niceMax) * plotH

// 纵轴刻度与网格
let grid = ''
const ticks = 4
for (let i = 0; i <= ticks; i++) {
  const v = (niceMax / ticks) * i
  const yy = y(v)
  grid += `<line x1="${PAD.l}" y1="${yy.toFixed(1)}" x2="${W - PAD.r}" y2="${yy.toFixed(1)}" stroke="currentColor" stroke-opacity="0.12" stroke-width="1"/>`
  grid += `<text class="ax" x="${PAD.l - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`
}

// 柱：最新一版用朱砂色（呼应项目设计系统的主强调色），其余用弱化墨色
let bars = ''
versions.forEach((v, i) => {
  const x = PAD.l + i * slot + (slot - barW) / 2
  const h = Math.max(v.count > 0 ? 2 : 0, (v.count / niceMax) * plotH)
  const isLatest = v.tag === latest.tag
  bars += `<g class="bar${isLatest ? ' latest' : ''}"><rect x="${x.toFixed(1)}" y="${(PAD.t + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/></g>`
})

// 横轴标签：30 个版本全标会糊，稀疏标注（每 3 个）+ 最新版必标
let labels = ''
versions.forEach((v, i) => {
  const isLatest = v.tag === latest.tag
  if (!isLatest && i % 3 !== 0 && i !== versions.length - 2) return
  const x = PAD.l + i * slot + slot / 2
  const short = v.tag.replace(/^v0\./, '').replace(/^v/, '')
  labels += `<text class="lb" x="${x.toFixed(1)}" y="${H - PAD.b + 17}" text-anchor="middle"${isLatest ? ' class="lb latest"' : ''}>${esc(isLatest ? v.tag : short)}</text>`
})

// 峰值标注（v0.8.5 = 82），给图一个「有故事」的锚点
const peak = versions.reduce((a, b) => b.count > a.count ? b : a)
const peakIdx = versions.indexOf(peak)
let peakNote = ''
if (peak.count > 0) {
  const px = PAD.l + peakIdx * slot + slot / 2
  peakNote = `<text class="peak" x="${px.toFixed(1)}" y="${(y(peak.count) - 7).toFixed(1)}" text-anchor="middle">${peak.count}</text>`
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="dlTitle dlDesc">
<title id="dlTitle">wx-kit 各版本 GitHub 安装包累计下载数</title>
<desc id="dlDesc">共 ${versions.length} 个已发布版本，合计 ${total} 次下载。数据来自 GitHub Releases API 的 asset.download_count（安装包资产，不含 blockmap），统计时间 ${new Date().toISOString().slice(0, 10)}。该数字是每个版本发布至今的累计值，不是按天增量，GitHub 不提供时间序列。</desc>
<style>
  .bg{fill:#fffdf8}
  .ax,.lb{font:11px ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;fill:#6c6354}
  .peak{font:600 11px ui-sans-serif,sans-serif;fill:#b5462f}
  .bar rect{fill:#c9c0ae}
  .bar.latest rect{fill:#b5462f}
  .ttl{font:600 12px ui-sans-serif,sans-serif;fill:#211c15}
  .sub{font:11px ui-sans-serif,sans-serif;fill:#a59c89}
  @media (prefers-color-scheme: dark){
    .bg{fill:#1a1815}
    .ax,.lb{fill:#a59c89}
    .peak{fill:#e08a70}
    .bar rect{fill:#4a443a}
    .bar.latest rect{fill:#c9603f}
    .ttl{fill:#f3ede1}
    .sub{fill:#88806f}
  }
</style>
<rect class="bg" width="${W}" height="${H}" rx="8"/>
<text class="ttl" x="${PAD.l}" y="18">各版本安装包累计下载数</text>
<text class="sub" x="${W - PAD.r}" y="18" text-anchor="end">${versions.length} 个版本 · 合计 ${total} 次 · GitHub API ${new Date().toISOString().slice(0, 10)}</text>
${grid}
${bars}
${peakNote}
${labels}
</svg>
`

if (!existsSync(SVG_DIR)) mkdirSync(SVG_DIR, { recursive: true })
writeFileSync(SVG_FILE, svg, 'utf8')
console.log(`[download-stats] 已写 ${SVG_FILE.replace(ROOT + '/', '')}`)

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

![各版本安装包累计下载数](docs/images/downloads.svg)

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
