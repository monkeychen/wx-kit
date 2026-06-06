# wx-kit M1：核心层 + URL 下载（CLI 优先）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好 wx-kit 工程骨架，实现与界面无关的核心层，让 `wx-kit download <url...>` 能把一个或多个微信文章 URL 下载为 cover/md/html/pdf/meta 五种格式，并维护本地文章库索引。

**Architecture:** 单进程 Electron 二进制，双启动模式（GUI / CLI）。本里程碑只做 CLI 入口与 GUI 占位窗口。所有业务逻辑放在 UI 无关的 `src/core/`，纯逻辑单元用 vitest 做 TDD，依赖网络与 Electron（printToPDF）的部分用注入 + 手动验证。

**Tech Stack:** Electron + TypeScript + Vite + electron-builder；axios（抓取）、cheerio（解析）、turndown（HTML→MD）；commander（CLI）；vitest（测试）。

**Scope:** 本计划仅覆盖 PRD 的 M1。M2（GUI URL 下载 + 文章库 + 阅读器）、M3（登录 + 公众号批量）、M4（打包跨平台）各自单独出计划。本计划完成后可交付：命令行下载文章、五种格式落盘、库索引可查。

> 本计划假定执行者熟悉 TS 但不了解本项目与微信文章结构。每步给出确切路径、完整代码、运行命令与期望输出。原则：DRY、YAGNI、TDD、频繁提交。

---

## 文件结构（先锁定边界）

```
wx-kit/
├─ CLAUDE.md                      # 项目约定（结构/命名/测试/提交）
├─ package.json
├─ tsconfig.json
├─ tsconfig.node.json
├─ vite.config.ts                 # vite + vite-plugin-electron
├─ vitest.config.ts
├─ .gitignore
├─ index.html                     # GUI 渲染入口（M1 占位）
├─ electron/
│  ├─ main.ts                     # 入口：分流 GUI / CLI 模式
│  └─ preload.ts                  # 占位（M2 用）
├─ src/
│  ├─ core/                       # ★ UI 无关核心层（被 CLI 与 GUI 共享）
│  │  ├─ types.ts                 # 共享类型
│  │  ├─ paths.ts                 # 文件名/路径清洗
│  │  ├─ article-id.ts            # 去重唯一标识
│  │  ├─ parse-article.ts         # 纯函数：HTML → ParsedArticle
│  │  ├─ fetch-html.ts            # 网络适配器：URL → HTML 字符串
│  │  ├─ image-localizer.ts       # 图片本地化（下载注入）
│  │  ├─ exporter/
│  │  │  ├─ export-meta.ts        # meta.json
│  │  │  ├─ export-markdown.ts    # content.md
│  │  │  ├─ export-html.ts        # index.html（自包含）
│  │  │  ├─ export-cover.ts       # cover.<ext>
│  │  │  ├─ export-pdf.ts         # content.pdf（Electron printToPDF）
│  │  │  └─ index.ts              # 按所选格式编排导出
│  │  ├─ library.ts               # library.json 索引 CRUD/搜索
│  │  └─ download-queue.ts        # 串行队列 + 进度事件 + 去重 + 失败隔离
│  ├─ cli/
│  │  └─ index.ts                 # commander 命令解析 + JSON 输出
│  └─ renderer/                   # React（M1 仅占位 Hello）
│     ├─ main.tsx
│     └─ App.tsx
└─ tests/
   ├─ fixtures/
   │  └─ sample-article.html      # 微信文章 HTML 样本（脱敏）
   └─ core/                       # 与 src/core 镜像的单测
```

边界原则：`parse-article` 纯函数（无 IO，可测）；`fetch-html`/`image-localizer` 把网络隔离成薄适配器；`export-pdf` 是唯一依赖 Electron 的导出器；`download-queue` 是唯一进度来源。

---

### Task 1: 工程骨架与约定

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `index.html`, `CLAUDE.md`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `electron/preload.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "wx-kit",
  "private": true,
  "version": "0.1.0",
  "description": "微信百宝箱 - 第一阶段：文章下载器",
  "main": "dist-electron/main.js",
  "type": "commonjs",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build && electron-builder",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "cli": "electron . "
  },
  "dependencies": {
    "axios": "^1.7.0",
    "cheerio": "^1.0.0",
    "commander": "^12.1.0",
    "turndown": "^7.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/turndown": "^5.0.5",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^31.0.0",
    "electron-builder": "^24.13.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vite-plugin-electron": "^0.28.0",
    "vite-plugin-electron-renderer": "^0.14.6",
    "vitest": "^2.0.0"
  },
  "build": {
    "appId": "com.wxkit.app",
    "productName": "wx-kit",
    "directories": { "output": "release" },
    "files": ["dist-electron/**/*", "dist/**/*"]
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npm install`
Expected: 安装成功，生成 `node_modules/` 与 `package-lock.json`，无 ERR。

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"],
    "outDir": "dist-tsc",
    "noEmit": true
  },
  "include": ["src", "electron", "tests"]
}
```

- [ ] **Step 4: 创建 tsconfig.node.json**（electron-builder/tsc -b 用）

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "CommonJS",
    "moduleResolution": "Node",
    "target": "ES2022",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist-electron"
  },
  "include": ["electron", "src/core", "src/cli"]
}
```

- [ ] **Step 5: 创建 vite.config.ts**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    electron([
      { entry: 'electron/main.ts' },
      { entry: 'electron/preload.ts', onstart(o) { o.reload() } },
    ]),
    renderer(),
  ],
  build: { outDir: 'dist' },
})
```

- [ ] **Step 6: 创建 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 7: 创建 index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>wx-kit</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: 创建 React 占位（M1 不做 UI）**

`src/renderer/App.tsx`:
```tsx
export default function App() {
  return <div style={{ padding: 24, fontFamily: 'system-ui' }}>wx-kit · 微信百宝箱（M1 占位界面）</div>
}
```

`src/renderer/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 9: 创建 electron/preload.ts 占位**

```ts
// M2 将通过 contextBridge 暴露 IPC，本阶段占位
export {}
```

- [ ] **Step 10: 创建 .gitignore**

```
node_modules
dist
dist-electron
dist-tsc
release
*.log
.DS_Store
```

- [ ] **Step 11: 创建 CLAUDE.md（约束先行）**

```markdown
# wx-kit 项目约定

## 是什么
微信百宝箱桌面应用。第一阶段只做"文章下载器"。单进程 Electron，双启动模式：GUI 与 CLI。

## 结构约定
- `src/core/`：UI 无关核心层，被 GUI（IPC）与 CLI 共享。不得 import React/renderer。
- `electron/`：主进程，仅做模式分流与平台能力（窗口、printToPDF）。
- `src/cli/`：命令行入口，输出契约见 PRD §F4（stdout 纯 JSON，stderr 进度，退出码）。
- `src/renderer/`：React 界面（M2 起）。
- `tests/`：镜像 `src/core/` 的 vitest 单测；HTML 样本放 `tests/fixtures/`。

## 命名/格式
- 文件 kebab-case，类型 PascalCase，函数/变量 camelCase。
- 注释、commit message 用英文；与用户沟通用中文。

## 开发纪律
- 纯逻辑一律 TDD；依赖网络/Electron 的部分注入依赖 + 手动验证。
- 改完跑 `npm test` 与 `npm run lint`。
- 不为跑通而注释报错，找根因。密钥不进代码。

## 关键约束
- 微信后台接口有频控：批量抓取默认串行 + 随机延迟（见 PRD §9）。
- 文章库默认在用户文档目录下，可配置。
```

- [ ] **Step 12: 验证骨架可构建**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npx tsc --noEmit -p tsconfig.json`
Expected: 无类型错误（占位文件能通过编译）。

- [ ] **Step 13: 提交**

```bash
cd /Users/chenzhian/workspace/ai/wx-kit
git add -A
git commit -m "chore: scaffold wx-kit electron+vite+ts project with conventions"
```

---

### Task 2: 共享类型

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: 定义核心类型**

```ts
// src/core/types.ts
export type DownloadFormat = 'cover' | 'md' | 'html' | 'pdf' | 'meta'

export const ALL_FORMATS: DownloadFormat[] = ['cover', 'md', 'html', 'pdf', 'meta']

/** 解析微信文章页得到的结构（纯解析产物，未落盘） */
export interface ParsedArticle {
  title: string
  author: string        // 作者署名
  account: string       // 公众号名（用于建目录）
  publishTime: string   // 原始可读时间，解析不到则空串
  digest: string        // 摘要
  coverUrl: string      // 封面图 URL，解析不到则空串
  contentHtml: string   // 清洗后的正文 HTML
  imageUrls: string[]   // 正文中出现的图片 URL（去重、按出现顺序）
}

/** 落盘后一篇文章的元信息，存入 library.json */
export interface ArticleMeta {
  id: string                  // 去重唯一标识
  title: string
  author: string
  account: string
  publishTime: string
  sourceUrl: string
  digest: string
  coverUrl: string
  downloadTime: string        // ISO 8601
  formats: DownloadFormat[]   // 实际生成的格式
  dir: string                 // 文章文件夹绝对路径
}

export type ProgressPhase = 'fetch' | 'images' | 'export' | 'save' | 'done' | 'failed'

export interface ProgressEvent {
  total: number
  completed: number
  currentUrl: string
  currentTitle?: string
  phase: ProgressPhase
  message?: string
}

export interface DownloadItemResult {
  url: string
  ok: boolean
  id?: string
  dir?: string
  formats?: DownloadFormat[]
  skipped?: boolean           // 命中去重被跳过
  error?: { code: string; message: string }
}

export interface DownloadSummary {
  ok: boolean                 // 全部非失败即 true（含 skipped）
  total: number
  succeeded: number
  failed: number
  skipped: number
  items: DownloadItemResult[]
}
```

- [ ] **Step 2: 编译校验**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/core/types.ts && git commit -m "feat(core): add shared types"
```

---

### Task 3: 文件名/路径清洗（TDD）

**Files:**
- Create: `src/core/paths.ts`, `tests/core/paths.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/paths.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeName, articleDirName, dedupeDirName } from '../../src/core/paths'

describe('sanitizeName', () => {
  it('removes filesystem-illegal characters', () => {
    expect(sanitizeName('a/b:c*d?e"f<g>h|i\\j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })
  it('collapses whitespace and trims', () => {
    expect(sanitizeName('  hello   world  ')).toBe('hello world')
  })
  it('truncates very long names to 80 chars', () => {
    expect(sanitizeName('x'.repeat(200)).length).toBe(80)
  })
  it('falls back to "untitled" for empty', () => {
    expect(sanitizeName('   ')).toBe('untitled')
  })
})

describe('articleDirName', () => {
  it('combines date prefix and sanitized title', () => {
    expect(articleDirName('2026-02-25', '深度/长文')).toBe('2026-02-25_深度_长文')
  })
  it('omits prefix when date empty', () => {
    expect(articleDirName('', '标题')).toBe('标题')
  })
})

describe('dedupeDirName', () => {
  it('returns base when not taken', () => {
    expect(dedupeDirName('foo', () => false)).toBe('foo')
  })
  it('appends -2, -3 until free', () => {
    const taken = new Set(['foo', 'foo-2'])
    expect(dedupeDirName('foo', n => taken.has(n))).toBe('foo-3')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npx vitest run tests/core/paths.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/core/paths.ts
const ILLEGAL = /[/\\:*?"<>|]/g

export function sanitizeName(raw: string): string {
  let s = (raw ?? '').replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim()
  if (!s) return 'untitled'
  if (s.length > 80) s = s.slice(0, 80)
  return s
}

export function articleDirName(publishDate: string, title: string): string {
  const t = sanitizeName(title)
  const d = (publishDate ?? '').trim()
  return d ? `${d}_${t}` : t
}

/** 给定基名与"是否已占用"判定，返回未占用的名字（base, base-2, base-3 ...） */
export function dedupeDirName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base
  let i = 2
  while (taken(`${base}-${i}`)) i++
  return `${base}-${i}`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npx vitest run tests/core/paths.test.ts`
Expected: PASS（4+2+2 用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/core/paths.ts tests/core/paths.test.ts
git commit -m "feat(core): add filesystem name sanitization and dedupe"
```

---

### Task 4: 文章去重标识（TDD）

**Files:**
- Create: `src/core/article-id.ts`, `tests/core/article-id.test.ts`

- [ ] **Step 1: 写失败测试**

微信文章 URL 形如 `https://mp.weixin.qq.com/s?__biz=XXX&mid=123&idx=1&sn=abcdef&chksm=...&scene=...`。`mid+idx+sn` 唯一定位一篇；缺失时回退到归一化 URL 的哈希。

```ts
// tests/core/article-id.test.ts
import { describe, it, expect } from 'vitest'
import { articleId } from '../../src/core/article-id'

describe('articleId', () => {
  it('uses mid/idx/sn when present', () => {
    const url = 'https://mp.weixin.qq.com/s?__biz=AA&mid=2247483&idx=1&sn=abc123&chksm=zz&scene=27'
    expect(articleId(url)).toBe('2247483_1_abc123')
  })
  it('is stable regardless of volatile params order/extra', () => {
    const a = articleId('https://mp.weixin.qq.com/s?mid=1&idx=2&sn=x&scene=1')
    const b = articleId('https://mp.weixin.qq.com/s?scene=99&sn=x&idx=2&mid=1&key=zzz')
    expect(a).toBe(b)
  })
  it('falls back to hash for short-link style urls', () => {
    const id = articleId('https://mp.weixin.qq.com/s/AbCdEfGhIjK')
    expect(id).toMatch(/^h_[0-9a-f]{16}$/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/article-id.test.ts`（前缀 `cd /Users/chenzhian/workspace/ai/wx-kit &&`）
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/core/article-id.ts
import { createHash } from 'node:crypto'

export function articleId(rawUrl: string): string {
  let u: URL
  try { u = new URL(rawUrl) } catch { return `h_${createHash('sha1').update(rawUrl).digest('hex').slice(0, 16)}` }

  const mid = u.searchParams.get('mid')
  const idx = u.searchParams.get('idx')
  const sn = u.searchParams.get('sn')
  if (mid && idx && sn) return `${mid}_${idx}_${sn}`

  // 回退：归一化（origin + pathname），忽略所有易变 query
  const normalized = `${u.origin}${u.pathname}`
  return `h_${createHash('sha1').update(normalized).digest('hex').slice(0, 16)}`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/article-id.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/article-id.ts tests/core/article-id.test.ts
git commit -m "feat(core): add stable article dedupe id"
```

---

### Task 5: 文章 HTML 解析（TDD，纯函数）

**Files:**
- Create: `src/core/parse-article.ts`, `tests/core/parse-article.test.ts`, `tests/fixtures/sample-article.html`

- [ ] **Step 1: 准备脱敏 HTML 样本**

`tests/fixtures/sample-article.html`（微信文章页的关键结构子集）:
```html
<!doctype html><html><head>
  <meta property="og:title" content="测试标题：第一性原理" />
  <meta property="og:description" content="这是摘要内容" />
  <meta property="og:image" content="https://mmbiz.qpic.cn/cover_123" />
</head><body>
  <h1 class="rich_media_title" id="activity-name">测试标题：第一性原理</h1>
  <span class="rich_media_meta_nickname" id="js_name">测试公众号</span>
  <em id="publish_time" class="rich_media_meta_text">2026-02-25 08:00</em>
  <div class="rich_media_content" id="js_content">
    <p>第一段正文。</p>
    <p><img data-src="https://mmbiz.qpic.cn/img_a" /></p>
    <p>第二段正文。</p>
    <p><img data-src="https://mmbiz.qpic.cn/img_b" /></p>
    <p><img data-src="https://mmbiz.qpic.cn/img_a" /></p>
  </div>
</body></html>
```

- [ ] **Step 2: 写失败测试**

```ts
// tests/core/parse-article.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArticle } from '../../src/core/parse-article'

const html = readFileSync(join(__dirname, '../fixtures/sample-article.html'), 'utf-8')

describe('parseArticle', () => {
  const a = parseArticle(html, 'https://mp.weixin.qq.com/s?mid=1&idx=1&sn=x')

  it('extracts title', () => expect(a.title).toBe('测试标题：第一性原理'))
  it('extracts account', () => expect(a.account).toBe('测试公众号'))
  it('extracts publish time', () => expect(a.publishTime).toBe('2026-02-25 08:00'))
  it('extracts digest', () => expect(a.digest).toBe('这是摘要内容'))
  it('extracts cover url', () => expect(a.coverUrl).toBe('https://mmbiz.qpic.cn/cover_123'))
  it('collects unique image urls in order from data-src', () => {
    expect(a.imageUrls).toEqual(['https://mmbiz.qpic.cn/img_a', 'https://mmbiz.qpic.cn/img_b'])
  })
  it('keeps content html non-empty', () => expect(a.contentHtml).toContain('第一段正文'))
})
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/core/parse-article.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现**

```ts
// src/core/parse-article.ts
import * as cheerio from 'cheerio'
import type { ParsedArticle } from './types'

function meta($: cheerio.CheerioAPI, prop: string): string {
  return $(`meta[property="${prop}"]`).attr('content')?.trim() ?? ''
}

export function parseArticle(html: string, _sourceUrl: string): ParsedArticle {
  const $ = cheerio.load(html)

  const title = ($('#activity-name').text().trim() || meta($, 'og:title')) ?? ''
  const account = $('#js_name').text().trim()
  const publishTime = $('#publish_time').text().trim()
  const digest = meta($, 'og:description')
  const coverUrl = meta($, 'og:image')

  const $content = $('#js_content')
  // 微信图片真实地址在 data-src
  const imageUrls: string[] = []
  $content.find('img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src')
    if (src && !imageUrls.includes(src)) imageUrls.push(src)
  })

  return {
    title,
    author: account,
    account,
    publishTime,
    digest,
    coverUrl,
    contentHtml: $content.html() ?? '',
    imageUrls,
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/core/parse-article.test.ts`
Expected: PASS（7 用例全绿）。

- [ ] **Step 6: 提交**

```bash
git add src/core/parse-article.ts tests/core/parse-article.test.ts tests/fixtures/sample-article.html
git commit -m "feat(core): parse wechat article html into structured data"
```

---

### Task 6: 网络抓取适配器（薄适配器 + 手动验证）

**Files:**
- Create: `src/core/fetch-html.ts`

- [ ] **Step 1: 实现**

```ts
// src/core/fetch-html.ts
import axios from 'axios'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export async function fetchHtml(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    timeout: 20000,
    responseType: 'text',
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  })
  return res.data
}

/** 下载二进制资源（图片/封面），返回 buffer 与内容类型 */
export async function fetchBinary(url: string): Promise<{ data: Buffer; contentType: string }> {
  const res = await axios.get<ArrayBuffer>(url, {
    timeout: 20000,
    responseType: 'arraybuffer',
    headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/' },
  })
  return { data: Buffer.from(res.data), contentType: String(res.headers['content-type'] ?? '') }
}
```

- [ ] **Step 2: 手动验证（需联网，挑一篇真实公开文章）**

Run（替换为任意真实微信文章 URL）:
```bash
cd /Users/chenzhian/workspace/ai/wx-kit
node --input-type=module -e "import('./src/core/fetch-html.ts').catch(()=>{}); " 2>/dev/null || \
npx tsx -e "import {fetchHtml} from './src/core/fetch-html'; fetchHtml(process.argv[1]).then(h=>console.log('len=',h.length)).catch(e=>{console.error(e.message);process.exit(1)})" "https://mp.weixin.qq.com/s/REAL_ARTICLE"
```
Expected: 打印 `len= <较大数字>`（页面 HTML 长度）。若环境无 tsx，可在 Task 15 的 CLI 联调中一并验证。

> 说明：本步是适配器，无单测；其正确性在 Task 15 端到端验证中覆盖。

- [ ] **Step 3: 提交**

```bash
git add src/core/fetch-html.ts && git commit -m "feat(core): add html/binary fetch adapter"
```

---

### Task 7: 图片本地化（TDD，下载注入）

把正文 HTML 里的远程图片 URL 映射成本地 `images/` 路径并改写引用。下载动作通过参数注入，便于测试。

**Files:**
- Create: `src/core/image-localizer.ts`, `tests/core/image-localizer.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/image-localizer.test.ts
import { describe, it, expect } from 'vitest'
import { buildImageMap, rewriteImageRefs } from '../../src/core/image-localizer'

describe('buildImageMap', () => {
  it('maps each url to images/img-N.<ext> by content type', () => {
    const map = buildImageMap(
      ['https://x/a', 'https://x/b'],
      url => (url.endsWith('a') ? 'image/jpeg' : 'image/png'),
    )
    expect(map.get('https://x/a')).toBe('images/img-1.jpg')
    expect(map.get('https://x/b')).toBe('images/img-2.png')
  })
})

describe('rewriteImageRefs', () => {
  it('rewrites data-src and src to local relative paths', () => {
    const map = new Map([['https://x/a', 'images/img-1.jpg']])
    const html = '<p><img data-src="https://x/a" src="placeholder.gif" /></p>'
    const out = rewriteImageRefs(html, map)
    expect(out).toContain('src="images/img-1.jpg"')
    expect(out).not.toContain('https://x/a')
    expect(out).not.toContain('placeholder.gif')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/image-localizer.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/core/image-localizer.ts
import * as cheerio from 'cheerio'

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
}

function extFromType(t: string): string {
  return EXT_BY_TYPE[t.split(';')[0].trim().toLowerCase()] ?? 'jpg'
}

/** 给定图片 URL 列表与"取内容类型"函数，产出 url -> 本地相对路径 的映射 */
export function buildImageMap(urls: string[], typeOf: (url: string) => string): Map<string, string> {
  const map = new Map<string, string>()
  urls.forEach((url, i) => {
    map.set(url, `images/img-${i + 1}.${extFromType(typeOf(url))}`)
  })
  return map
}

/** 把正文 HTML 中的 data-src/src 改写为本地相对路径 */
export function rewriteImageRefs(contentHtml: string, map: Map<string, string>): string {
  const $ = cheerio.load(contentHtml, null, false)
  $('img').each((_, el) => {
    const orig = $(el).attr('data-src') || $(el).attr('src')
    const local = orig ? map.get(orig) : undefined
    if (local) {
      $(el).attr('src', local)
      $(el).removeAttr('data-src')
    }
  })
  return $.html()
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/image-localizer.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/image-localizer.ts tests/core/image-localizer.test.ts
git commit -m "feat(core): localize content images mapping and rewrite"
```

---

### Task 8: 导出 meta.json（TDD）

**Files:**
- Create: `src/core/exporter/export-meta.ts`, `tests/core/export-meta.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/export-meta.test.ts
import { describe, it, expect } from 'vitest'
import { buildMeta } from '../../src/core/exporter/export-meta'
import type { ParsedArticle } from '../../src/core/types'

const parsed: ParsedArticle = {
  title: 'T', author: 'A', account: 'A', publishTime: '2026-02-25 08:00',
  digest: 'D', coverUrl: 'https://x/c', contentHtml: '<p>x</p>', imageUrls: [],
}

describe('buildMeta', () => {
  it('assembles ArticleMeta from parsed + context', () => {
    const m = buildMeta({
      parsed, id: '1_1_x', sourceUrl: 'https://x/s', dir: '/lib/A/2026_T',
      formats: ['md', 'meta'], now: '2026-06-06T00:00:00.000Z',
    })
    expect(m).toMatchObject({
      id: '1_1_x', title: 'T', account: 'A', sourceUrl: 'https://x/s',
      coverUrl: 'https://x/c', downloadTime: '2026-06-06T00:00:00.000Z',
      formats: ['md', 'meta'], dir: '/lib/A/2026_T',
    })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/export-meta.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/core/exporter/export-meta.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleMeta, DownloadFormat, ParsedArticle } from '../types'

export interface BuildMetaInput {
  parsed: ParsedArticle
  id: string
  sourceUrl: string
  dir: string
  formats: DownloadFormat[]
  now: string
}

export function buildMeta(input: BuildMetaInput): ArticleMeta {
  const { parsed, id, sourceUrl, dir, formats, now } = input
  return {
    id,
    title: parsed.title,
    author: parsed.author,
    account: parsed.account,
    publishTime: parsed.publishTime,
    sourceUrl,
    digest: parsed.digest,
    coverUrl: parsed.coverUrl,
    downloadTime: now,
    formats,
    dir,
  }
}

export async function writeMeta(dir: string, meta: ArticleMeta): Promise<void> {
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/export-meta.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/exporter/export-meta.ts tests/core/export-meta.test.ts
git commit -m "feat(core): build and write article meta.json"
```

---

### Task 9: 导出 Markdown（TDD）

**Files:**
- Create: `src/core/exporter/export-markdown.ts`, `tests/core/export-markdown.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/export-markdown.test.ts
import { describe, it, expect } from 'vitest'
import { buildMarkdown } from '../../src/core/exporter/export-markdown'
import type { ArticleMeta } from '../../src/core/types'

const meta: ArticleMeta = {
  id: '1', title: '标题', author: '公众号', account: '公众号',
  publishTime: '2026-02-25 08:00', sourceUrl: 'https://x/s', digest: '摘要',
  coverUrl: '', downloadTime: '2026-06-06T00:00:00.000Z', formats: ['md'], dir: '/d',
}

describe('buildMarkdown', () => {
  const md = buildMarkdown(meta, '<h2>小标题</h2><p>正文<strong>粗</strong></p><p><img src="images/img-1.jpg" /></p>')

  it('starts with frontmatter containing title and source', () => {
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('title: "标题"')
    expect(md).toContain('source: "https://x/s"')
  })
  it('converts headings and emphasis', () => {
    expect(md).toContain('## 小标题')
    expect(md).toContain('**粗**')
  })
  it('keeps local image reference', () => {
    expect(md).toContain('![](images/img-1.jpg)')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/export-markdown.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/core/exporter/export-markdown.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import TurndownService from 'turndown'
import type { ArticleMeta } from '../types'

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

function frontmatter(m: ArticleMeta): string {
  const esc = (s: string) => s.replace(/"/g, '\\"')
  return [
    '---',
    `title: "${esc(m.title)}"`,
    `account: "${esc(m.account)}"`,
    `author: "${esc(m.author)}"`,
    `publishTime: "${esc(m.publishTime)}"`,
    `source: "${esc(m.sourceUrl)}"`,
    `downloadTime: "${m.downloadTime}"`,
    '---',
    '',
  ].join('\n')
}

export function buildMarkdown(meta: ArticleMeta, contentHtml: string): string {
  return frontmatter(meta) + `# ${meta.title}\n\n` + td.turndown(contentHtml) + '\n'
}

export async function writeMarkdown(dir: string, meta: ArticleMeta, contentHtml: string): Promise<void> {
  await writeFile(join(dir, 'content.md'), buildMarkdown(meta, contentHtml), 'utf-8')
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/export-markdown.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/exporter/export-markdown.ts tests/core/export-markdown.test.ts
git commit -m "feat(core): export markdown with frontmatter via turndown"
```

---

### Task 10: 导出自包含 HTML（TDD）

**Files:**
- Create: `src/core/exporter/export-html.ts`, `tests/core/export-html.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/export-html.test.ts
import { describe, it, expect } from 'vitest'
import { buildHtml } from '../../src/core/exporter/export-html'
import type { ArticleMeta } from '../../src/core/types'

const meta: ArticleMeta = {
  id: '1', title: '标题<x>', author: '公众号', account: '公众号',
  publishTime: '2026-02-25', sourceUrl: 'https://x/s', digest: '',
  coverUrl: '', downloadTime: '2026-06-06T00:00:00.000Z', formats: ['html'], dir: '/d',
}

describe('buildHtml', () => {
  const html = buildHtml(meta, '<p>正文 <img src="images/img-1.jpg"></p>')
  it('is a full self-contained document', () => {
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<meta charset="utf-8"')
    expect(html).toContain('<style>')
  })
  it('escapes title in head but renders heading', () => {
    expect(html).toContain('<title>标题&lt;x&gt;</title>')
  })
  it('embeds meta header and local image', () => {
    expect(html).toContain('公众号')
    expect(html).toContain('src="images/img-1.jpg"')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/export-html.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/core/exporter/export-html.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleMeta } from '../types'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const STYLE = `
  body{max-width:720px;margin:0 auto;padding:24px;font-family:-apple-system,system-ui,"PingFang SC",sans-serif;line-height:1.75;color:#222}
  img{max-width:100%;height:auto}
  .wxk-header{border-bottom:1px solid #eee;padding-bottom:12px;margin-bottom:24px;color:#888;font-size:14px}
  h1{font-size:22px;line-height:1.4}
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/export-html.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/exporter/export-html.ts tests/core/export-html.test.ts
git commit -m "feat(core): export self-contained html"
```

---

### Task 11: 导出封面图（薄函数 + 手动验证）

**Files:**
- Create: `src/core/exporter/export-cover.ts`

- [ ] **Step 1: 实现**

```ts
// src/core/exporter/export-cover.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
}

/** 给定封面二进制与内容类型，落盘 cover.<ext>，返回文件名 */
export async function writeCover(dir: string, data: Buffer, contentType: string): Promise<string> {
  const ext = EXT_BY_TYPE[contentType.split(';')[0].trim().toLowerCase()] ?? 'jpg'
  const name = `cover.${ext}`
  await writeFile(join(dir, name), data)
  return name
}
```

- [ ] **Step 2: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。（实际下载在 Task 15 端到端验证。）

- [ ] **Step 3: 提交**

```bash
git add src/core/exporter/export-cover.ts && git commit -m "feat(core): write cover image"
```

---

### Task 12: 导出 PDF（Electron printToPDF，手动验证）

PDF 由已落盘的 `index.html` 渲染。需要 Electron 运行时，因此封装成"传入 BrowserWindow 工厂"的形式，便于在 CLI/GUI 两侧复用，也便于将来替换。

**Files:**
- Create: `src/core/exporter/export-pdf.ts`

- [ ] **Step 1: 实现**

```ts
// src/core/exporter/export-pdf.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 用离屏 BrowserWindow 加载本地 index.html 并 printToPDF。
 *  传入 electron 的 BrowserWindow 构造器以避免 core 直接耦合 electron 导入。 */
export async function writePdfFromHtml(
  dir: string,
  BrowserWindowCtor: typeof import('electron').BrowserWindow,
): Promise<void> {
  const win = new BrowserWindowCtor({ show: false, webPreferences: { offscreen: true } })
  try {
    await win.loadURL(pathToFileURL(join(dir, 'index.html')).toString())
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await writeFile(join(dir, 'content.pdf'), pdf)
  } finally {
    win.destroy()
  }
}
```

- [ ] **Step 2: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

> 实际 PDF 生成依赖 Electron 运行时，统一在 Task 17 端到端手动验证。

- [ ] **Step 3: 提交**

```bash
git add src/core/exporter/export-pdf.ts && git commit -m "feat(core): export pdf via electron printToPDF"
```

---

### Task 13: 文章库索引（TDD：增/查/搜/删）

**Files:**
- Create: `src/core/library.ts`, `tests/core/library.test.ts`

- [ ] **Step 1: 写失败测试**（用临时目录做真实文件系统读写）

```ts
// tests/core/library.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../../src/core/library'
import type { ArticleMeta } from '../../src/core/types'

function meta(id: string, title: string, account = '号A'): ArticleMeta {
  return {
    id, title, author: account, account, publishTime: '2026-02-25',
    sourceUrl: `https://x/${id}`, digest: '', coverUrl: '',
    downloadTime: '2026-06-06T00:00:00.000Z', formats: ['md'], dir: '',
  }
}

describe('Library', () => {
  let root: string
  let lib: Library
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wxk-'))
    lib = new Library(root)
  })

  it('add then list returns the entry', async () => {
    await lib.add(meta('1', '第一篇'))
    expect((await lib.list()).map(e => e.id)).toEqual(['1'])
  })

  it('has() detects existing id for dedup', async () => {
    await lib.add(meta('1', '第一篇'))
    expect(await lib.has('1')).toBe(true)
    expect(await lib.has('2')).toBe(false)
  })

  it('search matches title case-insensitively', async () => {
    await lib.add(meta('1', '深度长文'))
    await lib.add(meta('2', '短讯'))
    expect((await lib.search('深度')).map(e => e.id)).toEqual(['1'])
  })

  it('remove deletes index entry and on-disk folder', async () => {
    const m = meta('1', '第一篇')
    const dir = join(root, 'art1')
    mkdirSync(dir); writeFileSync(join(dir, 'content.md'), 'x')
    m.dir = dir
    await lib.add(m)
    await lib.remove('1')
    expect(await lib.has('1')).toBe(false)
    expect(existsSync(dir)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/library.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// src/core/library.ts
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ArticleMeta } from './types'

interface LibraryFile { version: number; articles: ArticleMeta[] }

export class Library {
  private indexPath: string
  constructor(private root: string) {
    this.indexPath = join(root, 'library.json')
  }

  private async read(): Promise<LibraryFile> {
    if (!existsSync(this.indexPath)) return { version: 1, articles: [] }
    return JSON.parse(await readFile(this.indexPath, 'utf-8')) as LibraryFile
  }

  private async write(data: LibraryFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(this.indexPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  async list(): Promise<ArticleMeta[]> {
    return (await this.read()).articles
  }

  async has(id: string): Promise<boolean> {
    return (await this.read()).articles.some(a => a.id === id)
  }

  async add(meta: ArticleMeta): Promise<void> {
    const data = await this.read()
    const i = data.articles.findIndex(a => a.id === meta.id)
    if (i >= 0) data.articles[i] = meta
    else data.articles.push(meta)
    await this.write(data)
  }

  /** 按标题（文件名）大小写不敏感匹配 */
  async search(keyword: string): Promise<ArticleMeta[]> {
    const k = keyword.trim().toLowerCase()
    if (!k) return this.list()
    return (await this.read()).articles.filter(a => a.title.toLowerCase().includes(k))
  }

  /** 删除索引项并清理磁盘文件夹 */
  async remove(id: string): Promise<void> {
    const data = await this.read()
    const entry = data.articles.find(a => a.id === id)
    if (entry?.dir && existsSync(entry.dir)) await rm(entry.dir, { recursive: true, force: true })
    data.articles = data.articles.filter(a => a.id !== id)
    await this.write(data)
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/library.test.ts`
Expected: PASS（4 用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/core/library.ts tests/core/library.test.ts
git commit -m "feat(core): library index with add/list/search/remove"
```

---

### Task 14: 导出编排 + 下载队列（TDD：编排/串行/去重/进度/失败隔离）

先实现"单篇导出编排"（把已解析+已下载的素材按所选格式写盘），再实现"队列"（串行处理多 URL、去重、发进度、失败不中断）。队列把"下载单篇"作为注入函数，便于测试不触网。

**Files:**
- Create: `src/core/exporter/index.ts`, `src/core/download-queue.ts`, `tests/core/download-queue.test.ts`

- [ ] **Step 1: 实现导出编排（无独立单测，由队列测试覆盖路径选择）**

```ts
// src/core/exporter/index.ts
import { mkdir } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleMeta, DownloadFormat, ParsedArticle } from '../types'
import { buildMeta, writeMeta } from './export-meta'
import { writeMarkdown } from './export-markdown'
import { writeHtml } from './export-html'
import { writeCover } from './export-cover'
import { writePdfFromHtml } from './export-pdf'
import { buildImageMap, rewriteImageRefs } from '../image-localizer'

export interface ExportDeps {
  /** 下载二进制（图片/封面） */
  fetchBinary: (url: string) => Promise<{ data: Buffer; contentType: string }>
  /** Electron BrowserWindow 构造器（PDF 用）；CLI/GUI 注入 */
  BrowserWindowCtor: typeof import('electron').BrowserWindow
  now: () => string
}

export interface ExportInput {
  parsed: ParsedArticle
  id: string
  sourceUrl: string
  dir: string
  formats: DownloadFormat[]
}

/** 按所选格式导出一篇文章，返回最终 meta。调用方保证 dir 尚不存在或可写。 */
export async function exportArticle(input: ExportInput, deps: ExportDeps): Promise<ArticleMeta> {
  const { parsed, id, sourceUrl, dir, formats } = input
  await mkdir(dir, { recursive: true })

  const needImages = formats.includes('md') || formats.includes('html')
  let contentHtml = parsed.contentHtml

  // 图片本地化（md/html 需要）
  if (needImages && parsed.imageUrls.length) {
    await mkdir(join(dir, 'images'), { recursive: true })
    const downloaded = new Map<string, { data: Buffer; contentType: string }>()
    for (const url of parsed.imageUrls) {
      try { downloaded.set(url, await deps.fetchBinary(url)) } catch { /* 跳过坏图 */ }
    }
    const map = buildImageMap([...downloaded.keys()], u => downloaded.get(u)!.contentType)
    for (const [url, rel] of map) await writeFile(join(dir, rel), downloaded.get(url)!.data)
    contentHtml = rewriteImageRefs(parsed.contentHtml, map)
  }

  const meta = buildMeta({ parsed, id, sourceUrl, dir, formats, now: deps.now() })

  if (formats.includes('cover') && parsed.coverUrl) {
    try { const { data, contentType } = await deps.fetchBinary(parsed.coverUrl); await writeCover(dir, data, contentType) } catch { /* 封面失败不致命 */ }
  }
  if (formats.includes('md')) await writeMarkdown(dir, meta, contentHtml)
  if (formats.includes('html') || formats.includes('pdf')) await writeHtml(dir, meta, contentHtml)
  if (formats.includes('pdf')) await writePdfFromHtml(dir, deps.BrowserWindowCtor)
  if (formats.includes('meta')) await writeMeta(dir, meta)

  return meta
}
```

- [ ] **Step 2: 写队列失败测试**

```ts
// tests/core/download-queue.test.ts
import { describe, it, expect } from 'vitest'
import { DownloadQueue, type DownloadOne } from '../../src/core/download-queue'
import type { ProgressEvent } from '../../src/core/types'

describe('DownloadQueue', () => {
  it('processes urls serially in order and reports progress', async () => {
    const order: string[] = []
    const events: ProgressEvent[] = []
    const downloadOne: DownloadOne = async (url) => {
      order.push(url)
      return { url, ok: true, id: url, dir: `/d/${url}`, formats: ['md'] }
    }
    const q = new DownloadQueue(downloadOne, e => events.push(e))
    const summary = await q.run(['a', 'b', 'c'])

    expect(order).toEqual(['a', 'b', 'c'])
    expect(summary).toMatchObject({ total: 3, succeeded: 3, failed: 0, skipped: 0, ok: true })
    expect(events.some(e => e.phase === 'done' && e.completed === 3)).toBe(true)
  })

  it('isolates failures without stopping the queue', async () => {
    const downloadOne: DownloadOne = async (url) => {
      if (url === 'bad') throw new Error('boom')
      return { url, ok: true, id: url }
    }
    const q = new DownloadQueue(downloadOne, () => {})
    const summary = await q.run(['ok1', 'bad', 'ok2'])

    expect(summary).toMatchObject({ total: 3, succeeded: 2, failed: 1, ok: false })
    const bad = summary.items.find(i => i.url === 'bad')!
    expect(bad.ok).toBe(false)
    expect(bad.error?.message).toContain('boom')
  })

  it('counts skipped (dedup) items as ok', async () => {
    const downloadOne: DownloadOne = async (url) => ({ url, ok: true, skipped: url === 'dup', id: url })
    const q = new DownloadQueue(downloadOne, () => {})
    const summary = await q.run(['new', 'dup'])
    expect(summary).toMatchObject({ succeeded: 1, skipped: 1, failed: 0, ok: true })
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/core/download-queue.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现队列**

```ts
// src/core/download-queue.ts
import type { DownloadItemResult, DownloadSummary, ProgressEvent } from './types'

export type DownloadOne = (url: string) => Promise<DownloadItemResult>
export type OnProgress = (e: ProgressEvent) => void

export class DownloadQueue {
  constructor(private downloadOne: DownloadOne, private onProgress: OnProgress = () => {}) {}

  async run(urls: string[]): Promise<DownloadSummary> {
    const items: DownloadItemResult[] = []
    const total = urls.length

    for (let i = 0; i < total; i++) {
      const url = urls[i]
      this.onProgress({ total, completed: i, currentUrl: url, phase: 'fetch' })
      try {
        const r = await this.downloadOne(url)
        items.push(r)
      } catch (err) {
        items.push({ url, ok: false, error: { code: 'DOWNLOAD_FAILED', message: (err as Error).message } })
      }
      this.onProgress({ total, completed: i + 1, currentUrl: url, phase: 'save' })
    }

    const succeeded = items.filter(i => i.ok && !i.skipped).length
    const skipped = items.filter(i => i.ok && i.skipped).length
    const failed = items.filter(i => !i.ok).length
    this.onProgress({ total, completed: total, currentUrl: '', phase: 'done' })

    return { ok: failed === 0, total, succeeded, failed, skipped, items }
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/core/download-queue.test.ts`
Expected: PASS（3 用例全绿）。

- [ ] **Step 6: 全量测试回归**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npm test`
Expected: 全部测试通过。

- [ ] **Step 7: 提交**

```bash
git add src/core/exporter/index.ts src/core/download-queue.ts tests/core/download-queue.test.ts
git commit -m "feat(core): article export orchestration and serial download queue"
```

---

### Task 15: 组装"下载单篇"用例 + CLI download 命令

把 fetch → parse → export → 入库 串成一个 `downloadArticle`，再用 commander 暴露 `wx-kit download`。

**Files:**
- Create: `src/core/download-article.ts`, `src/cli/index.ts`

- [ ] **Step 1: 实现 downloadArticle（组装，依赖注入）**

```ts
// src/core/download-article.ts
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { DownloadFormat, DownloadItemResult } from './types'
import { articleId } from './article-id'
import { articleDirName, dedupeDirName, sanitizeName } from './paths'
import { parseArticle } from './parse-article'
import { exportArticle, type ExportDeps } from './exporter'
import { Library } from './library'

export interface DownloadArticleDeps extends ExportDeps {
  fetchHtml: (url: string) => Promise<string>
  library: Library
  libraryRoot: string
}

export async function downloadArticle(
  url: string,
  formats: DownloadFormat[],
  deps: DownloadArticleDeps,
): Promise<DownloadItemResult> {
  const id = articleId(url)
  if (await deps.library.has(id)) return { url, ok: true, id, skipped: true }

  const html = await deps.fetchHtml(url)
  const parsed = parseArticle(html, url)

  const accountDir = join(deps.libraryRoot, sanitizeName(parsed.account || 'unknown'))
  const datePrefix = parsed.publishTime.slice(0, 10)
  const base = articleDirName(datePrefix, parsed.title)
  const dirName = dedupeDirName(base, name => existsSync(join(accountDir, name)))
  const dir = join(accountDir, dirName)

  const meta = await exportArticle({ parsed, id, sourceUrl: url, dir, formats }, deps)
  await deps.library.add(meta)

  return { url, ok: true, id, dir, formats: meta.formats }
}
```

- [ ] **Step 2: 实现 CLI（download 命令；JSON→stdout，进度→stderr）**

```ts
// src/cli/index.ts
import { Command } from 'commander'
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import type { DownloadFormat, DownloadSummary } from '../core/types'
import { ALL_FORMATS } from '../core/types'
import { fetchHtml, fetchBinary } from '../core/fetch-html'
import { Library } from '../core/library'
import { DownloadQueue } from '../core/download-queue'
import { downloadArticle } from '../core/download-article'

function defaultLibraryRoot(): string {
  return join(homedir(), 'Documents', 'wx-kit')
}

function parseFormats(csv: string): DownloadFormat[] {
  const set = new Set(csv.split(',').map(s => s.trim()).filter(Boolean))
  const out = ALL_FORMATS.filter(f => set.has(f))
  if (!out.length) throw new Error(`no valid formats in "${csv}"; valid: ${ALL_FORMATS.join(',')}`)
  return out
}

function out(summary: DownloadSummary): void {
  process.stdout.write(JSON.stringify(summary) + '\n')
}

/** 解析 CLI 参数并执行；返回退出码 */
export async function runCli(argv: string[]): Promise<number> {
  const program = new Command()
  program.name('wx-kit').description('微信百宝箱 CLI').exitOverride()

  let exitCode = 0

  program
    .command('download')
    .description('下载一个或多个微信文章 URL')
    .option('-u, --url <url...>', '文章 URL（可多次）', [])
    .option('-f, --urls-file <file>', '每行一个 URL 的文件')
    .option('--formats <csv>', '逗号分隔：cover,md,html,pdf,meta', 'md,html,meta')
    .option('-o, --out <dir>', '文章库根目录', defaultLibraryRoot())
    .action(async (opts) => {
      const urls: string[] = [...(opts.url ?? [])]
      if (opts.urlsFile) {
        urls.push(...readFileSync(opts.urlsFile, 'utf-8').split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean))
      }
      if (!urls.length) throw new Error('no urls; use --url or --urls-file')
      const formats = parseFormats(opts.formats)
      const library = new Library(opts.out)
      const deps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot: opts.out }

      const queue = new DownloadQueue(
        (url) => downloadArticle(url, formats, deps),
        (e) => process.stderr.write(`[${e.completed}/${e.total}] ${e.phase} ${e.currentUrl}\n`),
      )
      const summary = await queue.run(urls)
      out(summary)
      exitCode = summary.ok ? 0 : 1
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: 'CLI_ERROR', message: (err as Error).message } }) + '\n')
    exitCode = 2
  }
  return exitCode
}
```

> 注：CLI 的运行时入口（`app.whenReady` → `runCli` → `app.exit`）由 `electron/main.ts` 统一负责（Task 16），此处只导出纯函数 `runCli`，便于将来单测参数解析。`app`/`BrowserWindow` 仅在 `download` action 内实际用到（注入给导出器）。

- [ ] **Step 3: 编译校验**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add src/core/download-article.ts src/cli/index.ts
git commit -m "feat: assemble downloadArticle use-case and CLI download command"
```

---

### Task 16: Electron 主进程模式分流（GUI / CLI）

**Files:**
- Modify: `electron/main.ts`（Task 1 未建，此处创建）
- Create: `electron/main.ts`

- [ ] **Step 1: 实现主进程入口**

带子命令参数即进入 CLI 模式，否则开 GUI 窗口。

```ts
// electron/main.ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { runCli } from '../src/cli'

const CLI_COMMANDS = new Set(['download', 'crawl', 'search', 'login', 'auth-status', 'library'])

function isCliInvocation(argv: string[]): boolean {
  return argv.length > 0 && CLI_COMMANDS.has(argv[0])
}

// 打包后 argv: [exe, ...args]；开发时 argv: [electron, '.', ...args]
function userArgs(): string[] {
  const raw = process.argv.slice(app.isPackaged ? 1 : 2)
  return raw.filter(a => a !== '.')
}

async function main() {
  const args = userArgs()

  if (isCliInvocation(args)) {
    await app.whenReady()
    const code = await runCli(args)
    app.exit(code)
    return
  }

  // GUI 模式
  await app.whenReady()
  const win = new BrowserWindow({
    width: 1200, height: 800, title: 'wx-kit',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '../dist/index.html'))

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

main()
```

- [ ] **Step 2: 编译校验**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: 构建主进程产物（供 CLI 运行）**

Run: `cd /Users/chenzhian/workspace/ai/wx-kit && npx vite build`
Expected: 生成 `dist/`（渲染层）与 `dist-electron/main.js`、`dist-electron/preload.js`，无报错。

- [ ] **Step 4: 提交**

```bash
git add electron/main.ts && git commit -m "feat(electron): main entry with GUI/CLI mode dispatch"
```

---

### Task 17: 端到端验证 `wx-kit download`（手动，联网）

验证完整链路：CLI 调用 → 抓取 → 解析 → 图片本地化 → 五种格式落盘 → 入库 → 去重。

- [ ] **Step 1: 单篇、全格式下载到临时库**

Run（替换 REAL_ARTICLE 为任意真实公开微信文章 URL）:
```bash
cd /Users/chenzhian/workspace/ai/wx-kit
npx electron . download --url "https://mp.weixin.qq.com/s/REAL_ARTICLE" --formats cover,md,html,pdf,meta --out /tmp/wxk-lib
```
Expected:
- stderr 出现 `[0/1] fetch ...`、`[1/1] save ...`、`done` 之类进度。
- stdout 最后输出一行 JSON，`"ok":true,"succeeded":1`。
- 退出码 0：`echo $?` 为 0。

- [ ] **Step 2: 检查落盘产物**

Run: `find /tmp/wxk-lib -type f | sort`
Expected: 包含 `library.json`、`<公众号>/<日期>_<标题>/` 下的 `content.md`、`index.html`、`content.pdf`、`cover.*`、`meta.json`、`images/img-*.<ext>`。

- [ ] **Step 3: 验证 PDF 与 HTML 可读**

Run: `open /tmp/wxk-lib/*/*/content.pdf` 与 `open /tmp/wxk-lib/*/*/index.html`
Expected: PDF 正常打开、有正文与图片；HTML 离线可读、图片显示。

- [ ] **Step 4: 验证去重**

Run: 重复执行 Step 1 同一 URL。
Expected: stdout JSON 中 `"skipped":1,"succeeded":0,"ok":true`，不重复建文件夹。

- [ ] **Step 5: 验证多 URL 与 urls-file**

Run:
```bash
printf '%s\n%s\n' "https://mp.weixin.qq.com/s/REAL_A" "https://mp.weixin.qq.com/s/REAL_B" > /tmp/urls.txt
npx electron . download --urls-file /tmp/urls.txt --formats md,meta --out /tmp/wxk-lib2
```
Expected: stdout JSON `total:2`，两篇分别入库；失败项（若有）`ok:false` 且其它篇仍成功。

- [ ] **Step 6: 验证失败隔离与 JSON 契约**

Run: `npx electron . download --url "https://mp.weixin.qq.com/s/INVALID" --url "https://mp.weixin.qq.com/s/REAL_A" --out /tmp/wxk-lib3; echo "exit=$?"`
Expected: 坏 URL 项 `ok:false` 带 `error`，好 URL 项成功；整体 `ok:false`，退出码 1；stdout 仅一行合法 JSON（进度都在 stderr）。

- [ ] **Step 7: 记录验证结果并提交（若期间有修复）**

```bash
cd /Users/chenzhian/workspace/ai/wx-kit
git add -A && git commit -m "test: verify end-to-end cli download (manual)" --allow-empty
```

---

## 自检（写计划者执行，已完成）

**Spec 覆盖（对照 PRD M1 相关需求）：**
- F1 URL 下载多格式 → Task 5/7/8/9/10/11/12/15；多 URL 与 urls-file → Task 15/17。
- §6 格式规格（cover/md/html/pdf/meta + images 本地化）→ Task 7–12。
- §7 存储结构（自包含文件夹 + library.json，默认用户文档目录可配置）→ Task 13/15（`--out` 默认 `~/Documents/wx-kit`）。
- §8 架构（core 与 UI 解耦、统一 Electron 二进制双模式）→ Task 2/16。
- §8.4 进度（download-queue 单一来源、CLI 走 stderr、stdout 输出 JSON）→ Task 14/15。
- 去重续传 → Task 4/15/17。
- F4 CLI download 与输出契约 → Task 15/16/17。
- **本计划范围外（后续里程碑）**：登录/搜索/批量爬取（M3）、GUI 与阅读器/库管理 UI（M2）、打包跨平台（M4）、`crawl/search/login/library list` CLI 命令（M3）。

**占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码；网络/Electron 依赖步骤标注手动验证并说明覆盖位置。

**类型一致性：** `ParsedArticle`/`ArticleMeta`/`DownloadFormat`/`DownloadItemResult`/`DownloadSummary`/`ProgressEvent` 全程一致；`exportArticle`/`downloadArticle`/`DownloadQueue.run` 签名在调用处吻合；`Library` 方法名（has/add/list/search/remove）跨任务一致。
