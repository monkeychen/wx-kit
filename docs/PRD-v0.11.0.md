# wx-kit v0.11.0 产品需求文档（迭代 PRD）

> R1 + R2 + R3 对应 M59+（2026-09-11 安哥拍板：R1 复制路径 + 墨问接入 + 启动检测 合并到 v0.11.0，原 v0.10.7 取消）。
> **R2 于 2026-09-11 晚按安哥新需求修订（第二版）**：从「单 URL 拉取」扩为「下载页新增墨问笔记 tab，按用户批量下载」；正文通道从「BrowserWindow 渲染」改为「`note/show` 匿名接口为主、BrowserWindow 渲染兜底」——依据安哥同日接口逆向探索（`dreamble/site/content/posts/2026-09-11-mowen-cli-exploration/`）与当日裸 curl 复验。
> 当前进度见 `ROADMAP.md`，验收以本文第 6 节为准。

## 1. 一句话定义

**文库内容源从「只下微信文章」扩到「也下墨问笔记」：下载页新增「墨问笔记」tab，按用户搜索→条件拉清单→勾选批量下载，逻辑与按公众号下载微信文章同构；URL tab 同时识别墨问笔记地址；复用统一文库与阅读器；启动时自动检测 mocli；文库单篇支持复制保存路径。**

## 2. 背景与已确认交互（2026-09-11 安哥拍板，R2 当日修订）

- 现状：wx-kit 只下微信文章；用户已订阅墨问想下到本地统一管理；agent 调用方有 mocli + 官方 skill，但 wx-kit 内核不识别墨问。
- **R1 复制路径**（原 v0.10.7 R1，已定稿并入本版）：用户/agent 经常需要「文库某篇本地路径」传给其他工具；当前缺单篇粒度入口。
- **R2 墨问接入（2026-09-11 晚修订版）**：
  - **需求形态**：整个逻辑与「按公众号下载微信文章」类似，只是内容源变成墨问——下载页新增「墨问笔记」tab：按用户名模糊搜索墨问用户 → 选中用户 → 按条件拉取该用户发表的笔记清单（默认全选）→ 下载选中笔记正文，格式由设置页指定。同时 URL 下载 tab 识别墨问笔记地址走墨问逻辑。
  - **发现层用 mocli（官方 OpenAPI 通道，已认证）**：`mocli user search --keyword` 模糊搜用户（昵称+简介）；`mocli notes homepage --uid <uid>` 按条件拉清单（`--filter all/album/fee/popular`、`--recent 1h-15d`、`--count 1-100`）。
  - **正文层主通道 = `note/show` 匿名接口**（安哥 2026-09-11 逆向发现，当日裸 curl 复验可用）：

    ```
    POST https://note.mowen.cn/api/note/wxa/v1/note/show
    Content-Type: application/json
    {"uuid": "<笔记ID>"}
    ```

    无任何凭证头即返回完整结构化 JSON：`noteBase.content`（正文 HTML）、`noteFile.images`（图片 uuid → OSS 签名 URL 映射，含 `scale.w_1200` 规格）、`noteStat`（阅读/点赞等计数）、`noteFlag`、`user.base`（作者）。相比 BrowserWindow 渲染：无需等 SPA 稳定（30s 超时窗）、直接拿到结构化 HTML 与图片映射、附统计数据。
  - **正文层兜底 = offscreen BrowserWindow 渲染**（spike #4 已验证，无 cookie 拿公开笔记全文）：`note/show` 失效/加风控时降级使用。
  - **自己写的私密笔记**：`mocli note info --show-atom` 拿完整 AST（仅自己笔记生效，spike #2），作为第三条补充路径。
  - **不集成墨问 OpenAPI 直连**：spike #1 实测 wx-kit 直连 `open.mowen.cn` 被阿里云 ALB 持续 503（网络层问题）；且 `--show-atom` 限自己笔记，API 通道本就给不了他人全文。
  - **为什么「按作者批量」在墨问可做、与微信教训不冲突**：微信列表接口是私有后台接口、被服务端按账号封禁（AGENTS.md 钉死，勿接回）；墨问 `notes homepage` 是**官方 OpenAPI 能力**（mocli 包装、走正式鉴权），正文 `note/show` 是**公开分享页自用的匿名接口**（网页端产品刚需）。两者性质不同，不构成对 M49 原则的违背——原则针对私有接口，墨问两条通道一个是官方 API、一个是公开渲染管线。
  - **风险如实记录**：`note/show` 是民间逆向接口、无官方 SLA，可能加登录/频控（等级：高）。应对：限速 0.5s/篇 + 0.3s/图；失败率监控；BrowserWindow 兜底已验证。
  - **付费笔记**：`note/show` 返回 `400 ASSET_NOT_FOUND`（付费墙在服务端）。按宪法「失败必须保留失败类型」——抛明确错误、UI 标注「付费笔记匿名不可读」，**不得伪装成功、不做绕过尝试**（也绕不过）。
- **mocli 检测**（R3）：每次启动 wx-kit 主进程做一次检测，结果写 settings 缓存，UI 不打扰（设置页常驻显示）。
- **mocli 缺失时**：墨问入口禁用（GUI tab 与 URL 输入框提示、CLI `mowen` 命令报错出指引），不阻塞其他功能。
- **CLI 范围**：`wx-kit mowen import / detect / list-user / search-user / list-mine / search`；写命令（create / edit / set / tag）不在 wx-kit 范围内（那是 agent 用 mocli 直接做的事）。

## 3. 需求清单

### R1 · 文库每篇文章复制保存路径

**用户目标**：文库页面每篇文章能一键拿到本地保存路径，粘给其他工具或 agent 使用。

**行为**：
- 复制内容 = 该篇文章的**目录绝对路径**（一行），即 `meta.dir`（本身就是绝对路径，见 `src/core/types.ts:39`，M59 实现时核实修正——无需拼接 `<libraryRoot>/`，Windows 天然正确）。下含 md/html/pdf/cover/meta，粘到 Finder 可见全部格式。
- **卡片视图**：右键菜单加「📋 复制路径」一项，与现有 hover「阅读/文件夹/删除」按钮**并存**（不替换）。
- **列表视图**：操作列加常驻「📋 复制路径」按钮，与「阅读/文件夹/删除」并列。
- 多选时只复制右键/按钮所在的那一篇，**不**新增工具栏批量复制按钮。
- 反馈：成功 `message.success('已复制')`，失败 `message.error('复制失败：' + msg)`。
- **CLI 不动**——`library list/search` 已输出 `dir`，agent 自拼绝对路径。

### R2 · 墨问笔记接入

**用户目标**：在 wx-kit 里像管微信文章一样管墨问笔记——按用户批量下载、单 URL 下载，统一进文库，复用阅读器与导出。

#### R2a · 下载页「墨问笔记」tab（按用户批量）

**交互流程**（与已隐藏的按公众号批量页 M3.5 同构，组件骨架优先复用）：

```
① 搜索用户：输入关键词 → mocli user search --keyword（模糊匹配昵称+简介）
   → 候选列表（昵称 / 简介 / UID），用户辨认选中本尊
        ↓
② 条件查询：选中用户后设置条件，调 mocli notes homepage --uid <uid>
   - 类型筛选 --filter：全部 all / 合集 album / 付费 fee / 热门 popular（默认 all）
   - 时间范围 --recent：24h / 3d / 7d / 15d 档位（默认 7d）
   - 数量 --count：默认 20，上限 100
        ↓
③ 清单展示：标题 / 发布时间 / 字数 / 类型标记（付费 🔒 等），**默认全选**，可逐条勾选/全不选
        ↓
④ 下载选中：串行下载，逐篇进度可见（复用现有批量下载进度 UI 模式）
   - 下载格式由设置页指定（与 digest --download 的「--formats 缺省跟设置走」一致）
   - 已在文库的跳过（按 noteId 判重），清单如实标注「文库已有」
        ↓
⑤ 入 library.json，与微信文章同源共存，sourceUrl 区分来源
```

#### R2b · URL tab 识别墨问地址

- 现有「按 URL 下载」输入框识别 `note.mowen.cn/detail/<id>`（也接受裸 noteId）→ 走墨问单篇下载分支。
- 与微信文章 URL 下载共用同一「下载→结果→入库→阅读」闭环，无需新 UI。

#### R2c · 正文获取（三条路径，自动化选优）

| 优先级 | 路径 | 适用 | 数据形态 |
|--------|------|------|---------|
| 1 | `note/show` 匿名接口 | 公开笔记（主通道） | 结构化 JSON：HTML 正文 + 图片映射 + 统计 |
| 2 | `mocli --show-atom` | 自己写的笔记（含私密） | 完整 NoteAtom AST |
| 3 | offscreen BrowserWindow 渲染 | 兜底（接口失效时） | DOM innerText + 解析 |

- 路径选择逻辑：自己笔记（uid 匹配 mocli 认证身份）优先 `--show-atom`；其余一律 `note/show`；`note/show` 连续失败（接口变更信号）自动降级 BrowserWindow 并给出 warning。
- **图片处理**：正文 HTML 中图片为 `<img uuid="xxx">`（无 src），按 `noteFile.images[uuid]` 映射取 `scale.w_1200` 规格 URL 下载落地，md/html 引本地相对路径；**OSS 签名 URL 约 7 天过期，同次流程下完、URL 不入库**（与微信视频同坑，AGENTS.md 已钉）。无图笔记 `noteFile` 为 `null`（2026-09-11 实测边界），解析器不得按缺省对象处理。
- **音频**：嵌入到 md / html 视图（`<audio>` 标签引远程地址），不下载为单独文件（内容不是格式，与微信视频同理）。
- **代码块**：保留 `<pre>` 结构与语言标记。
- **付费笔记**：`note/show` 返回 `400 ASSET_NOT_FOUND` → 抛 `MowenNoteUnavailable(paid)`，清单与结果区如实标注「付费笔记匿名不可读」，**不伪装成功、不产出空文件**。
- **限速**：笔记间隔 0.5s、图片间隔 0.3s（安哥探索经验值），温和请求保通道。

#### R2d · CLI 命令组 `mowen`

| 命令 | 用途 |
|------|------|
| `wx-kit mowen import <note-id...>` | 单篇/多篇拉取并入库（核心） |
| `wx-kit mowen import --uid <uid> [--recent 7d] [--count 20] [--filter all]` | 按用户批量（list + download 一体，对应 GUI tab 流程） |
| `wx-kit mowen detect` | 触发一次 mocli 检测并输出结果 |
| `wx-kit mowen list-user --uid <uid> [--recent] [--count] [--filter]` | 只列清单不下载（透传 homepage 输出） |
| `wx-kit mowen search-user --keyword K` | 模糊搜用户（透传 user search 输出） |
| `wx-kit mowen list-mine [--count N] [--filter priv\|fee\|pub\|cond-pub]` | 透传 mocli 输出 |
| `wx-kit mowen search --keyword K [--count N]` | 全站关键词搜笔记（透传 mocli 输出） |

**新增核心模块**（参照 v0.10.0 `src/core/weread/` 模式）：

| 模块 | 用途 | 行数预估 |
|------|------|---------|
| `src/core/mowen/detect.ts` | `which mocli` / `where mocli` 启动期检测 | ~50 |
| `src/core/mowen/metadata.ts` | spawn `mocli`：user search / homepage 清单 / note info / --show-atom | ~150 |
| `src/core/mowen/note-show.ts` | `note/show` 匿名接口调用（经 gateway 域名路由 + 限速） | ~120 |
| `src/core/mowen/browser-render.ts` | offscreen BrowserWindow 兜底渲染（复用 spike-mowen-render.mjs 稳定轮询逻辑） | ~150 |
| `src/core/mowen/mowen-to-article.ts` | note/show JSON / NoteAtom / DOM → ParsedArticle（含图片本地化、音频/代码块/嵌入处理） | ~250 |
| `src/core/mowen/errors.ts` | `MocliNotFound` / `MocliFailed` / `MowenNoteUnavailable` / `RenderTimeout` / `EmptyContent` | ~50 |
| `src/core/download-article.ts` | URL 路由识别 `note.mowen.cn/detail/<id>` → 走 mowen 分支 | ~30 |
| `src/cli/mowen/` | 上述七个子命令 | ~350 |
| `src/renderer/` 墨问 tab | 搜用户 → 条件 → 清单 → 批量下载（复用批量页骨架） | ~400 |

**错误处理**：

| 错误类型 | 含义 | UI 话术 |
|---------|------|--------|
| `MocliNotFound` | mocli 未安装或不可执行 | 「未检测到 mocli，请先安装：[命令]」（附平台命令） |
| `MocliFailed` | mocli 调用失败（鉴权/网络/限额） | 透传 `reason` + `msg`，前加「墨问请求失败」 |
| `MowenNoteUnavailable` | 付费墙 / 笔记不可见（ASSET_NOT_FOUND 等） | 「该笔记不可匿名获取（付费/私密），无法下载」 |
| `RenderTimeout` | BrowserWindow 30 秒未稳定渲染（兜底路径） | 「墨问详情页渲染超时，可能网络异常」 |
| `EmptyContent` | 渲染/接口成功但正文为空（风控/接口变更信号） | 「未取到正文内容（可能被风控或接口变更），无法下载」 |
| 解析警告 | 未识别节点类型、图片下载失败等 | 进 `meta.json.warnings[]` + 卡片 ⚠ 标识（复用 M40 warnings 链路） |

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
  - GUI 墨问 tab 整页显示安装指引（不灰死，引导优先）；URL 输入框识别墨问地址后提示「未安装 mocli，请到设置页查看安装指引」，禁用提交。
  - CLI `wx-kit mowen *` 命令报错出安装指引（不静默失败）。
- **不弹窗打扰**：所有提示只出现在设置页与对应入口，不在主流程弹 Modal。

## 4. 交互约定

- **R1 操作可发现性**：右键菜单在卡片视图是发现性补充（与 hover 按钮并存）；列表视图操作列直接可见「📋 复制路径」按钮。**两端用户都能不查文档找到入口**。
- **R1 复制反馈**：1.5 秒自动消失的 toast（与现有 wx-kit toast 习惯一致）。
- **R2a 清单默认全选**：安哥拍板——拉清单的意图就是批量下载，默认全选、可反选；「已在文库」的条目默认不选并标注。
- **R2 进度反馈**：批量与单篇都复用现有「下载→结果」闭环，状态消息统一走 `ProgressPhase`（不新增 phase）。
- **R2 下载格式**：批量与单篇的默认格式都跟设置页走（与 digest `--download` 一致，不硬编码缺省）。
- **R2 渲染超时**（兜底路径）：默认 30 秒（spike 验证稳定轮询 3 次 + 长度>100 的经验值），超时抛 `RenderTimeout`。
- **R2 限速**：笔记 0.5s/篇、图片 0.3s/张，写死在 core 层，不提供关闭开关。
- **R2 入库后**：自动出现在文库（订阅页无入口，与微信文章同等待遇）。
- **R3 设置页入口**：设置页左侧导航新增「墨问集成」项；或挂在「关于」/「高级」下——以最少改动为准。
- **R3 检测缓存 TTL**：每次启动重检，不设 TTL（mocli 安装是低频事件，启动期一次检测开销可忽略）。

## 5. 非目标

- ❌ 不集成墨问 OpenAPI 直连（spike #1 实测本机 ALB 503；且 `--show-atom` 限自己笔记，API 给不了他人全文）。
- ❌ 不做墨问订阅 / 检查 / 动态 / 通知 UI（那是 mocli + skill 的事；wx-kit 只做下载）。
- ❌ 不做「他人私密笔记」（mowen 按作者授权，mocli 列表不返回，note/show 也无从触达）。
- ❌ 不做付费笔记绕过尝试（付费墙在服务端；明确失败、如实标注，不伪装成功）。
- ❌ 不改 wx-kit 阅读器 UI（墨问笔记复用微信文章阅读器，渲染由 markdown/html 共用路径承担）。
- ❌ 不调用 mocli 的写接口（create / edit / set / tag）—— wx-kit 只读。
- ❌ 不做 cookie 复用 / 鉴权态管理（note/show 匿名可用；自己私密笔记走 mocli 已认证通道）。
- ❌ 不引入 headless 浏览器（兜底渲染复用 wx-kit Electron Chromium，零新增依赖）。
- ❌ 本版不做 PDF 附件下载；音频不落地仅嵌入（安哥探索文章中期建议，后续单议）。
- 合集（album）处理（2026-09-12 安哥拍板，替代原「不做合集递归」非目标）：**引用块如实呈现 + 递归下载为显式开关（默认关）**——合集头部正文照常下载，正文尾部渲染「引用笔记」块（子笔记 detail 链接）；「展开引用子笔记」勾选/`--expand-refs` 开着才递归下载子笔记（逐个 note/show，限速同主流程，子笔记付费墙如实 unavailable）。不做隐式默认递归（勾 3 篇下 17 篇是意外，不是功能）。
- ❌ 不改 R1 多选批量复制路径（暂不需要，工具栏不加批量按钮）。
- ❌ 不迁移旧 library.json（墨问笔记首次入库，与微信文章同 library.json 自然共存；按 ArticleMeta.sourceUrl 区分来源）。

## 6. 验收清单（逐条可勾）

### R1 · 复制保存路径（M59 已完成 2026-09-11）

- [x] 卡片视图：右键菜单显示「📋 复制路径」，点击后剪贴板含 `<libraryRoot>/<meta.dir>` 绝对路径，toast「已复制」（e2e + 单测）。
- [x] 卡片视图：右键菜单与现有 hover「阅读/文件夹/删除」并存，不替换。
- [x] 列表视图：操作列常驻「📋 复制路径」按钮，点击同上。
- [x] 多选时只复制右键/按钮所在那篇（单测钉住「不与 sel 耦合」）。
- [x] CLI 不变：`library list/search` 输出仍带 `dir`，无新增命令。

### R2 · 墨问笔记接入

> 验收分段：R2d CLI 五命令（M60 已完成，见下文「R2d」段）；R2a/R2b/R2c 随 M61。

**R2a 墨问 tab（按用户批量）**：

- [ ] tab 内按关键词搜用户：调 `mocli user search`，候选列表显示昵称/简介/UID（单测：mock spawn 输出；e2e）。
- [ ] 选中用户后按条件拉清单：filter / recent / count 正确透传 `mocli notes homepage --uid`（单测：参数拼装逐条钉死）。
- [ ] 清单展示标题/时间/字数/类型标记，**默认全选**；「文库已有」条目默认不选并标注（单测 + e2e）。
- [ ] 下载选中：串行执行、逐篇进度可见、可取消（复用批量进度模式；e2e）。
- [ ] 下载格式跟设置页指定走（单测：缺省不硬编码）。
- [ ] 未安装 mocli 时 tab 显示安装指引（e2e）。

**R2b URL 识别**：

- [ ] URL 路由识别 `note.mowen.cn/detail/<id>` 与裸 noteId → 走 mowen 分支（单测：URL 解析 + 路由分发）。
- [ ] GUI URL 下载页：粘墨问笔记 URL → 下载 → 入库 → 文库与阅读器可打开（e2e + 真机验证）。
- [ ] 合集引用块：含 noteRef 的笔记下载后，md/html 尾部渲染「引用笔记」块（标题 + 作者 + detail 链接），清单条目标「含引用」标记（单测：真机合集样本裁剪）。
- [ ] 递归下载为显式开关：GUI「展开引用子笔记」子勾选（默认关）+ CLI `--expand-refs`；开启后子笔记逐个下载、判重跳过、付费子笔记如实 unavailable（单测：链式引用 + 付费子篇）。

**R2c 正文通道**：

- [ ] `note/show` 主通道：匿名 POST 拿到 `noteBase.content` / `noteFile.images` / `noteStat`（单测：mock 响应；真机复验脚本可重跑）。
- [ ] 自己写的笔记：优先走 `mocli --show-atom` 拿完整 AST（单测：mock spawn AST 响应 + uid 匹配逻辑）。
- [ ] BrowserWindow 兜底：`note/show` 连续失败自动降级，渲染 → 30 秒内稳定轮询 → 拿到正文（单测：mock BrowserWindow；spike #4 回归）。
- [ ] 图片：`<img uuid>` 按 `noteFile.images` 映射下载 `scale.w_1200` 落地，md/html 引本地路径，meta.json 不含远程图片 URL（单测）。
- [ ] 无图笔记 `noteFile: null` 边界不炸（单测：2026-09-11 实测样本形态）。
- [ ] 音频嵌入 md/html（单测：md 含 `<audio>` / html 含 `<audio>` 标签）。
- [ ] 代码块保留 `<pre>` 结构与语言标记（单测）。
- [ ] 付费笔记 `ASSET_NOT_FOUND` → 抛 `MowenNoteUnavailable`，结果区如实标注，**无空文件产出**（单测钉死话术）。
- [ ] 限速生效：core 层 0.5s/篇、0.3s/图（单测：mock 时钟断言间隔）。
- [ ] 错误分类：`MocliNotFound` / `MocliFailed` / `MowenNoteUnavailable` / `RenderTimeout` / `EmptyContent` 各一条单测钉死话术。
- [ ] 解析警告进 `meta.json.warnings[]`，卡片显示 ⚠（复用 M40 链路）。
- [ ] 同源入 library.json：与微信文章共存，`sourceUrl` 区分来源。

**R2d CLI**：

- [ ] `wx-kit mowen import <note-id>`：单篇拉取并入库，输出 JSON 契约同其他下载命令（e2e + 真机验证）。
- [ ] `wx-kit mowen import --uid <uid> --recent 7d --count 20`：按用户批量入库（e2e + 真机验证）。
- [ ] `wx-kit mowen detect`：检测 mocli 安装状态并输出。
- [ ] `wx-kit mowen list-user --uid <uid>` / `search-user --keyword K` / `list-mine` / `search --keyword K`：透传输出 JSON。

### R3 · 启动检测 mocli（M60 已完成 2026-09-11）

- [x] 主进程 `app.whenReady` 后每次启动检测一次 `mocli` 是否存在（单测：mock which/where）。
- [x] 检测结果写 settings：`mowenMocliPath` / `mowenMocliVersion` / `mowenDetectedAt`（扁平键，M60 实现时定名）。
- [x] 设置页「墨问集成」区块显示当前状态（已安装：路径 + 版本 + 重新检测；未安装：安装指引）。
- [x] 「重新检测」按钮立即触发一次检测并刷新 UI（IPC `mowen:detect`；单测 + e2e）。
- [x] 未安装时墨问入口禁用/引导（CLI `mowen *` 五命令统一前置检测并出指引，exit 1；GUI tab 属 M61）。
- [x] 检测失败/超时不影响 wx-kit 其他功能启动（隔离保护：fire-and-forget + 全量 try/catch）。

### R2d · CLI（detect / list-user / search-user / list-mine / search，M60 已完成；import 随 M61）

- [x] `wx-kit mowen detect`：检测 mocli 安装状态 + 认证身份（moUid）并输出（真机验收）。
- [x] `wx-kit mowen list-user --uid <uid>`（--filter/--recent/--count 透传，真机验收）。
- [x] `wx-kit mowen search-user --keyword K`（真机验收；空 keyword → `MOCLI_FAILED/VALIDATE` 如实透传）。
- [x] `wx-kit mowen list-mine`（真机验收，返回自己的含私密笔记）。
- [x] `wx-kit mowen search --keyword K`（真机验收）。
- [ ] `wx-kit mowen import <note-id>`：单篇拉取并入库（M61，随正文通道）。

### 集成 & 收尾

- [ ] `npm test`、`npm run lint`、`npx tsc --noEmit` 全绿。
- [ ] GUI e2e：`scripts/test:e2e` 全绿，含 R1/R2/R3 新断言。
- [ ] 真实墨问笔记端到端验收：① 按用户批量（含付费笔记 1 篇验证如实标注）；② 含图片/音频/代码块的笔记至少 1 篇，验证入库 + 阅读器渲染 + md/html 导出；③ 自己私密笔记 1 篇走 `--show-atom`。
- [ ] README、wx-kit-skill、ROADMAP 同步刷新。
- [ ] 发版按规约走 feat 分支 → main → tag → GitHub Release + brew tap（npm 默认不发，安哥点名才发）。

---

## 7. 实现里程碑拆分（待 plan 阶段确认）

- **M59 · R1 复制保存路径**：卡片右键菜单 + 列表操作区按钮（独立小版本亦可）
- **M60 · R3 启动检测 + mocli 封装层 + 发现链路**：detect.ts + metadata.ts（user search / homepage / note info / --show-atom）+ URL 路由 + CLI 骨架（detect / list-user / search-user / list-mine / search）
- **M61 · 正文通道 + GUI 墨问 tab + 批量闭环**：note-show.ts + browser-render.ts 兜底 + mowen-to-article.ts（图片本地化）+ 墨问 tab（搜用户→条件→清单→批量下载）+ `mowen import`
- **M62 · 验收打磨 + 文档同步**：e2e + 真机（按用户批量含付费标注 / 富媒体笔记 / 自己私密笔记）+ README/skill/ROADMAP 同步

具体 milestone 计划文档在 `docs/plans/2026-09-XX-mXX-*.md`（plan 阶段写）。

## 8. 参考资料

- **安哥接口逆向探索（R2 修订直接依据）**：`dreamble/site/content/posts/2026-09-11-mowen-cli-exploration/index.md`——note/show 匿名接口完整逆向过程、响应结构、图片机制、限速经验值、风险表。
- **完整 spike 报告**：`docs/superpowers/spikes/2026-09-11-mowen-integration-feasibility.md`（5 个 spike + note/show 增补，含失败推论与验证脚本）。
- **历史 spike**：`docs/superpowers/spikes/2026-09-10-mowen-api-feasibility.md`（spike #1 API 直连失败的详细诊断，保留为历史）。
- **mocli 官方仓库**：https://github.com/mowenxd/cli（命令全集见安哥探索文章 §2.2）。
- **spike 脚本**（留库，未来可重跑）：
  - `scripts/spike-mowen-api.mjs` — API 直连 + 自动 redact key
  - `scripts/spike-mowen-render.mjs` — offscreen BrowserWindow 渲染 + DOM 解析（兜底路径回归用）
- **安哥身份锚定**：当前 mocli 认证用户 = `4L8RrxEaExmHJOf9xrGLo`（尼古拉-猴哥）— 这决定了「自己写的笔记」`--show-atom` 路径可用。
