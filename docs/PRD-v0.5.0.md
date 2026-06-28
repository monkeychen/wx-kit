# wx-kit v0.5.0 产品需求文档（迭代 PRD）

> 本文件是 **v0.5.0 迭代**的需求源头与验收依据，建立在 `docs/PRD.md`（v0.1.0）及 `docs/PRD-v0.2.0.md`/`-v0.3.0.md`/`-v0.4.0.md` 之上。
> 「怎么做」见设计 spec `docs/superpowers/specs/2026-06-28-v0.5.0-cli-experience-design.md`；
> 逐里程碑实现计划见 `docs/plans/`；状态/进度见 `ROADMAP.md`；CLI 输出契约见 `docs/PRD.md` §F4。
> 刻意写精不写厚——本迭代真正的增量是 **§4 验收标准**（逐条可勾）。

## 1. 一句话定义

把 CLI 从「能被 agent 调」打磨到「顺手、自洽、与 GUI 同库」：补齐帮助/版本与分流、按「agent 用得到」补足 GUI 缺失的命令行入口、消除 CLI 与 GUI 默认操作不同库的隐性不一致，并在首次启动时引导用户为 `wx-kit` 建一个 PATH 软链，让安装后开箱即可在终端调用。

## 2. 目标与非目标

### 2.1 目标
- **帮助/版本可用**：`-h/--help`、`-v/--version` 与 `help`/`version` 入口都能用，且不再误进 GUI。
- **GUI/CLI 能力对齐（按需）**：以「agent 是否用得到」为尺，补 CLI 的文库搜/删、订阅看/查、设置读/写。
- **两模式同库**：CLI 各命令的库根默认回落到用户设置的 `libraryRoot`，消除 GUI 走设置、CLI 走硬编码导致的不同库。
- **首装即用**：macOS/Linux 首启引导建 `~/bin` PATH 软链（含不在 PATH 时引导写入 shell profile），一次性、不打扰。

### 2.2 非目标（v0.5.0 明确不做）
- **CLI 与 GUI 100% 镜像**——不补 agent 用不到的入口：下载历史 list/remove/clear、`readContent`（导出已给 content.md 路径）、`coverName`/`chooseDir`/`reveal`/`openLog`（GUI 专属）。
- **Windows 的 CLI 可达性 / 软链**——Windows CLI stdout 不回贴控制台尚无正解（ROADMAP 候选），本版软链只做 macOS+Linux，Windows 不弹提示、设置页入口隐藏。
- **`--version` 套 JSON**——版本输出裸 semver，遵全行业 CLI 惯例（agent 也好 parse），不为「stdout 必 JSON」破例。
- **mac 签名/公证、应用内更新**——延续既往非目标，需要时单议。

## 3. 功能需求

### R1 · 模式分流修复 + help/version（里程碑 M16）

设计依据见 spec「M16」节。

**需求**：
- 修 `electron/main.ts` 分流：`argv[0]` 是已知子命令 **或** `argv` 含 `-h/--help/-v/--version` **或** `argv[0]` 为 `help` → 进 CLI 模式；**无参 `wx-kit` 仍进 GUI**（首启引导依赖此，见 R3）。
- flag 与子命令都提供（commander 近零成本白送，不二选一）：`-v/--version` 输出**裸版本号**（如 `0.5.0`）；`-h/--help` 每层可用，顶层列出全部子命令与简介；`help [cmd]` 子命令查单命令用法。
- 输出去向：help/version 是用户主动查询 → **stdout**；仅报错触发的 usage → stderr（拆现状把两者都打到 stderr 的写法）。help/version 退出码 0。

### R2 · CLI 能力补齐（里程碑 M17）

设计依据见 spec「M17」节。

**需求**：
- 通则：输出纯 JSON 到 stdout（守 §F4）；凡涉及库根的命令，`--out` **默认回落 `settings.libraryRoot`**（消除 GUI/CLI 不同库），显式 `--out` 优先。
- **文库**：
  - `library search <keyword> [--account] [-o]` → `{ ok, items }`（复用 `Library.search`）。
  - `library remove --ids <csv> [-o]` → 删文件 + 对每 id `History.markDeleted`（与 GUI 删-史联动一致）→ `{ ok, removed }`；无 `--ids` 报错退 2。
- **订阅**：
  - `subscription list` → `{ ok, accounts, lastRunAt, nextCheckAt, authExpired }`（复用 GUI 同款合并逻辑）。
  - `subscription check-now` → 触发一次手动检查 → `{ ok, accounts, newFound, failed, note? }`；命中频控不重试；未登录返回 `note:'no-session'` 且 `ok:true`（与 GUI 一致，不算错误）。
- **设置**：
  - `settings get [key]` → 无 key 出全量 `AppSettings`；给 key 出 `{ ok, key, value }`；未知 key 退 2。
  - `settings set <key> <value>` → 校验 key 在白名单且值合法后写入 → 回写后的全量；非法退 2。白名单 = 用户可配置键（不含 GUI 布局 `listColumnWidths`）。
- **重构**：把 `runSubscriptionCheck`（及其依赖 `downloadRefs`/`establishWatermark`）从 `electron/ipc.ts` 闭包抽到 `electron/services/subscription-check.ts`，参数化 emit/log，ipc 与 cli 共用；属主进程服务层（可 import electron），**不放 `src/core/`**。

**存储影响**：无新增持久化文件/字段。CLI 改为读 `settings.json` 决定默认库根（行为变更：原硬编码 `~/Documents/wx-kit`）。

### R3 · 首启建 PATH 软链（里程碑 M18，macOS + Linux）

设计依据见 spec「M18」节。

**需求**：
- 新服务 `electron/services/cli-link.ts`：`status(dir)`（linked/unlinked/conflict，按是否为指向 `process.execPath` 的 symlink 判定）、`create(dir=~/bin)`、`pathHas(dir)`、`addToProfile(dir)`（按 `$SHELL` 选 `~/.zshrc`/`~/.bashrc`/兜底 `~/.profile`，幂等追加 `export PATH="$HOME/bin:$PATH"`）。
- **首启交互**（GUI）：平台 ∈ {darwin, linux} 且 `settings.cliLinkPrompted !== true` 且 `status(~/bin) !== 'linked'` → 弹一次性 Modal，文案目标导向并引导下一步；接受则 `create(~/bin)`，若 `~/bin` 不在 PATH 再问是否 `addToProfile` 并提示重开终端生效；conflict 时提示覆盖确认。**无论接受/忽略都置 `cliLinkPrompted=true`，不再每次弹**。
- **设置页**：新增「创建命令行快捷方式」按钮，显示当前 `status`、可随时重做（绕过 `cliLinkPrompted`）；Windows 上隐藏/置灰。
- **数据变更**：`AppSettings` 增 `cliLinkPrompted: boolean`（默认 `false`），走既有 `{...defaults, ...raw}` 合并，旧设置自动补默认。

## 4. 验收标准

### R1 / M16 · 分流修复 + help/version
- [ ] `wx-kit --version` 与 `wx-kit -v` 输出裸版本号（与 `package.json` 一致）到 **stdout**、退出码 0、不弹 GUI。
- [ ] `wx-kit --help` / `wx-kit -h` 输出全量帮助到 stdout、退 0、不弹 GUI；顶层帮助列出全部子命令及简介。
- [ ] `wx-kit help crawl` 输出 crawl 子命令用法。
- [ ] `wx-kit`（无参）仍打开 GUI。
- [ ] 报错触发的 usage 走 stderr、退出码非 0；help/version 不混入 stderr。
- [ ] `npm test` / `tsc` / `lint` 全绿。

### R2 / M17 · CLI 能力补齐
- [ ] `library search <kw>` 返回标题/正文命中 kw 的文章 JSON；叠加 `--account` 再过滤；不带 `--out` 时操作 `settings.libraryRoot`。
- [ ] `library remove --ids a,b` 删除对应文章目录与索引项，并使 `history` 中引用项标记为已删除；无 `--ids` 报错退 2。
- [ ] `subscription list` 输出账号列表/水位/上次检查/下次预计，与 GUI「订阅页」同源一致。
- [ ] `subscription check-now` 与 GUI「立即检查」产生一致的水位推进与日志落盘；命中频控不重试；未登录返回 `note:'no-session'`、`ok:true`。
- [ ] `settings get` 出全量、`settings get libraryRoot` 出单键；`settings set libraryRoot <x>` 后 `library list`（不带 `--out`）操作的是 `<x>`；非法 key/值退 2。
- [ ] `runSubscriptionCheck` 已抽到 `electron/services/`，ipc 与 cli 共用；GUI 订阅检查行为不回归。
- [ ] 新增命令输出均为纯 JSON（守 §F4，退出码 0/1/2）；纯逻辑（set 校验、订阅编排）TDD 覆盖；`npm test` / `tsc` / `lint` 全绿。

### R3 / M18 · 首启建 PATH 软链
- [ ] macOS 全新 userData 首启弹一次 Modal；接受后 `~/bin/wx-kit` 存在且为指向 `process.execPath` 的 symlink，`status` 返回 linked。
- [ ] `~/bin` 不在 PATH 时，接受写 profile 后对应 shell 文件幂等含 `export PATH="$HOME/bin:$PATH"`（重复操作不重复追加）。
- [ ] 忽略 Modal 后置 `cliLinkPrompted=true`，重启不再弹。
- [ ] 设置页「创建命令行快捷方式」按钮可重建并正确显示 `status`；conflict 时提示覆盖。
- [ ] Windows 上不弹 Modal、设置页入口隐藏；非 darwin/linux 不触发软链逻辑。
- [ ] `cli-link` 的 `status`/`pathHas`/`addToProfile` 纯逻辑 TDD（注入 fs/PATH/execPath、隔离临时 HOME）；`npm test` / `tsc` / `lint` 全绿。

## 5. 里程碑拆分

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M16** | 模式分流修复 + help/version flag 与子命令（R1） | ⏳ 待实现 |
| **M17** | CLI 补齐：文库 search/remove、订阅 list/check-now、设置 get/set + 默认同库 + 抽出订阅检查（R2） | ⏳ 待实现 |
| **M18** | 首启建 PATH 软链（macOS+Linux）+ 设置页入口（R3） | ⏳ 待实现 |

**顺序**：M16 先做（分流是后两者的前提，CLI 跑不起来谈不上补命令）→ M17（补能力、统一库根、抽订阅检查）→ M18（GUI 首启引导，独立于前两者，可并行但建议最后做以便引导文案引用已补齐的 CLI）。

## 6. 立场：CLI 服务于 agent（强约束）

- 补 CLI 的取舍尺子是**「AI agent 会不会用到」**，不是「GUI 有就镜像」——这是 CLI 输出纯 JSON、双启动模式的产品定位延续（见 AGENTS.md 已定决策）。据此本版补文库管理/订阅触发/设置脚本化,不补纯人看的历史浏览。
- 不为「stdout 必 JSON」「CLI 必镜像 GUI」这类教条牺牲惯例与体验：`--version` 出裸 semver、help 走 stdout，都是为顺手与可解析,而非形式自洽。
