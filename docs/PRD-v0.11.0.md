# wx-kit v0.11.0 产品需求文档（迭代 PRD）

> R1 + R2 + R3 对应 M59+（2026-09-11 安哥拍板：R1 复制路径 + 墨问接入 + 启动检测 合并到 v0.11.0，原 v0.10.7 取消）。R2 实现路径根据同日 5 个 spike 修订（详见 `docs/superpowers/spikes/2026-09-11-mowen-integration-feasibility.md`）。当前进度见 `ROADMAP.md`，验收以本文第 6 节为准。

## 1. 一句话定义

**文库内容源从「只下微信文章」扩到「也下墨问笔记」，复用统一文库与阅读器；启动时自动检测 mocli 给安装指引；文库单篇支持复制保存路径。**

## 2. 背景与已确认交互（2026-09-11 安哥拍板）

- 现状：wx-kit 只下微信文章；用户已订阅墨问想下到本地统一管理；agent 调用方有 mocli + 三个官方 skill（mo-discover / mo-note / mo-user），但 wx-kit 内核不识别墨问。
- **R1 复制路径**（原 v0.10.7 R1，已定稿并入本版）：用户/agent 经常需要「文库某篇本地路径」传给其他工具；当前缺单篇粒度入口。
- **R2 墨问接入（经 5 个 spike 修订）**：
  - **不集成墨问 API**：spike #1 实测 wx-kit 直连 `open.mowen.cn` 被阿里云 ALB 持续 503（与代码无关，是网络层问题）；方案 A 让 wx-kit 背负这个永远解决不掉的问题。改走方案 B。
  - **mocli 拿元数据 + wx-kit BrowserWindow 渲染拿正文**：spike #2 实测 `mocli --show-atom` 仅自己笔记生效；spike #3 实测 mowen 是纯 Vue SPA（无 SSR、无公开 JSON API）；spike #4 实测 wx-kit 自己的 offscreen BrowserWindow **无 cookie** 就能渲染公开笔记拿到完整正文（关键词命中 + 1052 字符）。
  - **覆盖范围**：① 公开/会员可看/自己写的公开笔记（mocli list + BrowserWindow 渲染）；② 自己写的任何笔记（mocli `--show-atom` 拿完整 AST）。他人私密笔记**不在 v0.11.0**（mowen 按作者授权，mocli 列表接口不返回，wx-kit 也无能为力）。
  - **不引入新依赖**：复用 wx-kit 已有的 Electron Chromium 与 `export-pdf.ts` 的 offscreen BrowserWindow 模式。
- **v0.10.0 教训保留**：墨问列表接口（按作者批量）服务端按账号封禁与客户端无关（CLAUDE.md 钉死），**本版不接按作者批量下载**，仅做单 URL / 单 noteId 拉取。
- **mocli 检测**（R3）：每次启动 wx-kit 主进程做一次检测，结果写 settings 缓存，UI 不打扰（设置页常驻显示）。
- **mocli 缺失时**：墨问入口禁用（GUI URL 输入框 hover 提示、CLI `mowen` 命令报错出指引），不阻塞其他功能。
- **CLI 范围**（按安哥拍板，含 list-mine + search）：`wx-kit mowen import / detect / list-mine / search`，完整包装 mocli 主要读命令；写命令（create / edit / set / tag）不在 wx-kit 范围内（那是 agent 用 mocli 直接做的事）。

## 3. 需求清单

### R1 · 文库每篇文章复制保存路径

**用户目标**：文库页面每篇文章能一键拿到本地保存路径，粘给其他工具或 agent 使用。

**行为**：
- 复制内容 =该篇文章的**目录绝对路径**（一行），即 `<libraryRoot>/<meta.dir>`。下含 md/html/pdf/cover/meta，粘到 Finder 可见全部格式。
- **卡片视图**：右键菜单加「📋 复制路径」一项，与现有 hover「阅读/文件夹/删除」按钮**并存**（不替换）。
- **列表视图**：操作列加常驻「📋 复制路径」按钮，与「阅读/文件夹/删除」并列。
- 多选时只复制右键/按钮所在的那一篇，**不**新增工具栏批量复制按钮。
- 反馈：成功 `message.success('已复制')`，失败 `message.error('复制失败：' + msg)`。
- **CLI 不动**——`library list/search` 已输出 `dir`，agent 自拼绝对路径。

### R2 · 墨问笔记接入

**用户目标**：在 wx-kit URL 下载页或 CLI 输入墨问笔记 URL / noteId，把笔记下到本地文库，复用统一 library + 阅读器 + 导出。

**覆盖范围**（spike #5 推论）：
- ✅ **公开笔记 / 会员可看的付费笔记 / 自己写的公开笔记**：mocli list + BrowserWindow 渲染拿正文
- ✅ **自己写的笔记**（私密/部分公开/公开/付费）：mocli `--show-atom` 拿完整 AST（结构化最稳）
- ❌ **他人私密笔记**：mowen 按作者授权，mocli 列表接口不返回，wx-kit 无法访问（v0.11.0 范围外）

**核心流程**（spike #4 验证）：

```
note.mowen.cn/detail/<id>  URL/CLI 命令
       ↓
① mocli notes homepage / mine / search / tagged  → noteId list
       ↓
② mocli note info --note-id <id>  → 元数据(title/uid/brief/word_count/stat)
       ↓
③ offscreen BrowserWindow.loadURL + executeJavaScript 拿 #app innerText
   (稳定 3 轮 + length > 100,最大 30 秒)
       ↓
④ DOM 解析 → ParsedArticle(title/author/publishTime/contentHtml/imageUrls/...)
       ↓
⑤ 同次流程下载资源(图片直链 OSS 签名有时效,URL 不入库)
       ↓
⑥ 复用 wx-kit exporter: md/html/pdf/cover/meta
       ↓
⑦ 入 library.json(同源,按 sourceUrl 区分 mowen vs weixin)
```

**两条 meta 路径**（自动化选优）：
| 触发 | 路径 | 数据形态 |
|------|------|----------|
| 任意笔记（兜底）| BrowserWindow 渲染 | DOM innerText |
| 自己写的笔记 | `mocli --show-atom` 优先 | 完整 NoteAtom AST |

**新增核心模块**（参照 v0.10.0 `src/core/weread/` 模式 + 复用 `src/core/exporter/export-pdf.ts`）：
| 模块 | 用途 | 行数预估 |
|------|------|---------|
| `src/core/mowen/detect.ts` | `which mocli` / `where mocli` 启动期检测 | ~50 |
| `src/core/mowen/metadata.ts` | spawn `mocli` 拉元数据 + 笔记列表（`homepage` / `mine` / `search`） | ~80 |
| `src/core/mowen/browser-render.ts` | offscreen BrowserWindow 加载 + DOM 拿正文（**复用 spike-mowen-render.mjs 稳定轮询逻辑**） | ~150 |
| `src/core/mowen/atom-to-meta.ts` | mowen DOM / NoteAtom → ParsedArticle（含图片直链下载、音频/嵌入处理） | ~200 |
| `src/core/mowen/errors.ts` | `MocliNotFound` / `MocliFailed` / `RenderTimeout` / `EmptyContent` | ~40 |
| `src/core/download-article.ts` | URL 路由识别 `note.mowen.cn/detail/<id>` → 走 mowen 分支 | ~30 |
| `src/cli/mowen/` | `wx-kit mowen import / detect / list-mine / search` 命令 | ~300 |

**资源处理**（与 wx-kit 视频约束同源，已在 CLAUDE.md 钉）：
- **图片直链**：带 OSS Signature/Expires（**有时效**）—— 解析同次流程下完，**URL 不入库**。
- **音频**：嵌入到 md / html 视图，不下载为单独文件（内容不是格式；与微信视频同理）。
- **代码块**：shiki 输出保留 `<pre class="shiki">` 结构，md 保留语言标记。
- **嵌入（Embed）**：md 渲染为「引用笔记」链接块，html 保留结构。

**下载入口**：
- **GUI**：现有 URL 下载页直接接受 `note.mowen.cn/detail/<id>`，无需新 UI；复用现有「下载→结果→入库→阅读」闭环。
- **CLI 命令组 `mowen`**（四子命令）：
  - `wx-kit mowen import <note-id>` — 单篇拉取并入库（核心）
  - `wx-kit mowen detect` — 触发一次 mocli 检测并输出结果
  - `wx-kit mowen list-mine [--count N] [--filter priv|fee|pub|cond-pub]` — 透传 mocli 输出
  - `wx-kit mowen search --keyword K [--count N]` — 透传 mocli 输出

**落库**：同源入 `library.json`，复用 ArticleMeta + Library + 阅读器 + 导出（md/html/pdf/meta）。

**错误处理**（精简后）：
| 错误类型 | 含义 | UI 话术 |
|---------|------|--------|
| `MocliNotFound` | mocli 未安装或不可执行 | 「未检测到 mocli，请先安装：[命令]」（附平台命令） |
| `MocliFailed` | mocli 调用失败（鉴权/网络/限额） | 透传 `reason` + `msg`，前加「墨问请求失败」 |
| `RenderTimeout` | BrowserWindow 30 秒未稳定渲染 | 「墨问详情页渲染超时，可能网络异常」 |
| `EmptyContent` | 渲染成功但 `#app` 为空（私密/付费墙/风控） | 「该笔记内容不可见（私密/付费墙/被风控），无法下载」 |
| 解析警告 | 未识别节点类型、嵌入异常 | 进 `meta.json.warnings[]` + 卡片 ⚠ 标识（与 v0.10.6 已有的 M40 warnings 链路复用） |

**mocli 写命令不在 wx-kit 范围**：wx-kit 不调用 `mocli note create / edit / set / tag`，由 agent 用 mocli 直接处理。

### R3 · 启动检测 mocli 安装状态

**用户目标**：wx-kit 启动时自动知道 mocli 装没装，缺失时给清晰指引，不打扰用户。

**行为**：
- **触发**：主进程 `app.whenReady` 后**每次启动**做一次检测（`which mocli` / `where mocli`，不阻塞 UI）。
- **结果缓存**：写 settings（`mowen.mocliPath` / `mowen.mocliVersion` / `mowen.detectedAt`），UI 读缓存不重检。
- **设置页「墨问集成」区块**（新增）：
  - 已安装：显示路径 + 版本 + 「重新检测」按钮。
  - 未安装：显示「未检测到 mocli」+ 按平台安装命令（mac brew / npm）+ 跳转链接。
- **降级**：未安装时——
  - GUI URL 输入框识别 `note.mowen.cn/detail/<id>` 后 hover「未安装 mocli，请到设置页查看安装指引」，输入框禁用提交。
  - CLI `wx-kit mowen *` 命令报错出安装指引（不静默失败）。
- **不弹窗打扰**：所有提示只出现在设置页，不在主流程弹 Modal。

## 4. 交互约定

- **R1 操作可发现性**：右键菜单在卡片视图是发现性补充（与 hover 按钮并存）；列表视图操作列直接可见「📋 复制路径」按钮。**两端用户都能不查文档找到入口**。
- **R1 复制反馈**：1.5 秒自动消失的 toast（与现有 wx-kit toast 习惯一致）。
- **R2 进度反馈**：复用现有「下载→结果」闭环，状态消息统一走 `ProgressPhase`（不新增 phase）。
- **R2 渲染超时**：默认 30 秒（spike 验证稳定轮询 3 次 + 长度>100 的经验值），超时抛 `RenderTimeout`。
- **R2 入库后**：自动出现在文库（订阅页无入口，与微信文章同等待遇）。
- **R3 设置页入口**：设置页左侧导航新增「墨问集成」项；或挂在「关于」/「高级」下——以最少改动为准。
- **R3 检测缓存 TTL**：每次启动重检，不设 TTL（mocli 安装是低频事件，启动期一次检测开销可忽略）。

## 5. 非目标

- ❌ 不集成墨问 OpenAPI（spike #1 实测本机 ALB 503；即使网络通也是重复造客户端）。
- ❌ 不做墨问订阅 / 检查 / 动态 / 通知 UI（那是 mocli + skill 的事；wx-kit 只做下载）。
- ❌ 不做按墨问作者批量下载（v0.10.0 教训：列表接口服务端按账号封禁）。
- ❌ 不改 wx-kit 阅读器 UI（墨问笔记复用微信文章阅读器，渲染由 markdown/html 共用路径承担）。
- ❌ 不调用 mocli 的写接口（create / edit / set / tag）—— wx-kit 只读。
- ❌ 不做 cookie 复用 / 鉴权态管理（公开/会员可看无需；他人私密不在范围；spike #5 推论）。
- ❌ 不支持「他人私密笔记」（mowen 按作者授权，mocli 列表不返回，wx-kit 也无能为力）。
- ❌ 不引入 headless 浏览器（复用 wx-kit Electron Chromium，零新增依赖）。
- ❌ 不改 R1 多选批量复制路径（暂不需要，工具栏不加批量按钮）。
- ❌ 不迁移旧 library.json（墨问笔记首次入库，与微信文章同 library.json 自然共存；按 ArticleMeta.sourceUrl 区分来源）。
- ❌ 不做墨问 UI 入口到「订阅 / 检查 / 动态」—— 留给 mocli + skill。

## 6. 验收清单（逐条可勾）

### R1 · 复制保存路径

- [ ] 卡片视图：右键菜单显示「📋 复制路径」，点击后剪贴板含 `<libraryRoot>/<meta.dir>` 绝对路径，toast「已复制」（e2e + 单测）。
- [ ] 卡片视图：右键菜单与现有 hover「阅读/文件夹/删除」并存，不替换。
- [ ] 列表视图：操作列常驻「📋 复制路径」按钮，点击同上。
- [ ] 多选时只复制右键/按钮所在那篇（单测钉住「不与 sel 耦合」）。
- [ ] CLI 不变：`library list/search` 输出仍带 `dir`，无新增命令。

### R2 · 墨问笔记接入

- [ ] 启动期 `mocli` 检测失败抛 `MocliNotFound`（单测：mock `which` 失败）。
- [ ] URL 路由识别 `note.mowen.cn/detail/<id>` → 走 mowen 分支（单测：URL 解析 + 路由分发）。
- [ ] spawn `mocli note info --note-id <id>` 拉元数据（单测：mock spawn 输出）。
- [ ] 自己写的笔记：优先走 `mocli --show-atom` 拿完整 AST（单测：mock spawn AST 响应）。
- [ ] 公开/会员可看笔记：offscreen BrowserWindow 加载 → 30 秒内稳定轮询 → 拿到完整正文（单测：mock BrowserWindow + 模拟 DOM 响应；spike #4 验证）。
- [ ] DOM / NoteAtom → ParsedArticle 适配器（单测：含 image / audio / codeblock / embed 的样本）。
- [ ] 图片直链同次流程下完，URL 不入库（单测：meta.json 不含 imageUrl，仅有本地 path）。
- [ ] 音频嵌入 md/html（单测：md 含 `<audio>` / html 含 `<audio>` 标签）。
- [ ] shiki 代码块保留（单测：md / html 含 `<pre class="language-...">`）。
- [ ] 嵌入笔记保留（单测：md 含「引用笔记」块）。
- [ ] 错误分类：`MocliNotFound` / `MocliFailed` / `RenderTimeout` / `EmptyContent` 四类各一条单测钉死话术。
- [ ] 解析警告进 `meta.json.warnings[]`，卡片显示 ⚠（复用 v0.10.6 M40 链路）。
- [ ] 同源入 library.json：与微信文章共存，`sourceUrl` 区分来源。
- [ ] GUI URL 下载页：粘 `note.mowen.cn/detail/<id>` → 下载 → 入库 → 可在文库和阅读器中打开（e2e + 真机验证）。
- [ ] CLI `wx-kit mowen import <note-id>`：单篇拉取并入库，输出 JSON 契约同其他下载命令（e2e + 真机验证）。
- [ ] CLI `wx-kit mowen detect`：检测 mocli 安装状态并输出。
- [ ] CLI `wx-kit mowen list-mine --count N`：透传 mocli 输出 JSON。
- [ ] CLI `wx-kit mowen search --keyword K`：透传 mocli 输出 JSON。
- [ ] GUI 未安装时墨问 URL 输入框禁用 + hover提示（e2e）。
- [ ] **spike #4 回归**：无 cookie + offscreen BrowserWindow 渲染 `note.mowen.cn/detail/<id>` 能拿到完整正文（spike 脚本留库 `scripts/spike-mowen-render.mjs`，回归测试可复用）。

### R3 · 启动检测 mocli

- [ ] 主进程 `app.whenReady` 后每次启动检测一次 `mocli` 是否存在（单测：mock `which`）。
- [ ] 检测结果写 settings：`mowen.mocliPath` / `mowen.mocliVersion` / `mowen.detectedAt`。
- [ ] 设置页「墨问集成」区块显示当前状态（已安装：路径 + 版本 + 重新检测；未安装：安装指引）。
- [ ] 「重新检测」按钮立即触发一次检测并刷新 UI（单测 + e2e）。
- [ ] 未安装时墨问入口禁用（GUI 输入框 + CLI 命令均给出指引）。
- [ ] 检测失败/超时不影响 wx-kit 其他功能启动（隔离保护）。

### 集成 & 收尾

- [ ] `npm test`、`npm run lint`、`npx tsc --noEmit` 全绿。
- [ ] GUI e2e：`scripts/test:e2e` 全绿，含 R1/R2/R3 新断言。
- [ ] 真实墨问笔记端到端下载验收：含图片 / 音频 / 代码块 / 嵌入的笔记至少 1 篇，验证入库 + 阅读器渲染 + md/html 导出。
- [ ] README、wx-kit-skill、ROADMAP 同步刷新。
- [ ] 发版按规约走 feat 分支 → main → tag → GitHub Release + brew tap（npm 默认不发，安哥点名才发）。

---

## 7. 实现里程碑拆分（待 plan 阶段确认）

- **M59 · R1 复制保存路径**：卡片右键菜单 + 列表操作区按钮（独立小版本亦可）
- **M60 · R3 启动检测 + R2 元数据层**：mocli detect + metadata.ts + URL 路由 + CLI 骨架（先于渲染）
- **M61 · R2 渲染层 + GUI 集成**：browser-render.ts + atom-to-meta.ts + 图片本地化 + 错误处理 + 端到端下载闭环
- **M62 · R2/R3 验收打磨 + 文档同步**：e2e + 真机（公开笔记 + 自己笔记各 1）+ README/skill/ROADMAP 同步

具体 milestone 计划文档在 `docs/plans/2026-09-XX-mXX-*.md`（plan 阶段写）。

## 8. 参考资料

- **完整 spike 报告**：`docs/superpowers/spikes/2026-09-11-mowen-integration-feasibility.md`（合并 5 个 spike 的所有发现 + 失败推论 + 验证脚本）
- **历史 spike**：`docs/superpowers/spikes/2026-09-10-mowen-api-feasibility.md`（spike #1 API 直连失败的详细诊断，保留为历史）
- **spike 脚本**（留库，未来可重跑）：
  - `scripts/spike-mowen-api.mjs` — API 直连 + 自动 redact key
  - `scripts/spike-mowen-render.mjs` — offscreen BrowserWindow 渲染 + DOM 解析（30 行最小验证）
- **安哥身份锚定**：当前 mocli 认证用户 = `4L8RrxEaExmHJOf9xrGLo`（尼古拉-猴哥）— 这决定了「自己写的笔记」路径可用。