# wx-kit v0.9.0 产品需求文档（产品边界重置）

> **状态：已发布**（2026-08-09）。
>
> v0.8.6、v0.8.7 从未发布，相关有效成果和需求去向统一由本 PRD 承接。

## 1. 一句话定义

wx-kit 从“发现公众号、订阅更新、按公众号批量抓取和下载”收缩为可靠的本地内容工具：

> 用户提供明确文章 URL → 下载正文与媒体 → 本地文库阅读管理 → 素材导出或站点同步。

## 2. 为什么是 v0.9.0

微信公众平台后台持续拒绝查询其他公众号的文章列表，换公众号后仍然相同。依赖该私有链路的
公众号搜索、按公众号抓取和订阅不再具备可交付性。

这次变化撤下一整条产品主线，不是 v0.8.5 的普通补丁。v0.9.0 用明确的版本变化告诉用户：

- 输入边界改变：不再负责“发现文章”，只接收明确文章 URL；
- 当前可用能力减少，但剩余闭环可以真实验收；
- 旧实现和用户历史数据保留，不通过删除代码制造不可逆迁移；
- 新的监控或发现方案必须先独立验证，不能未经验证重新塞回 wx-kit。

## 3. 版本范围

### R1 · 版本基线重置

- v0.8.6 不发布：M44–M47 作为未发布的底层治理成果，由 v0.9.0 选择性吸收。
- v0.8.7 不发布：订阅相关需求取消，README 重做和安全维护迁入 v0.9.0。
- `docs/PRD-v0.8.6.md`、`docs/PRD-v0.8.7.md` 保留为历史和需求去向记录，不删除。
- 本文件是 v0.9.0 唯一验收契约。
- `package.json`、`package-lock.json` 和安装包版本统一为 0.9.0。

### R2 · M49 私有文章列表能力退场（已完成）

GUI：

- 下载页只显示按 URL 下载；
- 删除订阅导航和路由，旧地址回到下载页；
- 设置页隐藏公众号账号、请求保护和订阅配置；
- 旧公众号下载历史继续可见，但不再提供会进入失效流程的重复抓取动作。

后台和 CLI：

- 应用启动不创建订阅调度器、不读取订阅角标；
- 私有后台 IPC 返回稳定停用结果；
- 网关在 transport 前拒绝 `auth-verify`、`account-search`、`article-list`；
- `search`、`crawl`、`login`、`auth-status`、`session`、`subscription`、`protection`
  保留命令名和旧实现，生产入口统一返回 `MP_BACKEND_UNAVAILABLE`、退出码 1；
- 文章页面、图片、封面和视频等按 URL 下载请求继续允许。

数据和代码：

- 旧订阅数据、检查日志、设置字段、认证/订阅实现不删除、不迁移；
- 旧设置字段不再展示或修改；
- 休眠实现只维持 lint 和类型检查，不再承担业务行为测试成本。

### R3 · M44–M47 成果取舍

保留：

- Electron Chromium Session 请求栈，用于文章页面和媒体下载；
- 统一请求入口、敏感 URL 脱敏审计、请求取消和明确频控后停手；
- M47 的安全会话清理实现，作为休眠代码保留。

退场：

- 面向用户的请求保护状态、暂停/恢复和公众号账号入口；
- 网络封锁 e2e 模式及其生产请求钩子；
- M47 真实账号 A→B 切换验收，因为用户入口已经退场。

显式 URL 下载代表新的用户动作，可以恢复旧版本遗留的暂停状态；不能因隐藏 protection UI 让核心下载永久锁死。

### R4 · M50 依赖安全维护（已完成）

- 实施当天重新读取 GitHub Dependabot 告警，不沿用旧统计数字；
- 能通过 patch/minor 修复且影响当前路径的告警全部升级；
- 需要 major 且当前路径不可达的告警逐条留下不升级或 dismiss 理由；
- 使用 GitHub Dependabot 和官方 npm registry 审计交叉核实；
- 依赖升级必须通过打包应用和真实 URL 下载，不能只凭单元测试结论。

实施结果：2026-08-08 GitHub API 读取到 28 条 open、0 条 dismissed；官方 npm registry 审计另发现
尚未全部进入 Dependabot 的 Electron、`tar`、`nanoid` 等问题。Axios 升至 1.19.0、Electron 42.8.1、
React Router 7.18.2、Electron Builder 26.15.3、PostCSS 8.5.26，并更新相关传递依赖；官方 npm
全量审计最终为 0。没有需要 major 升级或 dismiss 的剩余项。

实施阶段按约定未 push，因此 GitHub 一度仍按远端旧 lockfile 显示 28 条 open。2026-08-09 正式发版
推送后重新读取 Dependabot API，结果为 0 open、0 dismissed；本地官方 npm 审计与远端告警现已同时清零。

### R5 · M51 当前产品说明与发布准备（已完成）

- README 只描述当前有效能力，完整版本史归 ROADMAP；
- README 如展示截图，只展示 URL 下载、文库、阅读器、设置四类当前页面；
- 截图来自 v0.9.0 当前界面和真实文章数据态，不展示已退场页面；
- `wx-kit-skill` 和 `wx-kit-compose` 不再引导 agent 使用私有后台命令；
- 发布说明必须明确能力退场、数据保留、CLI 兼容行为和替代路径；
- v0.9.0 正式发布包含版本升级、三平台出包、打包应用验证、GitHub Release 和 brew tap 核实。

## 4. 里程碑

- **M44–M47 · 未发布底层治理**：有效部分由 v0.9.0 吸收，失去产品载体的 UI/验收由 M49 终止。
- **M49 · 私有文章列表能力退场**：已完成并通过当前 GUI 与真实文章 URL 验收。
- **M50 · 依赖安全维护与运行时回归**：已完成；本地官方审计与发布后 GitHub Dependabot 均为 0。
- **M51 · 当前产品说明与发布准备**：已完成；有效页面截图、README/Skill、发布说明和打包应用均已验收。

## 5. 验收契约

### M49 已完成证据（2026-08-08）

- [x] GUI 不再出现按公众号下载、订阅及相关设置，旧订阅路径不能进入失效页面。
- [x] 应用启动不创建订阅调度，不读取订阅角标；私有请求在 transport 前被拒绝。
- [x] 停用 CLI 返回稳定 JSON 与退出码 1，不误开 GUI、不访问私有后台。
- [x] 旧实现源码和用户数据保留；旧功能测试清理，新的停用边界测试通过。
- [x] 44 个测试文件、388 项单测、lint、typecheck、当前 GUI fixture e2e 通过。
- [x] 真实样本 `https://mp.weixin.qq.com/s/th7sbu0S_FohVpPo0m3Xqw` 完成
      cover/Markdown/HTML/meta、文库、历史和阅读器验收，审计无 `/cgi-bin/`。
- [x] macOS arm64/x64 应用及 DMG 构建完成。

### v0.9.0 完整验收

- [x] 实时 Dependabot 告警已重新获取：28 open、0 dismissed，并与官方 npm 审计交叉核实。
- [x] 本地依赖图已修复全部可达告警；官方 npm 全量审计为 0，没有无理由忽略或 dismiss。
- [x] 正式发版推送后 Dependabot API 为 0 open、0 dismissed，远端自动关闭已核实。
- [x] README、四张真实数据截图、Skill、ROADMAP、发布说明与当前产品边界一致。
- [x] 干净 `npm ci` 可复现；`npm test`（44 个文件、389 项）、lint、typecheck、GUI fixture e2e、真实 URL e2e、build 全部通过。
- [x] 打包后的 macOS `.app` 正常启动；内层 CLI 的真实 URL 下载和停用命令均通过。
- [x] 三平台资产、GitHub Release 与 brew tap 全部发布并逐项核实。
- [x] npm `@simiam/wx-kit@0.9.0` 发布为 `latest`；从官方 registry 隔离安装后，版本、停用命令与真实 URL 下载均通过。

打包态证据：arm64 GUI 显示 URL 下载/文库/设置且无退场入口；内层 CLI `search` 返回
`MP_BACKEND_UNAVAILABLE` 与退出码 1；在独立 `--user-data-dir` 中真实 `download` 成功产出 md/meta，
审计无 `/cgi-bin/`。macOS arm64/x64 应用与 DMG、Windows x64 NSIS 安装包均完成构建。

## 6. 非目标

- 不恢复公众号搜索、按公众号抓取、订阅、digest 或后台登录；
- 不删除 M49 保留的休眠实现和历史数据；
- 不通过换账号、换接口、换 Header 或自动探测尝试绕过微信限制；
- 不把新的模拟器/RPA 监控方案直接集成进 wx-kit；
- 不在本轮增加全文检索、整本导出、Windows CLI wrapper 等新产品能力；
