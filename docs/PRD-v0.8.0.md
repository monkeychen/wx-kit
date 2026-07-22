# wx-kit v0.8.0 产品需求文档(迭代 PRD)

> **状态:已发布**(v0.8.0,2026-07-22)。R1–R4 完成并真机验证;**R5 当时判为完成实为误判,真正修复在 v0.8.1**(见下方 R5 的更正说明与 `docs/PRD-v0.8.1.md`)。发布说明 `docs/releases/v0.8.0.md`。
> 实现计划:`docs/plans/2026-07-22-m31.md`、`docs/plans/2026-07-22-m32.md`;状态/进度:`ROADMAP.md`。

## 1. 一句话定义

**让 agent 用得更顺、让内容流到该去的地方**——订阅可按号点检(R1)、文库一键同步到个人站点(R2)、CLI 列表按发布时间排好序(R3)、`-h` 给出仓库地址(R4),外加修掉 mac CLI 堆 dock 图标的老毛病(R5)。

## 2. 需求清单

### R1 · 订阅页支持单独检查某个公众号(2026-07-21 安哥)

**原始需求**:订阅页目前只有一个全量「检查更新」入口,想单独检查某个或某几个公众号有没有更新时没地方点。需要增加部分更新功能。

**现状核实**(2026-07-21):属实,但改动面比直觉小。

- UI 侧 `Subscriptions.tsx` 顶部一个「检查更新」按钮 → `api.subscriptionsCheckNow()`(无入参)→ IPC `subscriptions:checkNow` → `runSubscriptionCheck('manual')`,后者写死 `(await subs.list()).filter(a => a.subscribed)` 取**全部**已订阅号。
- **关键发现:核心 `checkSubscriptions(accounts, deps)` 本来就是「给哪些账号查哪些」**(入参 accounts 数组,串行 + 随机延迟的频控纪律跟着 accounts 走)。写死全量的是上层编排 + IPC + UI,不是核心。
- 故**核心逻辑不动**,只开「指定子集」的口子:编排层加 `fakeids?` 过滤、IPC 透传、UI/CLI 传参。频控纪律不变(子集照样串行 + 账号间随机延迟),水位推进 / 新文章处理(notify 或自动下载)与全量一致,只是没选中的号不动。检查日志「查 N 号」的 N 天然对得上(N = 本次实际查的号数)。

**交互选型(2026-07-21 安哥定:行内单号按钮)**:

与安哥当场论证了三种交互形态(行内单号按钮 / 多选批量「检查选中」/ 两者都做),选定**行内单号按钮**:

- 每个订阅号行尾加一个「检查」动作(与「下载 N 篇」「忽略」同级);顶部「检查更新」按钮文案改为**「检查全部」**(语义对照:全部 vs 单号)。
- 「查某个」:点该行[检查]——最高频场景零成本。
- 「查某几个」:逐行点[检查](串行排队、不并发,频控纪律不变)。不引入多选范式,订阅页保持简洁。

**细化方案**:

- **编排层**:`runSubscriptionCheck` 增可选 `fakeids?: string[]`;有则 `accounts.filter(a => fakeids.includes(a.fakeid))`,无则维持全量。`no-accounts` 分支语义改为「选中集合为空」(单号检查时若该号已退订等)。
- **in-flight 共享**:`checkInFlight` 守卫维持单例——行内单号检查与全量检查共享同一个 in-flight promise(并入语义,防同号并发加重频控;不同号并发也有整体 QPS 风险)。**正在跑时,行内 [检查] 与顶部 [检查全部] 一并置灰**;若用户点行内时已有全量在跑,并入(全量结果刷新后自然反映该号),不另起。
- **IPC**:`subscriptions:checkNow` 增可选 `fakeids?: string[]` 入参透传给编排层;`api.subscriptionsCheckNow(fakeids?)` 同步。
- **CLI**:`wx-kit subscription check-now` 增 `--accounts <fakeid,fakeid>`(agent/skill 场景;用户不知 fakeid,文档示例从 `subscription list` 取)。CLI 变更同步刷 `agent/wx-kit-skill/`(工作流第 7 条)。
- **日志**:`CheckLogEntry` 沿用 `accounts: N`(N = 本次实际查的号数),无需新字段;`trigger` 仍记 `manual`。可选:部分检查在 `note` 标注 `partial` 便于日志区分(实现时再定,不强制)。

**验收(草)**:

- [x] 订阅页每行有「检查」动作;点单号只查该号,水位推进、新文章按设置处理;未查的号不动。
- [x] 顶部按钮文案为「检查全部」,语义与行内单号对照;全量行为与改动前一致。
- [x] 正在跑检查时(无论全量还是单号),行内 [检查] 与顶部 [检查全部] 均置灰;结束后自动解禁并刷新。
- [x] CLI `wx-kit subscription check-now --accounts <fakeid,fakeid>` 只查指定号,输出 JSON 的 accounts 数为指定数;skill 文档同步。
- [x] 单号检查命中频控时,日志/弹窗如实记失败原因(与全量频控分支一致)。
- [x] 既有全量检查、自动检查、订阅下载全链路不受影响(单测 + e2e 全绿)。

### R2 · 文库「同步」到个人站点(2026-07-21 安哥)

**原始需求**:文库选中文章后,底部浮动指令区(已有「导出为素材」)增加「同步」指令——按个人站点(simiam.com「聊哉梦呓」,`/Users/chenzhian/workspace/ai/dreamble/site`)的发布规范生成文章目录及内容,写到目标目录(默认 `/Users/chenzhian/workspace/ai/dreamble/site/content/posts`)。纯个人需求,「同步」默认不可见,设置页加开关 + 目标目录配置。

**现状核实(2026-07-21,已通读 site 项目)**:

- site 是 Astro v7 纯静态站;文章规范在 `site/AGENTS.md` 与 `src/content.config.ts`。
- **目录规范**:`content/posts/YYYY-MM-DD-<slug>/index.md` + 图片与正文同目录相对引用(`./img-01.jpg`)。目录日期必须 = frontmatter `date`。slug 只含小写字母/数字/连字符(import 正则 `^[a-z0-9-]+$`)、全局唯一(URL 去日期,靠 slug 区分)。
- **frontmatter schema**(`content.config.ts`,strict——未知字段构建失败):`title`(必)、`date`(必,coerce date)、`summary?`、`tags[]`(default [])、`source?: 'wechat'`、`visibility?: 'public'|'unlisted'`(default public)、`draft?`(default false)。微信导入实际只写 `title/date/source` 三字段,其余 default。
- **关键事实:site 已有 `scripts/import-wechat.mjs`,且其「通道一」反向 spawn `wx-kit download` 抓文章**;转换逻辑(`scripts/lib/wechat.mjs` 的 `fromWxkit`/`buildIndexMd`/`imageFilename` + `import-storage.mjs` 的 `commitPostImport` 原子写入)全在 site 项目内。site 的 import 接受 URL、会重新抓取,不适合「从已下载文库直接同步」。

**架构选型(2026-07-21 安哥定:路径 A)**:

论证了「wx-kit 自实现 vs site 加从库入口 wx-kit 调」两条路,安哥选 **A:wx-kit 自己生成 site 文件**(自包含、不依赖 site 项目状态)。代价:转换逻辑与 site 双份维护,site 改 schema/转换规则 wx-kit 要跟(schema 稳定 + 三字段最小化,风险可控)。

**细化方案**:

- **核心层**(新增 `src/core/site-sync.ts`,纯函数可单测):
  - `buildSitePost(meta, contentMd, slug)`:输入 wx-kit 文章的 `meta.json` + `content.md` + 用户给的 slug,产出 `{ dirName, indexMd, imageFiles }`。
    - `title` / `date` 取自 `meta.json`(比正则解析 content.md frontmatter 可靠);`date` = `publishTime` 的 `YYYY-MM-DD`(安哥确认用 publishTime)。
    - 正文:从 `content.md` 去掉 frontmatter 段 + 去掉重复的首个 H1(site 已在 frontmatter 有 title)。
    - 图片路径改写:`]\(images/` → `](./`(wx-kit 子目录 → site 同目录)。
    - frontmatter 只写 `title / date / source: wechat` 三字段,严格对齐 schema。
    - `dirName` = `${date}-${slug}`。
  - `validateSlug(slug, existingSlugs)`:格式 `^[a-z0-9-]+$`、不以连字符开头/结尾、批量内唯一、不与目标目录已有 slug 冲突;违例返回具体原因。
  - `commitSitePost(postsRoot, post, imageSrcDir)`:复刻 site 的原子写入——写到同盘暂存目录(mkdtemp),写 index.md + 复制 images/,完整后 `rename` 到 `<postsRoot>/<dirName>`;失败 `rm` 暂存不留半成品(对齐 site `commitPostImport` 与 AGENTS.md「导入内容先暂存再原子移动」)。
  - slug 冲突(目标目录已有同名):**不覆盖**,该篇记失败(对齐 site import「slug 已存在则报错」);保守,不破坏已发布内容。
- **设置**(`AppSettings` 新增,均在设置页「站点同步」区块,开关默认关):
  - `siteSyncEnabled: boolean`(默认 `false`)——关时文库「同步」按钮完全不渲染(非置灰)。
  - `siteSyncPostsDir: string`(默认 `/Users/chenzhian/workspace/ai/dreamble/site/content/posts`)。
- **UI**(`Library.tsx`):
  - 底部浮动指令区(batch bar)在「导出为素材」旁加「⤴ 同步到站点」按钮,仅当 `siteSyncEnabled` 时渲染。
  - 点「同步」→ Modal 列出选中文章(标题 + publishTime),每行一个 slug 输入框(不预填,placeholder 示例 `nanxin-tech-analysis`)+ 顶部显示目标目录。提交前统一校验(格式 / 批量内唯一 / 与已有目录不冲突),违例行内标红报原因。逐篇生成(串行),结果汇总:成功 N(列目录路径)/ 失败 N(列原因:slug 冲突、缺 meta/content、写入错误等)。失败篇不阻断其他篇。
  - 同步成功后提示「下一步:到 site 跑 `npm run dev` 预览确认」(wx-kit 不自动跑 site 的 build/validate——不知道 site 根目录,职责止于写文件)。
- **CLI**(`wx-kit site sync`,新增 `site` 命令组预留扩展;复用核心层,输出契约同其他命令——stdout JSON、退出码 0/1/2):
  - 选料复用 `MaterialSelector`:`--ids <id,id>` / `--account <name>` / `--since <YYYY-MM-DD>` / `--all`(与 `library export` 一致)。
  - slug 来源(agent 自己给,不需交互):单篇 `--slug <slug>`;批量 `--slugs <id1=slug1,id2=slug2,...>`(id→slug 映射,避免位置对应错位)或 `--slugs-file <清单>`(每行 `<articleId> <slug>`,对齐 site import 的 `--file` 风格)。
  - 目标目录:`--posts-dir <dir>` 覆盖,否则读 `settings.siteSyncPostsDir`。
  - **不受 `siteSyncEnabled` 开关约束**(开关仅管 GUI 按钮可见性;CLI 是 agent 通道,目录配好即可用)。
  - 输出 `{ ok, postsRoot, succeeded, failed, results: [{id,title,slug,dir} | {id,slug,error}] }`;部分失败退出码 1(对齐 CLI 契约)。
- **skill 同步刷新**(工作流第 7 条):R1 的 `subscription check-now --accounts` 与 R2 的 `site sync` 都是新 CLI,实现后须同步 `agent/wx-kit-skill/`(速查表 + `references/commands.md` + `recipes.md`,后者给一个「library list → 选料 → 定 slug → site sync」的批量同步范例)。
- **频控/网络**:**纯本地文件操作,零网络**(图片已在 wx-kit 库里本地化,直接复制)。与微信频控无关。

**验收(草)**:

- [x] 设置页有「站点同步」开关(默认关)+ 目标目录(默认值正确);开关关时文库 batch bar 无「同步」按钮,开时出现。
- [x] 选 1 篇 → 填 slug → 同步:目标目录生成 `YYYY-MM-DD-<slug>/index.md`(frontmatter 仅 title/date/source,正文无重复 H1、图片引用为 `./img-*`)+ 图片复制到同目录。
- [x] 选 N 篇 → 逐行填 slug → 同步:批量串行生成,结果汇总准;slug 批量内重复 / 与已有目录冲突 / 格式非法 → 对应行标红报原因、不写入、不阻断其他篇。
- [x] 写入原子:模拟中途失败(如目标目录不可写),不留半成品目录(对齐 site 规范)。
- [x] 目录日期 = 文章 publishTime 的日期 = frontmatter date(三者一致,过 site `validate-content`)。
- [x] 生成的文章能过 site `npm run check`(schema strict + 目录日期一致 + slug 唯一)——**真机把同步产物落进 site 跑一次 `npm --prefix site run check`** 作为端到端验收。
- [x] CLI `wx-kit site sync --ids <id> --slug <slug>` 单篇生成目录(产物与 GUI 同);批量 `--slugs id1=s1,id2=s2`(或 `--slugs-file`)串行生成,stdout JSON 汇总准、退出码正确(全成 0 / 部分 1)。
- [x] CLI `site sync --account <name> --all` 等选料器与 `library export` 语义一致;slug 冲突/非法 → 该篇 error、退出码 1、不阻断其他篇。
- [x] `agent/wx-kit-skill/` 含 `site sync` 命令 + 批量同步范例(SKILL 速查表 / commands.md / recipes.md 三处)。
- [x] 既有文库/导出/阅读链路不受影响(单测 + e2e 全绿)。

### R3 · library CLI 增加排序(默认 publishTime 降序)(2026-07-22 安哥)

**原始需求 / 场景**:有一个 agent 场景是「每天获取所有公众号最近发布的文章清单」。随着文章增多,`library list` 等返回越来越大,需要让 agent 能拿到按发布时间排好的列表(最近在前),直接取前 N 篇即「最近文章」。

**现状核实(2026-07-22)**:`library list` / `library search` 当前**无排序参数**,返回的是索引顺序(`library.list()` 读 library.json 的写入序,不确定性,agent 本不该依赖)。GUI 早有完整排序(`src/renderer/library-view.ts` 的 `sortArticles`:`SortKey='download'|'publish'|'title'` + `SortDir='asc'|'desc'`,纯函数,含「空 publishTime 恒置末尾」边界),但**只在渲染层**,CLI 复制一份会双份维护。

**评估过程**:与安哥论证了「分页 / 过滤 / 字段选择 / 排序」四条——分页(limit/offset)投错对象(CLI 消费者是 agent,不翻页,要的是精准一次取够);字段选择(`--fields`)价值最高但当前规模 YAGNI;过滤已有一大半(`list --account` / `search <kw> --account` / `export --ids/--since/--account`)。**安哥定:本版只加排序(默认 publishTime desc)**,其余暂缓(`--top N` / `--fields` / 补过滤口径留待真痛时再议,非目标)。

**细化方案**:

- **抽共享**:`sortArticles` + `SortKey`/`SortDir` 从 `src/renderer/library-view.ts` 移到 `src/core/`(新建 `src/core/library-sort.ts`,或并入 `library.ts`)。`library-view.ts` 改从 core 引(re-export 保持渲染层 import 兼容)。**CLI 与 GUI 同一份排序逻辑**,不双份。属领域排序(非视图编排),放 core 更贴分层(`accountsOf`/`filterByAccount`/`groupByAccount` 是视图编排,留 renderer)。
- **CLI 参数**(`library list` 与 `library search` 都加,口径一致):
  - `--sort <publish|download|title>`:默认 `publish`(对应 `publishTime` 字段;短名对齐 GUI `SortKey`)。
  - `--order <asc|desc>`:默认 `desc`(安哥要的「最近在前」)。
  - 默认值即 `--sort publish --order desc`,agent 直接 `library list` 就是按发布时间降序,不必带 flag。
- **空 publishTime 恒置末尾**:与 GUI 一致——没发布时间的条目无论升降序都在最后(避免空值冒头)。CLI 复用同一函数天然对齐。
- **默认顺序变更(轻度 breaking)**:`library list` / `search` 的输出从「索引顺序」改为「publishTime 降序」。现状的索引顺序本身不确定、agent 不应依赖;新默认更可预期。PRD 显式标注,skill 文档与 recipes 同步说明。
- **skill 同步刷新**(工作流第 7 条):`list`/`search` 新增 `--sort`/`--order`,刷 `agent/wx-kit-skill/references/commands.md`;recipes 增「每天拉取所有公众号最近文章清单」范例(`library list` 取前 N 条)。

**验收(草)**:

- [x] `wx-kit library list` 默认按 publishTime 降序(最近在前);`--sort download` / `--sort title` / `--order asc` 均生效。
- [x] 空 publishTime 的条目在升降序下都排在最后(单测覆盖,与 GUI 同一断言)。
- [x] CLI 与 GUI 走同一 `sortArticles`(core 层),无重复逻辑;既有 GUI 排序行为零变化(单测 + e2e)。
- [x] `library search` 同样默认 publishTime 降序;`--account` 过滤与排序可组合。
- [x] skill `commands.md` 含 `--sort`/`--order`,recipes 含「每天最近文章清单」范例。

### R4 · `wx-kit -h` 帮助增加 GitHub 仓库地址(2026-07-22 安哥)

**原始需求 / 场景**:`wx-kit -h` 回显里加项目 GitHub 仓库地址,便于 agent 在需要时进一步去仓库读 `README.md`、issues、releases 等深入文档(skill 没覆盖到时自助查)。

**现状核实(2026-07-22)**:`src/cli/index.ts` 顶层 `program` 有 `description`(双模式 + 输出契约)+ `addHelpText('after')`(常用示例 + 库默认位置 + 「各命令详情:wx-kit help <命令>」)。**无仓库 URL**。`package.json` 有 `homepage: https://github.com/monkeychen/wx-kit`。

**细化方案**:

- 在 `addHelpText('after')` 末尾(「各命令详情」之后)追加一行:`仓库:https://github.com/monkeychen/wx-kit(可读 README.md / issues / releases 深入了解)`。
- **硬编码 URL 常量**(不动态读 `package.json` homepage):仓库地址永不变;运行时 cwd 不定、打包后 package.json 路径更复杂,为一个稳定常量做动态读取不划算。
- 只加在顶层 `-h`;子命令 help(`wx-kit help download`)不加——agent 从顶层 `-h` 拿到 URL 一次即可,子命令 help 重复 URL 是冗余。
- agent 用法:跑 `-h` 看能力概览 + 仓库 URL → 遇到 skill 没覆盖的细节,fetch 仓库 README/issues 自助。

**验收(草)**:

- [x] `wx-kit -h` 输出含仓库 URL `https://github.com/monkeychen/wx-kit` 与「可读 README/issues/releases」提示;出现在示例/help 指引之后。
- [x] 子命令 help(`wx-kit help <命令>`)不含该行(只在顶层)。
- [x] (可选)SKILL.md「第一步」附近顺手提一句 `-h 含仓库地址可自助深入」。

### R5 · 修 macOS 下 CLI 命令在程序坞冒独立图标(bug,2026-07-22 安哥)

**原始需求 / 现象**:macOS 上执行 wx-kit CLI 命令,程序坞出现一个独立应用图标,执行 N 次出现 N 个图标,「没法接受」。

**根因(2026-07-22 回源核实)**:`electron/main.ts` 第 23-33 行 CLI 分支——Electron 在 mac 是 GUI 子系统应用,进程一启动就在程序坞冒头(即使不开窗口)。CLI 分支复用了 Electron 进程(`downloadArticle` 的 PDF/fetch 依赖 BrowserWindow),**未调 `app.dock.hide()`**,所以每次 CLI 调用都冒一个 dock 图标,直到 `app.exit(code)` 进程退出才消失。GUI 分支正常(GUI 本就该在 dock 显示)。

**修复方案**:`main.ts` CLI 分支顶部(`isCliInvocation` 判定后、`app.whenReady()` 前)加 `app.dock?.hide()`。`app.dock` 只在 mac 存在,win/linux 是 `undefined`,可选链安全 no-op。放 `whenReady` 前是为了在 dock 图标完全显示前压住。GUI 分支零改动。

**影响面**:只影响**手动**在 mac 跑 CLI 的体验(dock 美观);**agent 自动化零影响**(agent 不看 dock);win/linux CLI 无此问题。

**验收(草)**:

> ⚠️ **本条验收在 v0.8.0 是错的,已于 v0.8.1 修正**(2026-07-22 安哥用正式版跑 `wx-kit -h` 当场复现)。
> `app.dock.hide()` 在 `whenReady()` 前调用**不生效**——AppKit 在 ready 前已把进程注册成 `Foreground` 并画了图标,
> 实测 `-h` 期间状态序列为 `NULL → Foreground → UIElement`(先出现、后隐藏)。
> 当时的验证用了跑 2–3 秒的 `download` 且延迟 2 秒才首次采样,**跳过了启动瞬间的窗口期**,是假阴性。
> 真正的修复(`LSUIElement` plist 层)与完整证据见 `docs/PRD-v0.8.1.md` R1。

- [~] mac 真机:连续跑 CLI 多次程序坞不出现图标 —— **v0.8.0 未达成**(图标先闪现后隐藏),v0.8.1 达成。
- [x] `wx-kit.app` 无参 GUI 启动 dock 图标正常显示。
- [x] win/linux CLI 不受影响(`app.dock` 仅 mac 存在)。**无自动化测试**:`main.ts` 的启动分流在 app 生命周期里跑,单测环境构造不出。
- [x] CLI 的 PDF 离屏窗口照常工作(dock 策略不影响 BrowserWindow)。

## 3. 里程碑拆分

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M31** | CLI/订阅增强与 bug 修复:R1 订阅部分检查 + R3 library 排序 + R4 `-h` 仓库 URL + R5 mac CLI dock 图标 | ✅ 2026-07-22 |
| **M32** | 站点同步:R2 文库「同步到站点」(core/site-sync + 设置开关 + GUI 批量 Modal + CLI `site sync`) | ✅ 2026-07-22 |

## 4. 非目标

- **多选批量「检查选中」**——交互选型时安哥未选(行内单号已覆盖「某几个」逐个点);若将来用户反馈逐个点太繁再议。
- **按订阅分组/标签批量检查**——目前订阅规模不大,无分组需求。
- **自动跑 site 的 build/validate/publish**——wx-kit 职责止于「按规范写文件到目标目录」;预览/校验/发布仍在 site 侧(`npm run dev`/`build`/`publish`),避免跨项目耦合与权限越界。
- **slug 自动生成**——中文标题无法可靠转合法英文 slug,site 规范也要求人工给定;批量逐行填(不预填无意义占位)。
- **同步前 frontmatter schema 预检**——首版靠字段稳定;若 site schema 演进导致漂移,作为已知约束在 devlog 标注、手动跟进。
