# wx-kit v0.6.0 产品需求文档（迭代 PRD）

> ⚠️ **状态:需求收集中**(2026-07-18 起)。安哥逐条报需求,本文档随之增补细化;**收集完毕、安哥确认启动后**才拆里程碑、写实现计划、开工。
> 实现计划(启动后):`docs/plans/`;状态/进度:`ROADMAP.md`。

## 1. 一句话定义

(待需求收集完毕后归纳)

## 2. 需求清单

### R1 · 文库默认按发布时间降序(2026-07-18 安哥)

**原始需求**:文库中的排序字段默认用「发布时间」,降序——最近发表的文章排最前面。

**细化**:

- 默认排序从「下载时间 · 降序」改为**「发布时间 · 降序」**(`Library.tsx` 的 `sortKey` 初始值 `download` → `publish`;方向已是 `desc` 不动)。
- 卡片视图排序下拉与列表视图表头箭头共享同一状态,默认态双视图一致:卡片下拉显示「发布时间 ↓」,列表表头「发布时间」列带 ↓。
- 分组视图组内排序同样生效(现状即共享排序状态,无额外改动)。
- **发布时间为空的文章**(个别解析不到发布时间的历史下载)保持现有语义:恒排末尾、与升降方向无关(`library-view.ts` 已实现,回归测试锁住)。
- 用户会话内手动切换排序照常自由,不受默认值影响。

- **排序选择跨会话记忆**(2026-07-18 安哥确认):用户切换的排序键/方向持久化到 settings(与列宽 `listColumnWidths`、分组展开态 `libraryExpandedGroups` 同一机制),重开应用保持上次选择;「发布时间 · 降序」是**从未动过排序时**的初始默认。

**验收(草)**:
- [ ] 全新安装/未动过排序时,进文库卡片与列表视图均按发布时间降序,最新发表在最前。
- [ ] 无发布时间的文章恒在末尾(升降序皆然)。
- [ ] 切换排序键/方向后重开应用,保持上次选择(卡片下拉与列表表头箭头一致体现)。

### R2 · 设置页增加「打开检查日志」入口(2026-07-18 安哥)

**原始需求**:「订阅」中的检查日志只显示最近的信息,在设置页增加一个直接查看检查日志文件的入口。

**现状梳理**:
- 订阅页「检查记录」页内只显示最近 **10** 条(存储保留 50 条);
- 落盘日志文件 `subscriptions-check.log`(userData 下)是**全量追加**、从不截断,每行含时间/触发方式/结果/失败明细(v0.5.4 起);
- 订阅页「下次预计检查」旁**已有**「打开日志文件」小字链接(`subscriptionsOpenLog`,系统默认程序打开)。

**细化**:
- 设置页「订阅」区块增加**「打开检查日志」**入口(按钮/链接),复用现有 `subscriptionsOpenLog` IPC,零新后端;
- 入口旁一句说明文案(如「完整检查历史,含每次失败原因」),让用户不用猜文件里有什么;
- 订阅页现有入口保留,但**提升可发现性**(实证:安哥用了一个多月不知道它存在——灰色小字缩在「下次预计检查」旁,2026-07-18 当面证实):至少改成可辨识的带图标链接/按钮样式,与设置页入口文案统一为「打开检查日志」。

**验收(草)**:
- [ ] 设置页订阅区可见「打开检查日志」入口,点击用系统默认程序打开日志文件。
- [ ] 日志文件不存在时(从未检查过)不报错——给出友好提示或入口置灰。
- [ ] 订阅页原入口行为不变。

### R3 · 完善 `wx-kit -h` 帮助信息(2026-07-18 安哥)

**原始需求**:执行 `wx-kit -h` 时的帮助信息,感觉提示的内容不全。

**现状实证**(2026-07-18 抓取):顶层 `-h` 列了 9 条命令,但存在以下「不全」:

1. **命令组不透出子命令**——`library` / `subscription` / `settings` 是命令组,顶层只显示一句描述(「文章库」「公众号订阅」「读写应用设置」),用户无从知晓其下还有 `list`/`search`/`remove`/`rebuild`/`export`、`list`/`check-now`、`get`/`set` 等子命令(要再跑 `library -h` 才看到)。
2. **缺双模式说明**——无参运行开 GUI、带子命令进 CLI,这是产品定位的核心,`-h` 完全没提。
3. **缺输出契约**——stdout 纯 JSON / stderr 进度 / 退出码 `0/1/2`(PRD §F4),agent 集成全靠它,`-h` 不告知。
4. **缺常见用法示例**——agent/人最常跑的几条(download / crawl / library list / settings get)无样例。
5. **缺位置信息**——库默认在 `~/Documents/wx-kit`、可在设置改。

**细化**:
- 顶层 `program.description` 扩写,含双模式一句话 + 输出契约一行。
- 命令组描述补一句「(子命令:list/search/…)」或在顶层 `afterHelp`/自定义帮助里把子命令清单附在主帮助之后。
- `program.addHelpText('afterHelp', ...)` 追加「常用示例」块(3–5 条真实命令)与「输出契约」(JSON/退出码)。
- 纯文案/帮助渲染改动,不动任何命令逻辑、不改输出 JSON 结构(`-h` 走 stdout 不影响 agent 解析路径)。

**验收(草)**:
- [ ] `wx-kit -h` 一屏内能让人理解:①这是什么工具(双模式)、②有哪些顶层命令及命令组各自的子命令、③输出契约、④至少几条常见用法。
- [ ] 各子命令 `wx-kit <cmd> -h` 保持 commander 默认行为,不受影响。
- [ ] `-h`/`--help`/`help` 输出一致、走 stdout、退出码 0。

### R4 · 命令行安装通道:npm / brew(2026-07-19 安哥)

**原始需求**:提供可以用 npm 或 brew 安装的版本,方便命令行安装——skill 要使用 wx-kit 时,发现未安装则直接跑安装命令,而不是要人工下载 dmg 安装,不利于自动化。

**目标还原**:真正要的不是「多一种安装方式」,而是**agent 自动化闭环**——skill 检测到 wx-kit 缺失 → 一条命令装好 → 继续干活,全程无人工。这是「双启动模式服务于 AI agent」定位的自然延伸。

**两条路线的可行性(均可行,服务不同场景)**:

| | **brew(自建 tap + cask)** | **npm(`npm i -g wx-kit`)** |
|---|---|---|
| 原理 | cask 指向 GitHub Release 的 dmg(URL + sha256),`brew install --cask monkeychen/wx-kit/wx-kit` | 包含构建产物(dist + dist-electron),`bin` 指向启动脚本,electron 作为依赖由 npm 装 |
| 装出来的东西 | 与手动安装完全相同的 .app(GUI+CLI 一体,wrapper 快捷命令照常) | 独立一份 electron + 应用代码,CLI 直用;GUI 也能开 |
| 平台 | 仅 macOS | mac / **Linux**(顺带补上当前没有的 Linux 支持)/ win |
| 体积 | dmg ~140MB(本来就要下) | electron 依赖 ~100MB+(国内需 ELECTRON_MIRROR,`.npmrc` 可内置提示) |
| 发版成本 | 每次 Release 后更新 tap 仓库里的版本号 + sha256(可脚本化进发版规约) | 每次 `npm publish`(可脚本化);**需确认 npm 包名 `wx-kit` 可用**,被占则换名(如 `@monkeychen/wx-kit`) |
| 免手动放行 | `--no-quarantine` 装未签名 app 不触发 Gatekeeper 手动放行——恰好解决现有痛点 | 不涉及(不走 Gatekeeper) |

**细化(暂定两条都做,轻重有别;最终范围安哥定)**:

1. **brew tap(主推,mac agent 场景)**:新建 `monkeychen/homebrew-wx-kit` 仓库放 cask;发版规约增加一步「更新 tap 的 url/sha256」(脚本化);README/skill 文档给出一条安装命令(含 `--no-quarantine` 说明)。
2. **npm 包(跨平台兜底,顺带 Linux)**:发布包含构建产物的包,`bin` 启动脚本按参数分流(与现有 `main.ts` 分流一致);处理 electron 国内镜像的安装引导;发版规约增加 `npm publish`。
3. **skill/agent 集成闭环**:`agent/wx-kit-compose`(及 README 的 agent 集成节)增加「检测 → 安装」样例:检测 `wx-kit` 命令不存在 → 按平台给出/执行安装命令。
4. 两条通道装出的版本都要能被现有 CLI 契约验证(`--version`、`download`、stdout JSON)。

**范围(2026-07-19 安哥确认):brew 与 npm 两条通道都做。**
- npm 包名已核实(2026-07-19 查 registry):**`wx-kit` 未被占用**,可直接用。

**验收(草)**:
- [ ] mac 全新环境:一条 brew 命令装好,`wx-kit --version`/`download` 直接可用,无手动放行。
- [ ] (若做 npm)`npm i -g` 后同上;Linux 上 CLI 可用。
- [ ] skill 文档含「未安装 → 自动安装」的检测与命令样例。
- [ ] 发版规约更新:发 Release 时同步刷新安装通道(tap sha256 / npm publish),并有真实安装验证步骤。

### R5 · session 跨机器导出/导入(2026-07-19 安哥)

**原始需求**:支持从别的机器导入 session。

**背景**:`wx-kit login` 是 CLI 唯一需要弹窗(扫码)的命令——headless/SSH/Linux 服务器环境无法完成;R4 落地 npm 通道后此矛盾会放大(服务器装得上、登录不了,`crawl`/订阅等依赖 session 的能力全不可用)。session 本体是 userData 下的单文件 `mp-session.json`(token + cookies + timestamp),文件级复制本就有效——本需求把它产品化。

**细化**:

- **CLI 一对命令**(命名倾向挂在既有鉴权语境下,与 `login`/`auth-status` 并列):
  - `wx-kit session export [--out <file>]`——把当前 session 复制到指定文件(默认 `./wx-kit-session.json`);无 session 时报错(退出码 1)。stdout JSON 含导出路径与提示。
  - `wx-kit session import <file>`——校验 JSON 结构(token/cookies 字段)→ 写入 userData →**立即做一次真探测**(`auth-status` 同款廉价请求)验证有效性;有效输出 `{ok:true, valid:true}`,失效如实输出 `valid:false`(文件仍导入,提示可能需重新扫码)。
- **安全边界**:session 即登录凭证。导出时 stdout/文档明确提醒「此文件等同登录态,勿提交仓库/勿传给不信任的环境」;导出文件权限 0600;文档建议用后即删。
- **典型工作流写入文档/skill**:mac(能扫码)`login` → `session export` → scp 到服务器 → 服务器 `session import` → agent 全自动跑 `crawl`/`subscription check-now`。与 R4 的 npm/Linux 通道形成完整闭环。
- **GUI 不做入口**(非目标):主场景是 agent/headless,GUI 用户直接扫码更顺;避免设置页堆低频功能。

**验收(草)**:
- [ ] A 机 `login` 后 `session export`;B 机 `session import` 后 `auth-status` 有效,`crawl` 可用(双机真机验证,B 机可用隔离 userData 模拟)。
- [ ] 导入非法文件(缺字段/非 JSON)报结构错误、退出码 2,不污染现有 session。
- [ ] 导入已过期 session:如实 `valid:false`,后续命令按既有 `AUTH_REQUIRED` 语义引导。
- [ ] 导出文件权限 0600;无 session 时导出报错退出码 1。

## 3. 里程碑拆分

(待需求收集完毕后拆分)

## 4. 非目标

(待需求收集完毕后明确)
