# wx-kit — 路线图与状态

> 项目进度的「状态板」,只放**可扫读的状态**:当前版本、里程碑目录、版本发布史、下一步。
> `AGENTS.md` 是稳定的宪法(决策/不变量/陷阱);**实现细节看 `docs/plans/`,决策/踩坑复盘看 `docs/devlog/wx-kit-vibe-coding.md`,逐条需求/验收看各 `docs/PRD*.md`,不可变快照看 git tag**。本文件不复述这些,只给指针。

## 当前状态

- **最新发布:v0.10.0(2026-08-28,订阅经微信读书复活)** —— tag `v0.10.0` + GitHub Release(三平台包,标 Latest)+ brew tap。M52/M53 用微信读书 Web 后端重建订阅闭环(扫码登录、识别、检查/自动下载、新旧标识归一、删除、行内检查隔离、首检水位修正)；但列表接口被服务端按账号封禁(2026-08-27 spike 三轮证伪客户端手段,见 AGENTS.md),「按公众号批量下载」再停用——GUI 入口移除、CLI `crawl` 稳定拒绝,能力边界收缩为「订阅 + 最新一篇」。需求/验收 `docs/PRD-v0.10.0.md` §6,发布说明 `docs/releases/v0.10.0.md`。
- **当前开发:v0.10.1（M54、M55 已实施，未发版）** —— M55 日报以 `library.json.publishTime` 为唯一文章来源，默认（含 today）纯本地，仅今天显式 `--download` 刷新下载并重读文库；缺失时间保留正文并告警。单测/lint/tsc、双架构构建、GUI fixture e2e、打包本地查询及首次真实 cover 下载已通过；真实跨进程第二次刷新遇 HTTP 401，登录态连续使用仍需复验，不能宣称该项通过。验收详情见 `docs/plans/2026-08-30-m55-publication-digest.md`，需求见 `docs/PRD-v0.10.1.md`。
- **v0.8.6、v0.8.7 均未发布且不再发布** —— M44–M47、M49 的有效成果由 v0.9.0 吸收；两份 PRD 仅保留历史设计与需求去向，不是当前验收契约。
- 测试规模不写死数字——跑 `npm test`(单测)、`npm run test:e2e`(当前有效 GUI 端到端)看当前真实结果；另以隔离文库执行真实文章 URL 下载验收。私有后台命令只验收“稳定拒绝且零请求”，不再做 live 联调。

## 里程碑目录

**M1–M43 已随 v0.1.0–v0.8.5 发布；M44–M47、M49–M51 已由 v0.9.0 吸收并发布**。详细实现计划在 `docs/plans/`,设计依据在 `docs/superpowers/specs/`。

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
| **M22** | v0.5.4 | 订阅检查加固:调度防重入(同时段重复检查)+ 失败明细弹窗(检查记录可点开逐号原因)+ 翻到水位为止(平时每号 1 次请求,空窗不漏) | `plans/2026-07-16-m22-subscription-check-hardening.md` |
| **M23** | v0.5.5 | 文库导航:分组默认收起为目录 + 展开记忆 + 粘性组头 + 回到顶部;`content-visibility` 保千篇量级流畅 | `plans/2026-07-17-m23-m24-library-nav-and-keyword-filter.md` |
| **M24** | v0.5.5 | 按公众号下载关键词筛选(issue #1):标题匹配,GUI 互斥下拉(仅下载含/排除含),CLI `--include`/`--exclude`,零额外请求 | 同上 |
| **M25** ✅ | v0.6.0 | 体验杂项:文库默认发布时间降序+排序跨会话记忆、检查日志入口(设置页+订阅页可发现性)、CLI 帮助完善(2026-07-19 完成) | `plans/2026-07-19-m25-ux-misc.md` |
| **M26** ✅ | v0.6.0 | 安装通道:brew tap(monkeychen/homebrew-wx-kit)+ npm 包(dist-npm staging)+ 发版规约⑦⑧(2026-07-19 完成,双通道隔离安装真机验证) | `plans/2026-07-19-m26-install-channels.md` |
| **M27** ✅ | v0.6.0 | headless 登录态:`session export`/`import`(0600 + 结构校验;当版导入即真探测,v0.8.6 起改为零请求导入;2026-07-19 完成) | `plans/2026-07-19-m27-session-transfer.md` |
| **M28** ✅ | v0.6.0 | agent skill:`agent/wx-kit-skill/`(检测→安装→登录态→能力速查→范例;全新 agent 四步端到端验证;2026-07-19 完成) | `plans/2026-07-19-m28-agent-skill.md` |

| **M29** ✅ | v0.7.0 | 保真与外观:markdown GFM 表格(自写规则+微信单元格压平)、应用内版本号(刊头+设置页关于)、原生标题栏文案去重(2026-07-20 完成,真实文章 3 张表端到端验证) | `plans/2026-07-20-m29.md` |
| **M30** ✅ | v0.7.0 | 创作工作流:导出素材后 Modal 就地显示路径 + 一键复制「给 agent 的指令」(2026-07-20 完成;调研后否决「直接唤起 Claude Code」,理由见计划) | `plans/2026-07-20-m30.md` |
| **M31** ✅ | v0.8.0 | CLI/订阅增强与 bug 修复:R1 订阅部分检查(行内「检查」+ CLI `--accounts`)+ R3 library 排序(默认 publishTime desc,sortArticles 抽 core 共享)+ R4 `-h` 加仓库 URL + R5 修 mac CLI 程序坞冒图标(2026-07-22 完成) | `plans/2026-07-22-m31.md` |
| **M32** ✅ | v0.8.0 | 站点同步:文库/CLI 把文章按 Astro 站点规范生成 `content/posts/<日期>-<slug>/`(目录级原子写入、slug 冲突不覆盖、图片摊平同目录);设置开关默认关;产物过真实站点 `npm run check`(2026-07-22 完成) | `plans/2026-07-22-m32.md` |
| **M33** ✅ | v0.8.1 | 补丁:真正修掉 mac CLI 程序坞图标(`LSUIElement` 在 plist 层压住——`app.dock.hide()` 在 `whenReady` 前不生效,AppKit 已先画图标)+ 设置页「站点同步」hover 建站指引(2026-07-22 完成,打包态采样验证) | `PRD-v0.8.1.md` |
| **M34** ✅ | v0.8.2 | 订阅检查反馈:`RunCheckResult` 加逐号明细 + 修掉 IPC 丢返回值 + 自动下载进度广播 + 行内结果态/「去看看」+ 策略常驻可见 + CLI `results`;顺带修 `lastCheckedAt` 只在一条分支写导致「尚未检查」与结果矛盾(2026-07-26 完成,真实 session 端到端验过自动下载路径) | `plans/2026-07-26-m34.md` |
| **M35** ✅ | v0.8.2 | 含视频文章下载:新格式 `video`(不进默认)+ **修掉视频消息页(10002)正文是 21.8 万字符内联 JS 的 bug** + 择档按分辨率(format_id 与画质无关)+ 按体积算超时(20 秒对 133MB 必超时)+ 失败进 `warnings[]` 不静默(2026-07-26 完成,真实 133MB 视频端到端 + 阅读器可播验证) | `plans/2026-07-26-m35.md` |
| **M36** ✅ | v0.8.2 | **列表接口修正 + 消息类型一等公民**:`appmsg?type=9`(370 篇/只有图文/最新卡在 7-17)换成 `appmsgpublish`(770 篇/全类型/每页 20);解析改按 `item_show_type` 显式分发,未知类型进 `warnings` 不再静默产出垃圾(2026-07-26 完成:实测最近 10 篇里 9 篇是旧接口看不见的;订阅检查补回 6 篇漏检) | `plans/2026-07-26-m36.md` |
| **M37** ✅ | v0.8.2 | 更新检查 + 按渠道引导升级:GitHub API 查最新版、自写版本比较(不引 semver)、识别 brew/dmg/nsis 渠道给对应动作(brew 给三段命令一键复制)、启动静默检查 + 只点一个圆点不打扰(2026-07-26 完成,真机识别 brew + 两条路径实测) | `plans/2026-07-26-m37.md` |
| **M38** ✅ | v0.8.3 | 过滤读者不可访问的文章:`checking`/`ban_flag` 与 `is_deleted` 同批过滤(此前漏读→必然失败的下载 + 笼统报错)、`--count N` 按可下条数补齐、提示只在结果不及预期时给、订阅水位不被卡住;**实现中发现列表在文章被拒后不再有标记**(`checking` 只在审核期间为 1),改为下载阶段认出错误页并把两类失败分开计数(2026-07-27 完成) | `plans/2026-07-27-m38.md` |
| **M39** ✅ | v0.8.4 | 更新检查在常开应用里几乎不生效:静默检查被「每天最多一次」限流直接 `return null`,**连上次查到的结论一起吞掉**;且唯一检查时机绑在启动上(桌面应用常年不重启)。改为缓存结论(`lastKnownRelease`,`hasUpdate` 按当前版本实时算故升级后提示自动消失)+ 主进程每小时 tick(渲染层 effect 关窗即停);整段编排移进 core 的 `resolveUpdateCheck` 以便钉住「断网回落缓存」(2026-07-27 完成,隔离 userData 真跑复现原场景) | `plans/2026-07-27-m39.md` |
| **M40** ✅ | v0.8.4 | 订阅新文章可见可挑(展开看标题/时间/类型 + 勾选下载或忽略;`setNewRefs` 改按 `mid_idx` 合并,留存的 pending 不再被下次检查冲掉)+ 文库类型标识修正(`8` 标成「图文」与默认类型同名 → 改「图片」、未知类型给警示态、warnings 写进 meta.json 并在卡片可见);类型文案上提 `core/message-kind`。**实现中连修两处既有缺陷**:订阅下载没透传文章主键致短链退化成哈希 id(真实库 32/267 篇)、下载失败的文章被静默清出待处理连重试入口都没有(2026-07-28 完成,真机验证展开明细/部分下载/短链 id) | `plans/2026-07-28-m40.md` |
| **M41** ✅ | v0.8.4 | CLI `subscription digest --date`:查已订阅号某一天发了什么(不下载、不写库、不推水位),输出带 `downloaded` 让 agent 分流;自然语言日期由 agent 换算,CLI 只认 `YYYY-MM-DD`/`today`/`yesterday`;**wx-kit-skill 三处同步是交付物不是附属**;`downloaded` 除比 id 还比 sourceUrl(存量 32 篇哈希 id 否则会被误报未下载)(2026-07-28 完成,真机验证纯查询不留痕) | `plans/2026-07-28-m41.md` |
| **M42** ✅ | v0.8.4 | `agent/wx-kit-compose` 跟上 CLI(最后改动停在 2026-06-23/v0.4.0):补上游 `digest` 选题入口、下游可选 `site sync`、中间 `library search`/`--sort`、素材质量信号 `itemShowType`/`warnings`;`agent/README.md` 一并核对。**做法上的关键决定:不把 CLI 细节抄进 compose**(参数/契约一律指向 wx-kit-skill)——它落后二十个里程碑的根因就是抄了不会跟着变的东西,再抄一遍只是把 bug 推迟(2026-07-28 完成,命令与 flag 逐条对源码核实、真实走通取料链路) | `plans/2026-07-28-m42.md` |
| **M43** ✅ | v0.8.5 | `subscription digest --download`:缺的下、已有的跳过,清单**统一带 `dir`/`contentPath`**(不区分刚下的与本来就有的)+ `--formats` 缺省跟设置走(与 crawl 的硬编码缺省有意不同);只读与下载切成两个 core 函数,「不带 flag 行为一字不变」由结构保证;`unavailable` 一路透传到清单(重试无用别死磕)(2026-07-28 完成,真机验证下 1 留 2/复跑零请求/水位不变) | `plans/2026-07-28-m43.md` |
| **M44** ✅ | v0.9.0（吸收） | 全局请求治理与熔断:唯一网关、持久状态、跨 GUI/CLI 互斥、200013 零重试、排队取消与批量停手(2026-08-02 离线完成) | `plans/2026-08-02-m44-m46-request-governance.md` |
| **M45** ✅ | v0.9.0（吸收） | Chromium 会话请求栈:后台 API/文章/媒体共用专用 Session 与 Cookie Jar,移除固定 macOS Chrome 124 和生产旁路 axios(2026-08-02 离线完成) | 同上 |
| **M46** ✅ | v0.9.0（吸收） | 隐藏请求清理 + 保护状态 UI/CLI + 网络封锁测试模式;该测试模式已随 M49 退场,有效请求栈成果保留(2026-08-02 离线完成) | 同上 |
| **M47** ✅ | v0.9.0（吸收） | 公众号重新登录/彻底退出的底层会话清理已实现并保留；M49 隐藏产品入口、停用相关 CLI，因此不再执行真实 A→B 切换验收 | `plans/2026-08-02-m47-auth-session-reset.md` |
| **M49** ✅ | v0.9.0 | 私有文章列表能力退场:隐藏按公众号下载/订阅/相关设置,停止后台执行链路,CLI 兼容停用,保留实现与用户数据；当前 GUI e2e + 真实 URL 下载验收通过(2026-08-08) | `plans/2026-08-08-m49-private-api-retirement.md` |
| **M50** ✅ | v0.9.0 | 依赖安全维护与运行时回归:实施时读取 28 条 Dependabot open/0 dismissed,修复直接与传递依赖；官方 npm 审计 0，正式发版推送后远端 0 open/0 dismissed(2026-08-09 核实) | `plans/2026-08-08-v0.9.0-boundary-reset-and-security.md` |
| **M51** ✅ | v0.9.0 | 当前产品说明与发布准备:四张真实数据页面截图、README/Skill/发布草案、打包 GUI/CLI 与真实下载验收(2026-08-08) | 同上 |
| **M52** ✅ | v0.10.0 | 微信读书后端 core + CLI 复活：weread 适配层、gateway 域名路由、判重兜底、七个命令组复活、单测；**2026-08-27 列表接口被服务端按账号封禁（spike 终局，见 AGENTS.md），2026-08-28 起 `crawl` 再度停用，仅订阅/最新一篇保留** | `plans/2026-08-26-m52-weread-backend.md`、`plans/2026-08-27-fix-weread-web-login.md`、`plans/2026-08-28-v0.10.0-scope-tighten.md` |
| **M53** ✅ | v0.10.0 | GUI 复活：二维码登录组件、Subscriptions/Settings 恢复接线；**2026-08-28 按公众号下载入口随列表封禁一并移除（订阅页补删除与行内检查隔离）** | 同上 |
| **M54** ✅ | v0.10.1 | 订阅可靠性与批量交付：`cover` 稳定身份游标、首次投递/重复检查修复、下载全部待处理新文章、移除无效列表探测、下载阶段可见（2026-08-29 完成） | `plans/2026-08-29-m54-subscription-reliability.md` |
| **M55** | v0.10.1 | 已实施：本地发表日期日报、仅今天显式刷新下载、未知时间告警、账号改名身份匹配；首次真实刷新通过，跨进程二次刷新 HTTP 401 待复验 | `plans/2026-08-30-m55-publication-digest.md` |

> PRD:v0.1.0 `docs/PRD.md`、v0.2.0 `docs/PRD-v0.2.0.md`、v0.3.0 `docs/PRD-v0.3.0.md`、v0.4.0 `docs/PRD-v0.4.0.md`、v0.5.0 `docs/PRD-v0.5.0.md`、v0.5.1 `docs/PRD-v0.5.1.md`、v0.5.2 `docs/PRD-v0.5.2.md`、v0.5.3 `docs/PRD-v0.5.3.md`、v0.5.4 `docs/PRD-v0.5.4.md`、v0.5.5 `docs/PRD-v0.5.5.md`、v0.6.0 `docs/PRD-v0.6.0.md`、v0.7.0 `docs/PRD-v0.7.0.md`、v0.8.0 `docs/PRD-v0.8.0.md`、v0.8.1 `docs/PRD-v0.8.1.md`、v0.8.2 `docs/PRD-v0.8.2.md`、v0.8.3 `docs/PRD-v0.8.3.md`、v0.8.4 `docs/PRD-v0.8.4.md`、v0.8.5 `docs/PRD-v0.8.5.md`、v0.8.6 `docs/PRD-v0.8.6.md`（未发布历史方案）、v0.8.7 `docs/PRD-v0.8.7.md`（未发布、已取消）、v0.9.0 `docs/PRD-v0.9.0.md`、v0.10.0 `docs/PRD-v0.10.0.md`、v0.10.1 `docs/PRD-v0.10.1.md`（当前验收契约）。

## 版本发布史(最新在前)

- **v0.10.0 · 2026-08-28 · 订阅回来了,批量下载留在那里** —— v0.9.0 因 MP 后台私有接口被封而退场的订阅,这一版经**微信读书 Web 后端**重建闭环:扫码登录(应用内/CLI 二维码)、粘贴文章链接识别、检查/自动下载、`search/login/auth-status/subscription/session/protection` 命令组恢复。实施中两次事实反转:移动端列表接口被风控 → 降级 Web 端 `/api/mp/cover`(最新一篇)→ spike 三轮(undici / Electron 栈 / 真 Chrome 全登录)证伪「网络栈指纹」归因,确认列表接口是**服务端按账号封禁**、与客户端无关——据此按号批量下载再度停用(GUI 入口移除、CLI `crawl` 稳定拒绝),边界如实收缩为「订阅 + 最新一篇」。订阅页顺手修四件用户实测问题:新旧标识(base64 fakeid vs `MP_WXS_`)同名重复行归一、每行可删除(持久化标记、历史派生行不复活)、行内检查只作用本行(修全局 loading)、首检水位 off-by-one(订阅后首检必报「没有新文章」)。发布说明 `docs/releases/v0.10.0.md`,复盘 devlog §46–§47。
- **v0.9.0 · 2026-08-09 · 回到可靠的主线** —— 微信公众平台私有文章列表接口持续拒绝访问后，产品不再让用户面对一条不可交付的链路：隐藏按公众号下载、订阅和相关设置，停用私有后台 CLI 但保留命令名、旧实现与历史数据；URL 下载、文库、阅读器、素材导出和站点同步继续可用。M44–M47 中对当前路径有价值的 Chromium 请求栈与安全边界保留，M50 同步修复直接和传递依赖并把官方 npm 审计清零，M51 用真实文章重拍四张当前页面截图并完成打包 GUI/CLI 验收。GitHub Release、brew tap 与 npm `@simiam/wx-kit` 均已发布；发布说明 `docs/releases/v0.9.0.md`，复盘 devlog §43–§45。
- **v0.8.5 · 2026-07-28 · 一个问题,一份清单** —— 安哥试用 v0.8.4 的 `digest` 后指出:「你只提供链接,不就意味着 agent 还得多操作一步」。对的——把「看清单」与「取内容」切得太干净,中间那道缝就留给了调用方:它得逐个 `download`,再把「刚下的」与「本来就有的」两种形状合并。M43 给 `digest` 加 `--download`(**不另造命令**:问题还是同一个,只多一个决定;另造会让人每次先想「该用哪条」),清单里每篇统一带 `dir`/`contentPath`。几处刻意的选择:查询与取内容是**两个 core 函数**而非一个带开关的函数,「不带 flag 行为一字不变」由结构保证;`contentPath` **只在正文文件真存在时才给**(给个指向不存在文件的路径比不给更糟,`library export` 那处无条件拼路径的 latent bug 没照搬);`--formats` 缺省跟设置走(与 `crawl` 的硬编码缺省有意不同);v0.8.3 的 `unavailable` 透传到条目——真机验证时正好撞上两篇同名文章,下载才发现是**审核未通过后重发**,agent 据此不会反复重试死链。发布说明 `docs/releases/v0.8.5.md`,复盘 devlog §40。
- **v0.8.4 · 2026-07-28 · 看得见,还能挑** —— 五条需求同一形状:**系统手里已有这个信息,用户/agent 却用不上或用不准**,没有一条需要新抓数据。M39 更新检查(限流本意是省请求,却把上次查到的结论一起吞了 → 返回缓存结论且 `hasUpdate` 按当前版本实时算,升级后提示自动消失;唯一检查时机绑在渲染层挂载后 3 秒,而关窗后那个 effect 就不存在了 → 主进程每小时 tick,tick 频繁≠请求频繁)。M40 订阅新文章可见可挑(标题早就存在本地,UI 只用了 `.length`;行内动作始终作用于当前选择,收起=全部,一次只有一个含义)+ 类型标识修正(`item_show_type 8` 标成「图文」正是不标标签的默认类型的名字,自相矛盾;`warnings` 此前在 GUI 里产生即消失,现在写进 meta.json)。M41 `subscription digest`(与 check-now 语义分开:不推水位所以可反复查同一天;日期只认 `YYYY-MM-DD`/`today`/`yesterday`,猜错会静默给出另一天的结果)。M42 compose 跟上 CLI(**做法上的关键决定:不把 CLI 细节抄进去**——它落后二十个里程碑的根因就是抄了不会跟着源头变的东西)。**实现中连修三处既有缺陷**:订阅下载丢文章主键致短链退化成哈希 id(真实库 32/267 篇)、留存的待处理被下次检查整批冲掉、下载失败的文章被静默清出列表连重试入口都没有。发布说明 `docs/releases/v0.8.4.md`,复盘 devlog §39。
- **v0.8.3 · 2026-07-27 · 打不开的文章不再算「下载失败」** —— 安哥抓某号最近 3 篇遇到 2 篇失败、报笼统的 `no title parsed`,问列表接口是否该过滤。查下去发现信号确实在列表里(`checking:1`),但**隔天复现时它归零了而页面照样打不开**——`checking` 只标「审核期间」,文章被拒之后列表不留痕迹。安哥追问「确定没有别的字段」,遂把 6 篇的每个字段(含嵌套与群发状态块)做集合对比,唯一相关的 `line_info.line_count` 会误伤视频消息(天然无正文行数却能下)。**因误滤是静默的、代价远高于明确失败,决定不用启发式过滤**,改为:列表阶段仍补上 `checking`/`ban_flag`(滤掉审核期间的),下载阶段靠错误页特征抛 `ArticleUnavailableError`,汇总把「读者本就打不开」与「真故障」分成两类——原案例从 `成功 1/失败 2` 变成 `成功 1/真故障 0/读者不可见 N`。发布说明 `docs/releases/v0.8.3.md`,复盘 devlog §38。
- **v0.8.2 · 2026-07-26 · 不让用户猜** —— 四条需求的共同点是「系统知道却没告诉用户」。M34 订阅检查反馈(IPC 层丢了返回值→渲染层想提示也无从提示;自动下载那条路径连进度事件都不发;顺带修 `lastCheckedAt` 只在一条分支写导致「尚未检查」与结果并列矛盾)。M35 含视频文章下载(**视频是内容不是格式**——安哥试用后纠正,已从格式选项降级为「有就下」+ 设置开关;择档按分辨率,`format_id` 与画质无关且方向相反;`auth_key` 有时效故解析即下、URL 不入库;顺带修掉视频消息页把 21.8 万字符内联 JS 当正文的 bug)。M36 列表接口修正(`appmsg?type=9` 只给图文素材:370 篇/最新卡在 7-17,换 `appmsgpublish` 得 770 篇/全类型;**订阅检查共用同一链路,此前一直静默漏检整类消息**;解析改按 `item_show_type` 分发,未知类型进 `warnings` 不再静默产出垃圾;`appmsg_type` 与 `item_show_type` 正交,10002 出现在没有视频的文字消息上)。换接口连带的去重回归(短链 vs 长链算出两个 id → 重复下载)用微信自己的文章主键 + canonical 匹配修好,老库不必迁移。M37 更新检查(不做静默自更新:adhoc 签名下 Squirrel 必败且与 brew 账本打架;告知强度刻意压到最低——只点一个圆点;按渠道给动作,brew 那条命令把踩过的两个坑固化进去)。发布说明 `docs/releases/v0.8.2.md`,复盘 devlog §37。
- **v0.8.1 · 2026-07-22 · 补丁:dock 图标真修复** —— v0.8.0 宣称修好的 R5 实为误判,安哥用正式版跑 `wx-kit -h` 当场复现。根因:`app.dock.hide()` 在 `whenReady()` 前调用**不生效**,AppKit 在 ready 前已把进程注册成 `Foreground` 并画了图标(实测 `-h` 期间状态序列 `NULL→Foreground→UIElement`);当时的验证用跑 2–3 秒的 `download` 且延迟 2 秒才采样,**跳过启动瞬间**,是假阴性。改由 `LSUIElement`(mac Info.plist)在进程启动时定为 accessory,GUI 分支 ready 后 `dock.show()` + `focus` 要回图标与焦点。另加设置页「站点同步」的 `?` hover 指引(指向 dreamble 站点源码)。发布说明 `docs/releases/v0.8.1.md`。
- **v0.8.0 · 2026-07-22 · 让内容流到该去的地方** —— 两条主线:让 agent 用 CLI 用得更顺 + 让文章流进个人站点。M31 订阅按号点检(核心 `checkSubscriptions` 本就按 accounts 数组查,只需在编排层开子集口子;与全量共享 in-flight 守卫)+ `library list`/`search` 默认 publishTime 降序(`sortArticles` 从 renderer 抽到 core 共享,默认序变更属轻度 breaking 已显式标注)+ `-h` 附仓库地址(agent 自助读 README)+ 修 mac CLI 堆程序坞图标(Electron 是 GUI 子系统进程,CLI 分支须主动 `app.dock.hide()`);M32 站点同步(目录级原子写入不复用只能单文件的 `atomic-write`;slug 冲突不覆盖;产物落进真实站点跑 `npm run check` 作为跨项目验收,验完清理不留痕;`site` 漏登 `CLI_COMMANDS` 白名单曾导致命令静默启 GUI 挂起)。发布说明 `docs/releases/v0.8.0.md`,复盘 devlog §36。
- **v0.7.0 · 2026-07-20 · 磨平「下载 → 创作」链路** —— 不铺新平台、不改架构,只磨四处毛刺:M29 markdown 导出保留 GFM 表格(自写规则 + 微信 `<section>` 单元格压平,不引 turndown-plugin-gfm——插件产出非法 GFM 要修等于重写)+ 应用内版本号(设置页「关于」,刊头版本号上线即按反馈撤回)+ 原生标题栏文案去重(title + index.html 同改空);M30 导出素材 Modal 就地显示路径 + 一键复制「给 agent 的指令」(调研后否决「直接唤起 Claude Code」:CLI 虽能带 prompt 起会话,但唤起的是新终端陌生 cwd 的新会话,不如粘进用户已开着的会话)。发布说明 `docs/releases/v0.7.0.md`。
- **v0.6.0 · 2026-07-19 · Agent 自动化闭环** —— 四个里程碑一版打通「agent 不碰鼠标用起 wx-kit」:M25 文库默认发布时间降序+排序跨会话记忆、检查日志入口、CLI 帮助大改;M26 brew tap(`monkeychen/homebrew-wx-kit`)+ npm 包双安装通道(发版规约⑦⑧);M27 `session export/import` 打通 headless 登录态(0600+结构校验;当版导入即真探测,v0.8.6 起已改为零请求导入);M28 `agent/wx-kit-skill/` 能力说明书(样例逐条实测,全新 agent 四步端到端零人工)。发布说明 `docs/releases/v0.6.0.md`,复盘 devlog §34。
- **v0.5.5 · 2026-07-18 · 文库目录化导航 + 关键词筛选下载** —— M23 治「滚动好久」:分组默认收起为公众号目录(一屏尽览、展开记忆、粘性组头、回顶),实测千篇量级 `content-visibility` 后滚动 23→52fps,虚拟滚动推迟万篇级;M24 落地 issue #1:标题关键词筛选(GUI 互斥下拉,初版双输入框被安哥纠正——互斥要靠结构;CLI 双 flag 可组合),列出→下载之间过滤零额外请求。发布说明 `docs/releases/v0.5.5.md`,复盘 devlog §33。
- **v0.5.4 · 2026-07-16 · 订阅检查:不重跑、看得清失败、请求更省** —— M22 三合一:调度防重入(检查耗时跨 tick 曾并发重复跑,真机同时段两条相同记录);失败明细可观测(检查记录/落盘日志/CLI JSON 逐号原因,GUI 弹窗);「翻到水位为止」取代固定取 20 篇(微信每页实回 ~5,日常 4 次请求 → 1 次,空窗多日自动翻深不漏)。发布说明 `docs/releases/v0.5.4.md`,复盘 devlog §32。
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

候选(需要时单议):

- **文库虚拟滚动** —— 实测(2026-07-18,1000 篇/20 组假文库):目录态打开 169ms;全展开后滚动曾 ~23fps,加 `content-visibility: auto` 后恢复 ~52fps、挂载 420ms、堆 125MB——**千篇量级已无需虚拟滚动**。等万篇级或实测再退化时再议(届时瓶颈是 React 挂载数与逐卡 coverName IPC,需虚拟列表 + 封面批量查询)。
- **Windows CLI stdout 正解** —— 打包后 win 是 GUI 子系统程序,CLI 模式 stdout 不回贴控制台,现仅有「重定向到文件」绕法(见 README、AGENTS.md 陷阱清单)。正解是打包时给 win 出 console 子系统入口(或 `wx-kit-cli.exe` wrapper)。要动打包配置,铺 Windows agent 场景时再做。
- 其余方向(mac 签名公证、应用内更新、其他形式内容保真如公式/音视频卡片/合集、整本导出、多 session)均为各版**非目标**,需要时单独立项。
