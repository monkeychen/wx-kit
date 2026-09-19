# wx-kit v0.11.3 产品需求文档（迭代 PRD）

> 一项可靠性修复（mocli 打包环境不可用）+ 一项可观测性基建（统一诊断日志）。
> mocli 修复三连源自 2026-09-19 安哥本机实录（打包后订阅检查恒报 BAD_OUTPUT，开发模式正常）；
> 诊断日志为同日安哥发起的设计定案（默认常开、JSON 行、脱敏红线）。
> 当前进度见 `ROADMAP.md`，验收以本文第 4 节为准。

## 1. 一句话定义

**墨问功能在打包环境里和开发模式一样能用；出问题时线索已经在日志里，不用再猜。**

## 2. 需求清单

### R1 · mocli 打包环境修复（BAD_OUTPUT 三连修）

**用户目标**：dmg 安装的 wx-kit,墨问订阅「检查更新」与发现层功能开箱即用——
不管 mocli 装在 nvm/homebrew/自定义符号链接的哪种形态。

**三处缺陷（本机逐层钉死）**：

1. `createLocateDeps()` 漏传 `env.HOME/SHELL` → locate 探测链第②步（HOME 相对候选 +
   nvm 扫描）在生产整体跳过，永远落到 login shell 兜底；兜底拿到用户手工建的符号链接
   `~/bin/mocli`（所在目录无 node）→ PATH 注入后 `env node` 仍不可达 → mocli 空 stdout →
   `BAD_OUTPUT`。修复：工厂透传 env，单测钉死契约。
2. BAD_OUTPUT 文案误导（猜「版本过旧」）：真实线索 `env: node: No such file or directory`
   在 stderr 里被丢弃。修复：错误消息带 stderr 首行摘要。
3. 防线单点：node 可达性完全依赖「精确探测到 mocli」。修复：启动期 `injectCommonBinDirs()`
   把常见工具链 bin 目录（nvm 最新版/volta/asdf/npm-global/`~/bin`/brew 双前缀，存在才加）
   预置进 PATH——探测链从唯一防线降级为精确展示；另修调度闸门：无墨问订阅作者的机器
   每分钟 tick 不再空跑 mocli 探测（未装 mocli 时探测以 spawn 登录 shell 告终）。

**硬边界**：预置目录均为确定性白名单、纯 fs 探测（微秒级、幂等），不执行 shell；
探测链保留（设置页展示路径/版本、login shell 覆盖奇葩安装位）。

### R2 · 统一诊断日志（M66）

**用户目标**：报障时「把 main.log 发我」即可，环境与外部调用的关键事实已在盘上。

**能力**：默认常开 info 级、JSON 行（`{time,level,domain,event,...fields}`）、已脱敏、
5MB×3 滚动（main/main.1/main.2）、无远程上报。落 `userData/logs/main.log`，GUI 与 CLI
双模式同文件。设置页「诊断」区一键打开日志文件夹（Finder 选中 main.log）。

**埋点域**：startup（snapshot 含版本/平台/PATH/HOME/SHELL/weread 凭据存在性；mocli-located）、
mocli（spawn/exit：argv、退出码、耗时、stdout/stderr 首行）、mp-request（kind+脱敏端点+
耗时+错误，网关单点收口）、download（篇级 done/fail：URL、成败、耗时、articleId）。

**脱敏红线（宁可漏记不可泄密）**：结构化敏感 key（cookie/wr_skey/token/api_key/auth_key/
sign/ticket/secret/password 等，大小写不敏感）→ `«redacted:N»`；URL query 敏感参数打码；
外部进程输出等不可信文本过 `redactFreeText`（内嵌 JSON 字段与 query 两形态）——该层为
产物验收实录泄漏（mocli stdout 带 api_key 明文）后补。

## 3.5 非目标

- 不做 GUI 日志查看器、日志分级配置 UI、远程上报。
- 不吞并/迁移既有专用日志（mp-request-audit / subscriptions-check）。
- 不给每图/每视频打 info 级日志（篇级粒度；资源级留给未来 debug 级）。
- npm 渠道默认不发（安哥点名才发）。

## 4. 验收清单（逐条）

### R1 mocli 修复

- [x] 单测:`tests/core/mowen/runner.test.ts` 钉「真实工厂必须透传 env」;调度闸门
  `mowenSchedulerCanRun` 用例（无订阅不探测）；PATH 预置 `commonBinDirs`/
  `injectCommonBinDirs` 用例 —— 728/728 全绿（2026-09-19）。
- [x] 打包产物 CLI 真机（`env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin` 模拟 Dock 启动）：
  `mowen detect` 检出 nvm 真实路径、version v0.5.4、moUid 正常解析；伪造 HOME 极端场景
  诚实报 MOCLI_NOT_FOUND + 指引，不崩溃（2026-09-19）。
- [x] BAD_OUTPUT 消息带 stderr 首行:单测钉（`env: node` 文案透传、双空流保持通用提示）。
- [x] e2e 全绿（GUI 全流程含墨问链路）+ live-download e2e 全绿（真实微信文章四格式落盘、
  私有接口零调用）（2026-09-19）。

### R2 诊断日志

- [x] core 层 18 用例：脱敏三形态（结构化/URL/自由文本）、轮转链、轮转失败不吞写入、
  append 失败不外泄、flush、幂等、循环引用（2026-09-19）。
- [x] mocli 埋点真子进程用例：init 后 spawn/exit 事件落盘、exit 带码/耗时/首行；未 init
  null 安全（2026-09-19）。
- [x] 打包产物真机（GUI 级最小 PATH,CLI 模式）：main.log 落盘 snapshot（含 PATH/argv）/
  mocli spawn·exit 事件链；**脱敏验收 grep 真实 api_key 前缀零命中**，值显示 `«redacted:32»`。
- [x] 打包产物 GUI 真机实启：GUI 进程存活，snapshot(mode=gui)/ready(libraryRoot)/
  mocli-located 落盘（2026-09-19）。
- [x] e2e:设置页诊断区按钮存在 + `diag:openLogsFolder` IPC 契约（ok + main.log 绝对路径）。

## 5. 版本与里程碑

- 版本：v0.11.3（2026-09-19 发布）。里程碑：M66（`docs/plans/2026-09-19-m66-diag-log.md`）
  + mocli 修复三连（无独立里程碑，commit 于 main）。
- 发布说明：`docs/releases/v0.11.3.md`；渠道：GitHub Release + brew tap（必做），
  npm 按需。
