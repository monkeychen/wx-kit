# wx-kit v0.12.2 产品需求文档（迭代 PRD）

> 状态：**已定稿**（2026-10-08，安哥确认 R1 + R2 同版发出）。
> R1 于 2026-09-30 完成 spike 并定案；R2 为依赖安全升级（2026-10-08 发现仓库
> 14 条 Dependabot 告警，安哥定「作为 v0.12.2 解决」）。
> 当前进度见 `ROADMAP.md`，验收以本文第 4 节为准。

## 1. 一句话定义

**含视频的文章，下载后不该只剩一句说明文字（R1）；仓库不再挂着 14 条安全告警（R2）。**

## 2. 背景

安哥在真实使用（656 篇文库 / 40 公众号 / 18 个订阅账号）中发现：文章里的视频
「跟没保存一样」——具体查下来是三处不同的成因，且**两侧都拿不到长期有效的视频直链**。

### 2.1 微信侧：不是忽略，是刻意「不落地」

- M35 已实现视频下载，但**默认关闭**（最清档实测 133MB），且失败/未下载时正文只给一句
  说明：`📹 本文含 N 个视频（未下载；1920×1080, 3:21, 45.3MB）…`。
- 阅读器**已经能播 `<video>`**（`Reader.tsx:102`），但只认 `videos/` 开头的**库内本地文件**。
- **硬约束**：视频直链带 `dis_t`/`auth_key` 签名，**有时效**。`parse-video.ts:9`、
  `export-video.ts:9`、`types.ts:48`、`exporter/index.ts:78` **四处**都因此明确不存 url。
  结论：**今天能播的直链几天后必然 403**，这是微信签名机制，不是实现缺陷。

### 2.2 墨问侧：视频被静默丢弃（spike 新发现）

安哥提供样本 `https://note.mowen.cn/detail/Jlvxr4t3bWSmXoGGNEOfm`，2026-09-30 spike 实测：

- 视频**不是** `<video>` 标签，是**`<channel-video uuid="..." feed-id="export/...">`**
  自定义标签（内容实为**微信视频号**）。当前解析器只处理 `img` / `noteRef` / `audio`，
  **不认这个标签 → 正文里什么都不留**（无说明、无占位）。
- 服务端**已标记**该笔记有视频：`detail.noteFlag.hasVideo: true`——我们没读这个字段。
- `detail.noteEmbed` 返回 `null`、`noteFileTree` 只有 `imageInline` → **视频数据不在
  note/show 的返回里**。
- 猜端点全部失败（`/api/note/wxa/v1/channel/video` 404、`/api/channel/wxa/v1/feed` 405、
  `/api/note/wxa/v1/video/show` 404）——**不猜端点，spike 才能拿到真结论**（项目既有纪律）。
- Playwright 抓墨问网页端真实请求：匿名态下 `videoCount=0`，**墨问自己的网页端也没渲染出
  播放器**。
- **唯一可行解**：`https://channels.weixin.qq.com/{feed-id}` 实测返回 **200**，即 feed-id
  可直接拼成可访问的视频号页面链接。

### 2.3 结论：两侧都无法「直接播流」，但都能「跳出去看」

安哥需求原话是「不下载视频文件，点击播放按钮时才播放视频流」。spike 结论是
**这个前提在微信与墨问两侧都不成立**（签名时效 / 无直链接口）。因此本版把目标调整为
**可执行的等价物**：点开文章 → 视频位置给出可点的入口 → 能看即看，失效了也有兜底。

## 3. 需求清单

### R1 · 视频入口（微信 + 墨问，spike 已完成，2026-09-30 安哥定案）

**用户目标**：下载含视频的文章后，在文库点开这篇，**视频位置要有一个能点的东西**——
不是一句说明文字，也不是什么都没有。

**方案（Q1=C + B1，2026-09-30 安哥确认）**：

- **同时**保留两个入口，不做二选一：
  1. **在线播放**（`<video>`，拉流不落地）——仅当本次解析拿到了直链时可用（微信：
     解析当次有效）；墨问侧因接口不返回直链，此入口**恒不可用**。
  2. **跳原始页面看**（永久有效）——微信跳 `sourceUrl`（文章原页），墨问跳
     `https://channels.weixin.qq.com/{feed-id}`（视频号页）。
- **失效自动降级（安哥选 B1）**：`<video>` 挂 `error` 事件，播不了**自动**替换为
  「在微信里打开」按钮——**不让用户自己判断是不是过期了**（系统承担复杂性）。
  不采用 B2（并列给两个入口让用户自选）——那要求用户理解签名时效，不符合交互原则。
- **Markdown 视图**（安哥选「md 给可跳转至系统浏览器的链接」）：纯文本存不住可播控件，
  md 里给**指向原始页面/视频号页的可点链接**，不写 `<video>`。
- **HTML 视图**：给 `<video controls>`（有直链时）+ 永久有效的跳转链接。

**数据模型**：`meta.json` 的 `videos[]` 增加两个字段——
`streamUrl?`（**当次解析的直链，可能已过期**，不保证长期有效）与
`fallbackUrl`（**永久有效的跳转目标**）。既有「不存 url」的纪律**不违反**：
存的不是签名直链的长期副本，而是「当次可用则用、不可用则降级」的双入口，
且 `fallbackUrl` 本身不带签名（文章页/视频号页是稳定地址）。

>⚠️ **诚实性红线**：`streamUrl` 是**带时效的**。写入时必须在 meta 与 UI 上如实标注
>「在线播放可能已过期」，不得让用户以为它是永久可播的。**这是本需求最容易做成
> 「看起来能用、实际骗人」的地方。**

**墨问侧解析改造**：识别正文中的 `<channel-video>`，取出 `feed-id` 拼出
`channels.weixin.qq.com/{feed-id}` 作为 `fallbackUrl`；`hasVideo: true` 时即使正文里
一个标签都没匹配到，也要在 `warnings` 里说清「服务端标记有视频但未解析出入口」——
**不静默丢弃**（与项目既有纪律一致）。

### R2 · 依赖安全升级（2026-10-08 并入，零功能变更）

GitHub 仓库出现 14 条 open 的 Dependabot 告警（另 1 条密钥扫描告警 2026-08-28 已
resolved，与本版无关）：

| 包 | 当前 | 修复线 | 告警数 | 代表性漏洞 |
|---|---|---|---|---|
| undici（cheerio 传递依赖，runtime） | 7.29.0 | ≥ 7.29.1 | 10 | 缓存重放、共享缓存跨用户 Set-Cookie 泄露、无界解压 DoS、BalancedPool 丢弃 connect 选项致 TLS 证书校验绕过 |
| electron（devDependency，打进安装包） | 42.8.1 | 3 条 ≥ 42.9.2、1 条 ≥ 42.10.0 | 4 | 协议 handler 无 corsEnabled 允许跨域读取、沙箱顶层文档窗口不继承沙箱限制、`<webview>` 可在 Worker 启用 Node 集成、被攻陷 renderer 投毒沙箱 preload 代码缓存 |

**暴露面判断**：undici 只被 `cheerio.load` 间接使用（vite 构建 external、惰性不加载），
缓存/WebSocket/retry 等告警路径多不在使用面；electron 的协议跨域读取与 preload 缓存
投毒对 `wxfile://` 自定义协议 + contextBridge preload 架构是**真实相关面**。

**升级动作**：

| 依赖 | 动作 | 目标 |
|---|---|---|
| undici | `npm update undici`（lockfile 内；cheerio 声明 `^7.19.0` 涵盖） | ≥ 7.29.1 |
| electron | `npm install --save-dev electron@^42.11.12`（42.x 最新 patch，高于全部修复线） | ≥ 42.10.0（全 4 条） |

决策：undici 不进 package.json、不加 overrides（传递依赖，锁文件升级即最小变更）；
electron 同大版本内升至最新 patch，安全修复版不捎带跨大版本（43+）风险；
`vite.config.ts` 的 undici external 约束不变（与版本无关）。

## 4. 验收清单

实现后逐条勾选（**当前均未实现，不预先勾选**）。

### R1 · 视频入口

- [ ] 微信文章含视频但未下载视频文件时：html 视图视频位置可点播放，且带永久有效的
      「在微信里打开」入口
- [ ] 微信侧 `streamUrl` 失效时：`<video>` 触发 `error` 后**自动**降级为跳转按钮，
      不留一个播不出来的空播放器
- [ ] 墨问笔记含 `<channel-video>` 时：解析出 `channels.weixin.qq.com/{feed-id}` 入口，
      正文原位置不再静默消失
- [ ] 墨问笔记 `hasVideo: true` 但解析不出入口时：`warnings` 如实报告，不静默丢弃
- [ ] md 视图：视频位置给可点的跳转链接，不出现 `<video>` 标签
- [ ] `meta.json` 的 `videos[]` 含 `streamUrl`（可缺省）与 `fallbackUrl`，
      且 UI/文档明确标注前者可能过期
- [ ] 单测覆盖：`<channel-video>` 解析、`hasVideo` 与解析结果不一致时的告警、
      `streamUrl` 缺省时不渲染播放器
- [ ] e2e 覆盖：含 `<channel-video>` 的 fixture 笔记走通「解析 → 正文出现入口 → 点击跳转
      目标正确」
- [ ] 真实样本回归：用 `Jlvxr4t3bWSmXoGGNEOfm` 真机下载一次，确认正文出现视频号入口

### R2 · 依赖安全升级

- [ ] `node_modules/undici` 锁定版本 ≥ 7.29.1（锁文件唯一副本）
- [ ] devDependencies.electron ≥ 42.10.0（实际 ^42.11.12）
- [ ] `npm test` / `npx tsc --noEmit` / `npm run lint` 全绿
- [ ] `WXKIT_E2E_HEADLESS=1 npm run test:e2e` 全绿（Electron 42.11 下 GUI 全流程）
- [ ] push 后 GitHub Dependabot 告警清零（回源核实，不凭推断）

### 发版

- [ ] 三平台包（dmg arm64/x64 + win exe）出包并真实启动 .app 验证
- [ ] GitHub Release + brew tap 双渠道上线并按规约核实

## 5. 非目标

- **不下载视频文件**（安哥明确要求；视频下载能力 M35 已保留为可选项，本版不动其逻辑）
- **不把视频转存进文库目录**（体积与时效都不划算）
- **不做视频号内容抓取/解析**（`feed-id` 只用于跳转，不解析其内容）
- **不承诺「在线播放永久可用」**——签名时效客观存在，本版给的是「能播就播、失效有兜底」
- 不涉及微信侧消息类型解析的其他改动
- **不跨 Electron 大版本**（43+ 若存在，另行评估）
- 不动 `vite.config.ts` 的 external 配置
