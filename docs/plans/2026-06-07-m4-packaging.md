# M4 实现计划 — electron-builder 打包（mac + win，未签名）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 wx-kit 打成 macOS（dmg, arm64+x64）与 Windows（nsis, x64）未签名安装包，带品牌「宝盒」图标，本地一台 mac 上构建。

**Architecture:** electron-builder 配置驱动；图标用 playwright chromium 把 SVG 渲染成 `build/icon.png`，electron-builder 自动生成 icns/ico。无纯逻辑可 TDD——验证走"构建成功 + 真实启动打包后的 .app"。

**Tech Stack:** electron-builder、playwright（图标渲染 + 启动验证）、Electron 31。

**设计依据：** `docs/superpowers/specs/2026-06-07-m4-packaging-design.md`（未签名、本地出 mac+win、win 翻车退 CI、宝盒图标实现阶段先截图签收）。

> ⚠️ 已知陷阱：undici 必须 external 且永不加载（`vite.config.ts`）。打包正确性唯一可靠判据是 **Task 3 真实启动打包后的 .app**。

---

## File Structure

| 文件 | 改动 | 职责 |
|---|---|---|
| `scripts/make-icon.mjs` | 建（用完删） | 把 SVG 渲染成 1024 png |
| `build/icon.png` | 建（提交） | 1024 品牌图标，electron-builder 自动转 icns/ico |
| `package.json` | 改 | `build` 配置块（mac/win/nsis/icon）+ `package*` 脚本 |
| `tests/e2e/pkg-verify.mjs` | 建（用完删） | 启动打包后的 mac `.app`，断言窗口能开 |
| `README.md` | 建 | 项目说明 + 「下载与安装」放行步骤 |
| `.github/workflows/build.yml` | 建（仅 win 本机翻车时） | CI 出 win 包 |
| `ROADMAP.md` / devlog | 改 | 标记 M4 完成 |

---

## Task 1: 生成「宝盒」品牌图标

**Files:**
- Create: `scripts/make-icon.mjs`（用完删）
- Create: `build/icon.png`（提交）

> 图标是产品的脸。本任务先渲染，**截图给安哥过目、按反馈迭代**，满意后才提交 png。

- [ ] **Step 1: 确保 chromium 可用（图标渲染需要）**

Run: `npx playwright install chromium`
Expected: 已安装或下载完成，无报错。

- [ ] **Step 2: 写渲染脚本 `scripts/make-icon.mjs`（含宝盒 SVG 初稿）**

```js
// scripts/make-icon.mjs — 渲染宝盒 SVG → build/icon.png。用完删（icon.png 提交保证可复现）。
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = `
<svg id="icon" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c2543a"/><stop offset="1" stop-color="#a83e29"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2dca0"/><stop offset="1" stop-color="#d4af6a"/></linearGradient>
    <linearGradient id="lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e6b6"/><stop offset="1" stop-color="#e3c581"/></linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff0cf" stop-opacity="1"/><stop offset="1" stop-color="#fff0cf" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="196" fill="url(#tile)"/>
  <ellipse cx="512" cy="455" rx="250" ry="160" fill="url(#glow)"/>
  <g fill="#fff4d8"><circle cx="402" cy="372" r="10"/><circle cx="628" cy="350" r="13"/><circle cx="520" cy="312" r="8"/><circle cx="470" cy="300" r="5"/></g>
  <rect x="296" y="486" width="432" height="250" rx="26" fill="url(#gold)" stroke="#7c3a23" stroke-width="10"/>
  <rect x="372" y="486" width="34" height="250" fill="#7c3a23" opacity="0.85"/>
  <rect x="618" y="486" width="34" height="250" fill="#7c3a23" opacity="0.85"/>
  <rect x="476" y="556" width="72" height="92" rx="12" fill="#7c3a23"/>
  <circle cx="512" cy="598" r="14" fill="#f2dca0"/>
  <g transform="rotate(-9 512 478)">
    <path d="M300 478 q212 -150 424 0 l0 34 q-212 -122 -424 0 z" fill="url(#lid)" stroke="#7c3a23" stroke-width="10"/>
    <rect x="296" y="460" width="432" height="34" rx="16" fill="url(#gold)" stroke="#7c3a23" stroke-width="10"/>
  </g>
</svg>`

mkdirSync(join(root, 'build'), { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`)
await page.locator('#icon').screenshot({ path: join(root, 'build', 'icon.png'), omitBackground: true })
await browser.close()
console.log('wrote build/icon.png')
```

- [ ] **Step 3: 渲染并查看**

Run: `node scripts/make-icon.mjs`
Expected: `wrote build/icon.png`。然后 Read `build/icon.png` 自检，并**把图给安哥看**。

- [ ] **Step 4: 按安哥反馈迭代**

若安哥要调（箱体造型/配色/开合/星火/朱砂深浅），改 Step 2 的 SVG，重跑 Step 3，再给看。**循环直到安哥满意。** 不满意不进下一步。

- [ ] **Step 5: 删脚本、提交图标**

```bash
rm scripts/make-icon.mjs
rmdir scripts 2>/dev/null || true
git add build/icon.png
git commit -m "feat(m4): brand treasure-box app icon (1024 png)"
```

---

## Task 2: electron-builder 配置 + 打包脚本

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 替换 `build` 块**

把 package.json 的 `"build": { ... }` 整块替换为：

```json
  "build": {
    "appId": "com.wxkit.app",
    "productName": "wx-kit",
    "directories": { "output": "release", "buildResources": "build" },
    "files": ["dist-electron/**/*", "dist/**/*"],
    "mac": {
      "target": [{ "target": "dmg", "arch": ["arm64", "x64"] }],
      "category": "public.app-category.productivity",
      "icon": "build/icon.png"
    },
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "icon": "build/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
```

- [ ] **Step 2: 改/加 `scripts`**

把 `"build"` 脚本与新增打包脚本设为（去掉会挂的 `tsc -b`，类型检查独立走）：

```json
    "build": "vite build && electron-builder",
    "package": "vite build && electron-builder --mac --win",
    "package:mac": "vite build && electron-builder --mac",
    "package:win": "vite build && electron-builder --win",
```

- [ ] **Step 3: JSON 合法性检查**

Run: `node -e "require('./package.json'); console.log('package.json OK')"`
Expected: `package.json OK`。

- [ ] **Step 4: 提交**

```bash
git add package.json
git commit -m "build(m4): electron-builder config (mac dmg arm64+x64, win nsis x64) + package scripts"
```

---

## Task 3: 出 mac 包 + 真实启动验证（覆盖 undici 打包风险）

**Files:**
- Create: `tests/e2e/pkg-verify.mjs`（用完删）

- [ ] **Step 1: 构建 mac 包**

Run: `npm run package:mac`
Expected: electron-builder 成功；`release/` 下出现 `wx-kit-0.1.0-arm64.dmg`、`wx-kit-0.1.0-x64.dmg`，以及解包目录 `release/mac-arm64/wx-kit.app`（arm64）。
若报错（如 icon 转换失败），记录并修（多半是 `build/icon.png` 尺寸/路径问题）。

- [ ] **Step 2: 写启动验证脚本 `tests/e2e/pkg-verify.mjs`**

```js
// tests/e2e/pkg-verify.mjs — 启动打包后的 mac .app，断言窗口能开（验证 undici 打包正确）。用完删。
import { _electron as electron } from 'playwright'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const appBin = join(root, 'release', 'mac-arm64', 'wx-kit.app', 'Contents', 'MacOS', 'wx-kit')

async function main() {
  if (!existsSync(appBin)) { console.error('[pkg] packaged app not found:', appBin); process.exit(1) }
  const errors = []
  const app = await electron.launch({ executablePath: appBin })
  const win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  let ok = true
  try {
    await win.waitForSelector('[data-testid="app-shell"]', { timeout: 25000 })
    console.error('[pkg] ✓ packaged app launched and rendered the shell')
    await new Promise((r) => setTimeout(r, 1500))
    if (errors.length) { ok = false; console.error('[pkg] ✗ console/page errors:', errors.slice(0, 3)) }
    else console.error('[pkg] ✓ no console/page errors (undici not loaded at startup)')
  } catch (e) {
    ok = false; console.error('[pkg] ✗ launch/render failed:', e.message, errors.slice(0, 3))
  } finally {
    await app.close().catch(() => {})
  }
  console.error(ok ? '[pkg] ALL PASSED' : '[pkg] FAILED')
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error('[pkg] crashed:', e); process.exit(1) })
```

- [ ] **Step 3: 跑启动验证**

Run: `node tests/e2e/pkg-verify.mjs`
Expected: `[pkg] ✓ packaged app launched and rendered the shell`、`[pkg] ✓ no console/page errors`、`[pkg] ALL PASSED`。

**GATE：** 若主进程崩溃或报 `node:sqlite`/undici 相关错 → undici 没被正确 external 或被打进了启动路径，回查 `vite.config.ts` 与 electron-builder 的 asar 处理，修好再继续。

- [ ] **Step 4: 删脚本、提交**

```bash
rm tests/e2e/pkg-verify.mjs
git add -A && git commit -m "build(m4): verify packaged mac app launches cleanly (undici external holds)"
```

---

## Task 4: 出 win 包 + 验证产物（翻车退 CI）

**Files:**
- Create（仅本机构建失败时）: `.github/workflows/build.yml`

- [ ] **Step 1: 构建 win 包**

Run: `npm run package:win`
Expected: electron-builder 成功；`release/` 下出现 `wx-kit Setup 0.1.0.exe`（nsis）。

- [ ] **Step 2: 验证产物存在**

Run: `ls -lh release/*.exe`
Expected: 列出 `.exe` 文件（非空）。mac 上无法运行 win 程序，验证到"构建成功 + 产物存在"为止。

- [ ] **Step 3:（仅当 Step 1 在本机翻车）加 CI 兜底**

若 `package:win` 因 wine/图标转换等在本机失败，建 `.github/workflows/build.yml`：

```yaml
name: build
on:
  workflow_dispatch:
  push:
    tags: ['v*']
jobs:
  win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run package:win
      - uses: actions/upload-artifact@v4
        with: { name: wx-kit-win, path: release/*.exe }
```

并在 README 注明 win 包由 CI 产出（需安哥 push 到 GitHub 后在 Actions 触发）。

- [ ] **Step 4: 提交**

```bash
# 本机成功出 win：无新增源文件（产物 release/ 已 gitignore），跳过 commit，仅在 Task 5 记录
# 本机失败、加了 CI：
git add .github/workflows/build.yml 2>/dev/null && git commit -m "build(m4): CI workflow to build win installer (win-from-mac fallback)" || echo "win built locally, no CI needed"
```

---

## Task 5: README 安装说明 + 收尾

**Files:**
- Create: `README.md`
- Modify: `ROADMAP.md`、`docs/devlog/wx-kit-vibe-coding.md`

- [ ] **Step 1: 写 `README.md`**

```markdown
# wx-kit · 微信百宝箱

把微信公众号文章下载为多种格式（封面 / Markdown / 网页 / PDF / 元信息）并在应用内浏览；
支持按公众号批量爬取；同一二进制带 CLI，供 AI agent 调用。单进程 Electron，GUI 与 CLI 双启动模式。

## 下载与安装

当前为**未签名**构建，首次打开需手动放行（应用本身可信）：

- **macOS**：打开 `.dmg` 拖入「应用程序」。首次启动若提示「无法验证开发者」——
  右键应用 →「打开」→ 再次「打开」；或终端执行 `xattr -cr /Applications/wx-kit.app` 后再开。
- **Windows**：运行 `wx-kit Setup *.exe`。SmartScreen 提示 →「更多信息」→「仍要运行」。

## 开发

见 `AGENTS.md`（项目权威指南）与 `ROADMAP.md`（进度）。常用命令：

\`\`\`bash
npm install
npm run dev          # GUI 开发模式
npm test             # 单测
npm run package:mac  # 打 mac 安装包（release/）
npm run package:win  # 打 win 安装包
\`\`\`
```

> 注：上面代码块的反引号在落地时写成正常的 ```（此处转义仅为在计划里展示）。

- [ ] **Step 2: 更新状态文档**

- `ROADMAP.md`：M4 行状态改 `✅ 已合入 main`；当前状态补一句「已出未签名 mac(dmg arm64+x64) + win(nsis x64) 安装包，品牌宝盒图标，打包后真实启动验证通过」。
- `docs/devlog/wx-kit-vibe-coding.md`：按工作流第 6 条增补 M4 一节（未签名取舍、undici external 在打包后靠真实启动证明、宝盒图标先截图签收再定、win-from-mac 与 CI 兜底）。

- [ ] **Step 3: 全量回归（确认打包改动没破坏开发流）**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run lint`
Expected: tsc 无输出、vitest 全绿、lint 0 error。

- [ ] **Step 4: 提交**

```bash
git add README.md ROADMAP.md docs/devlog/wx-kit-vibe-coding.md
git commit -m "docs(m4): README install guide; mark M4 done in ROADMAP + devlog"
```

---

## 验收对照（self-review 已核）

- 未签名 mac(dmg arm64+x64) + win(nsis x64) → Task 2 配置、Task 3/4 出包。
- 宝盒图标，先截图签收 → Task 1。
- undici 打包正确性 → Task 3 真实启动验证。
- nsis 非一键、可选目录 → Task 2 `nsis` 配置。
- 安装放行说明 → Task 5 README。
- win 翻车退 CI → Task 4 Step 3。
- 非目标（签名/自动更新/Linux）不在计划内。
```
