# wx-kit — 路线图与状态

> 项目进度的「状态板」,只放**可扫读的状态**:当前版本、里程碑目录、版本发布史、下一步。
> `AGENTS.md` 是稳定的宪法(决策/不变量/陷阱);**实现细节看 `docs/plans/`,决策/踩坑复盘看 `docs/devlog/wx-kit-vibe-coding.md`,逐条需求/验收看各 `docs/PRD*.md`,不可变快照看 git tag**。本文件不复述这些,只给指针。

## 当前状态

- **最新发布:v0.5.3(2026-07-13,修复 macOS 关窗后程序坞无法重开窗口)** —— tag `v0.5.3` + GitHub Release(三平台安装包,标 Latest)已发。范围:M21 补注册 `app.on('activate')` 重建主窗口(关窗驻留后点程序坞图标此前无响应,应用假死)。需求/验收 `docs/PRD-v0.5.3.md`,计划 `plans/2026-07-13-m21-dock-reactivate.md`,发布说明 `docs/releases/v0.5.3.md`,复盘 devlog §31。
- 测试规模不写死数字——跑 `npm test`(单测)、`npm run test:e2e`(GUI 端到端)看当前真实结果。

## 里程碑目录

**M1–M21 已随 v0.1.0–v0.5.3 发布**(新里程碑启动时在此加行、标 🚧)。详细实现计划在 `docs/plans/`,设计依据在 `docs/superpowers/specs/`。

| 里程碑 | 版本 | 范围 | 计划 / 设计 |
|--------|------|------|------|
| **M1** | v0.1.0 | 工程骨架 + UI 无关核心层 + CLI `download`(cover/md/html/pdf/meta 五格式)+ 文章库索引 | `plans/2026-06-06-m1-core-and-url-download.md` |
| **M2** | v0.1.0 | GUI:应用壳 + URL 下载页(实时进度)+ 文库(搜/删/在文件夹显示)+ 阅读器(md/html)+ 设置;IPC 桥;`wxfile://` 协议;e2e | `plans/2026-06-06-m2-gui.md` |
| **M3** | v0.1.0 | 扫码登录 mp 后台 + 公众号批量爬取(数量/日期范围);CLI `login`/`auth-status`/`search`/`crawl`/`library list` | `plans/2026-06-07-m3-login-and-crawl.md`(+ spec) |
| **M3.5** | v0.1.0 | GUI 批量页(整页登录引导 → 搜号 → 选范围/格式 → 实时逐篇 + 取消/重试) | `plans/2026-06-07-m3.5-batch-crawl-gui.md`(+ spec) |
| **M4** | v0.1.0 | electron-builder 打包:未签名 mac(dmg arm64+x64)+ win(nsis x64),品牌「宝盒」图标 | `plans/2026-06-07-m4-packaging.md`(+ spec) |
| **M5** | v0.2.0 | 信息架构重构:导航三项(下载/文库/设置)+「下载」页双模式(URL/公众号)+「书架」→「文库」 | `plans/2026-06-08-m5-ia-restructure.md` |
| **M6** | v0.2.0 | 下载闭环 + 历史:结果区就地确认/阅读 + 下载历史 `history.json` | `plans/2026-06-08-m6-download-closure-history.md` |
| **M7** | v0.2.0 | 反馈引导:频控退避可见 + 失败话术归一;取消二次确认 + 未下载文章可单篇补下 | `plans/2026-06-08-m7-feedback-guidance.md` |
| **M8** | v0.2.0 | PDF 保真:`@media print { break-inside: avoid }` 防图片/表格/代码块跨页切断 | `plans/2026-06-08-m8-pdf-page-break.md` |
| **M9** | v0.2.0 | 文库组织:排序 / 按公众号筛选+分组 / 批量删除 + 卡片⇄列表视图切换 | `plans/2026-06-08-m9-library-organization.md` |
| **M10** | v0.3.0 | 文库列表视图:列宽可拖拽(持久化)+ 排序移到表头点击 | `plans/2026-06-16-m10-list-view-polish.md`(+ v0.3.0 spec) |
| **M11** | v0.3.0 | 公众号订阅:订阅页 + 定时轮询 + 新文章检测 + 设置项 + 提示/自动下载 | `plans/2026-06-16-m11-subscriptions.md` |
| **M12** | v0.3.0 | 订阅触发机制(daily/interval)+ 检查可观测性(页内记录 + 落盘日志 + 下次预计) | `plans/2026-06-16-m12-subscription-schedule-and-observability.md` |
| **M13** | v0.4.0 | 存储加固:原子写 + 按路径写锁(并发不丢更新)+ `rebuildLibrary` 恢复(CLI `library rebuild` + 设置页按钮) | `plans/2026-06-22-m13-storage-hardening.md`(+ v0.4.0 spec) |
| **M14** | v0.4.0 | 供料能力:`library export` CLI(JSON 清单 + content.md 路径)+ 文库「导出选中为素材」 | `plans/2026-06-22-m14-material-feed.md` |
| **M15** | v0.4.0 | 贯通样例 skill `agent/wx-kit-compose`:选料 → 选题 → 写作(委派 khazix-writer),两个人工检查点;wx-kit 只供料 | 无独立计划(skill 创作);交付物 `agent/wx-kit-compose/` + `agent/README.md` |
| **M16** | v0.5.0 | 模式分流修复 + help/version:`-h/--help`、`-v/--version`、`version`/`help [cmd]` 都进 CLI 并走 stdout,无参仍 GUI | `plans/2026-06-28-m16-cli-dispatch-help-version.md`(+ v0.5.0 spec) |
| **M17** | v0.5.0 | CLI 补齐:文库 search/remove、订阅 list/check-now、设置 get/set;`--out` 默认回落 `settings.libraryRoot`;抽出共享 `runSubscriptionCheck`(CLI 检查同步落盘 check log + 历史) | `plans/2026-06-28-m17-cli-parity-commands.md` |
| **M18** | v0.5.0 | 首启建 PATH 软链(mac/Linux):`~/bin` 软链 + 不在 PATH 引导写 profile + 设置页重建入口 | `plans/2026-06-28-m18-first-run-path-symlink.md` |
| **M19** | v0.5.1 | 非标准消息类型解析:文字消息(type 10)+ 图文消息/小绿书(type 8)——脚本变量提取正文/图片、标题策略、og 兜底清洗 | `plans/2026-07-09-m19-message-type-parsing.md` |
| **M20** | v0.5.2 | 命令行入口 symlink → wrapper 脚本(mac 软链下 Electron 找不到 Helper app,download 必崩)+ 旧软链自愈 | `plans/2026-07-10-m20-cli-wrapper-script.md` |
| **M21** | v0.5.3 | macOS 程序坞激活重建窗口:补注册 `app.on('activate')`(关窗驻留后点程序坞图标此前无响应) | `plans/2026-07-13-m21-dock-reactivate.md` |

> PRD:v0.1.0 `docs/PRD.md`、v0.2.0 `docs/PRD-v0.2.0.md`、v0.3.0 `docs/PRD-v0.3.0.md`、v0.4.0 `docs/PRD-v0.4.0.md`、v0.5.0 `docs/PRD-v0.5.0.md`、v0.5.1 `docs/PRD-v0.5.1.md`、v0.5.2 `docs/PRD-v0.5.2.md`、v0.5.3 `docs/PRD-v0.5.3.md`(逐条验收看各 §4)。

## 版本发布史(最新在前)

- **v0.5.3 · 2026-07-13 · 修复 macOS 关窗后程序坞无法重开窗口** —— M21 补注册 `app.on('activate')`:主进程此前只做了 mac 惯例的一半(关窗驻留程序坞)而缺重建窗口的代码路径,点程序坞图标无响应、应用假死只能强退。缺陷自 v0.1.0 即存在,整进程启停的开发/测试路径一直未暴露。发布说明 `docs/releases/v0.5.3.md`,复盘 devlog §31。
- **v0.5.2 · 2026-07-11 · 修复命令行入口崩溃** —— M20 快捷命令 symlink → wrapper 脚本:mac 上 Electron 经软链定位不到 bundle 内 Helper app,`download`/PDF 等需子进程的命令必崩(`--version` 等纯主进程命令侥幸可用,M18 验证漏网);旧软链开一次 GUI 静默自愈。README 同坑示例(`ln -sf`)一并清理。发布说明 `docs/releases/v0.5.2.md`,复盘 devlog §30。
- **v0.5.1 · 2026-07-09 · 支持文字消息与图文消息** —— M19 非标准消息类型解析:文字消息(type 10)正文从脚本变量提取、标题取首行截断(修「标题是整篇正文、正文空白」);图文消息/小绿书(type 8)文字 + 主图完整下载(排除水印/分享封面);og 兜底清洗字面转义。解析层单点根治,下游全链路零改动受益。发布说明 `docs/releases/v0.5.1.md`,复盘 devlog §29。
- **v0.5.0 · 2026-06-29 · CLI 体验优化** —— M16 模式分流修复 + help/version、M17 CLI 补齐(文库 search/remove、订阅 list/check-now、设置 get/set)+ 默认同库 + 抽出共享 `runSubscriptionCheck`、M18 首启建 PATH 软链(mac/Linux)。把 CLI 从「能被 agent 调」打磨到「顺手、自洽、与 GUI 同库」。另含解析兜底:`#js_name` 空时从 `d.nick_name` 脚本变量取公众号名。发布说明 `docs/releases/v0.5.0.md`,复盘 devlog §28。
- **v0.4.0 · 2026-06-23 · 文库供料 agent + 存储加固** —— M13 存储加固 + M14 供料能力 + M15 样例 skill `agent/wx-kit-compose`。把文库升级为「可被 AI agent 消费的素材源」,wx-kit 只供料、不内置创作。发布说明 `docs/releases/v0.4.0.md`,复盘 devlog §24–§27。
- **v0.3.0 · 2026-06-16 · 列表优化 + 公众号订阅** —— M10 列宽+表头排序、M11 类 RSS 订阅、M12 触发模式 + 可观测性。发布说明 `docs/releases/v0.3.0.md`,复盘 devlog §17–§20。
  - *v0.3.0→v0.4.0 间维护(2026-06-18~22)*:频控取消即时打断 + 订阅命中频控不重试 + 订阅去规律化(`abbcc57`/`601d8f7`/`3050167`)、阅读器 md 标题重复修复(`9ad515e`)、undici 安全补丁 Dependabot #32/#33 归零(`3b82782`)。复盘 devlog §21–§23。
- **v0.2.1 · 2026-06-09 · 安全补丁** —— electron 31→42、electron-builder 24→26、vite 6、vitest 3,Dependabot 28 项全部归零;功能同 v0.2.0。发布说明 `docs/releases/v0.2.1.md`,依赖审计与网络坑 `docs/plans/2026-06-09-deps-audit.md`。
- **v0.2.0 · 2026-06-08 · 下得放心、找得到、看得见** —— M5 信息架构 + M6 下载闭环/历史 + M7 反馈引导 + M8 PDF 保真 + M9 文库组织(R1–R7 全落地)。发布说明 `docs/releases/v0.2.0.md`,复盘 devlog §10–§16。
- **v0.1.0 · 2026-06-07 · 第一阶段首发** —— M1 核心+CLI 五格式 + M2 GUI + M3 登录/爬取(CLI)+ M3.5 批量 GUI + M4 打包。发布说明 `docs/releases/v0.1.0.md`,复盘 devlog §1–§9。

## 下一步 / 候选

当前无排期。候选(需要时单议):

- **Windows CLI stdout 正解** —— 打包后 win 是 GUI 子系统程序,CLI 模式 stdout 不回贴控制台,现仅有「重定向到文件」绕法(见 README、AGENTS.md 陷阱清单)。正解是打包时给 win 出 console 子系统入口(或 `wx-kit-cli.exe` wrapper)。要动打包配置,铺 Windows agent 场景时再做。
- 其余方向(mac 签名公证、应用内更新、其他形式内容保真如公式/音视频卡片/合集、整本导出、多 session)均为各版**非目标**,需要时单独立项。
