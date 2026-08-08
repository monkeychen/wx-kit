# v0.8.6 M49 私有文章列表能力退场实现计划

> 对应需求：`docs/PRD-v0.8.6.md` R9。
>
> 实施日期：2026-08-08。
>
> 状态：已完成。验证结果见 `docs/PRD-v0.8.6.md` M49 最终证据与 devlog §43。

## 1. 目标

微信公众平台后台已持续拒绝查询其它公众号的文章列表。M49 不再尝试通过改请求指纹、等待或切换公众号恢复这条私有链路，而是把依赖它的产品能力从当前版本退场：

- GUI 隐藏“按公众号下载”、订阅页和设置页相关配置；
- 停止订阅调度和其它后台隐式调用；
- CLI 保留旧命令名以兼容脚本，但稳定返回功能停用，不发网络请求；
- 保留旧实现代码、用户订阅数据和设置字段，暂不删除；
- 删除旧功能的单测、e2e 和 fixture，只保留停用边界测试；
- URL 文章下载继续作为核心能力，并执行真实微信文章下载验收。

M49 的关键词是**退场与隔离**，不是修复私有 API，也不是删除全部历史实现。

## 2. 已定边界

### 2.1 继续可用

- GUI 按 URL 下载、下载历史、文库、阅读器和设置中的有效配置；
- CLI `download`、`library`、`site`、`settings`、`update`、`version`；
- 文章 HTML、图片、封面和视频等直接 URL 下载所需网络请求；
- 本地文库、下载历史、订阅数据和已有设置文件。

### 2.2 停用

- 公众号后台扫码登录、重新登录、退出登录和会话迁移的用户入口；
- 公众号搜索、文章列表、按公众号抓取；
- 订阅管理、手动/自动检查、digest 和订阅下载；
- 面向用户的微信请求保护状态与恢复入口；
- CLI `search`、`crawl`、`login`、`auth-status`、`session`、`subscription`、`protection`。

### 2.3 不删除

- `src/core/mp-client.ts`、订阅 core、认证/会话和请求治理的历史实现；
- `subscriptions.json`、`subscriptions-check.log`、旧设置字段和历史记录；
- `electron/cli-dispatch.ts` 中的旧命令白名单。删除白名单会让旧命令被误判成 GUI 启动并挂起。

历史实现只要求继续通过 lint 与 TypeScript 类型检查，不再维持业务行为单测。

## 3. 实现步骤

### Task 1：版本文档先对齐

- 修改 `docs/PRD-v0.8.6.md`：从“频控修复待发布”改为“核心下载收缩与私有能力退场”，新增 R9/M49 和新的验收契约；删除“全程零微信访问”的旧发布结论。
- 修改 `ROADMAP.md`：M49 并入尚未发布的 v0.8.6；v0.8.7 的订阅专属需求取消，其它需求待 M49 后重排。
- 不发布当前 M44–M47 形态的 v0.8.6。

### Task 2：GUI 退场

- `Download.tsx` 只呈现按 URL 下载；保留原公众号模式实现代码，但不再进入渲染和执行路径。
- `App.tsx` 删除订阅路由；`MainLayout.tsx` 删除订阅导航、角标读取和更新监听。
- `Settings.tsx` 隐藏公众号账号、请求保护和订阅设置；保留设置字段，不做数据迁移。
- 旧 `/subscriptions` hash 路径由通配路由回到下载页，不展示失效页面。

### Task 3：后台执行链路退场

- 应用启动不创建订阅调度器。
- IPC 的公众号搜索、抓取、登录、认证状态、保护状态和订阅动作改为稳定的停用响应，或者不再暴露给有效 UI；任何路径都不得触发私有 API。
- 请求网关在 transport 之前硬拒绝 `account-search`、`article-list` 和 `auth-verify`，错误码统一为 `MP_BACKEND_UNAVAILABLE`。
- `article-page`、`article-asset`、`video` 等 URL 下载请求继续允许。
- 旧业务实现保留在源码中，但生产入口不再调用。

### Task 4：CLI 兼容停用

- 保留旧顶层命令名和 `CLI_COMMANDS` 白名单。
- 停用命令不再读取 session、初始化旧业务或调用 transport，统一输出：

```json
{
  "ok": false,
  "error": {
    "code": "MP_BACKEND_UNAVAILABLE",
    "message": "微信公众号后台已限制查询其他公众号的文章列表，该命令已停用，未发起网络请求。",
    "alternative": "请使用 wx-kit download --url <文章链接>"
  }
}
```

- 退出码为 1；stdout 保持纯 JSON；`--help` 把这些命令标为“已停用”。
- `settings get` 不展示失效字段；`settings set` 修改失效字段时返回同类停用结果，底层旧值不删除。
- 同步更新 `agent/wx-kit-skill/`，不再把停用命令描述成可用能力。

### Task 5：测试清理与替换

直接删除旧功能专属测试：

- 公众号搜索/列表、认证/会话、订阅 store/check/schedule/digest/ref 等单元测试；
- 订阅调度、公众号登录、私有 API 请求治理的旧 Electron 测试；
- GUI e2e 中按公众号下载、订阅、登录、请求保护和网络封锁断言；
- 只服务于上述场景的 fixture。

更新仍有价值的共享测试：

- CLI 契约：旧命令稳定返回 `MP_BACKEND_UNAVAILABLE`、退出码 1、不会误开 GUI；
- 请求网关：私有类别在 transport 前被拒绝，URL 下载类别不受影响；
- 应用/IPC：不再启动订阅调度，不存在隐藏私有请求入口；
- 设置：有效字段继续工作，旧字段保留但不展示。

不保留“网络封锁下的 GUI e2e”。私有 API 零调用由注入 transport spy 的单元/集成测试证明。

### Task 6：真实验收

依次运行：

1. `npm test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test:e2e`：只覆盖仍有效 GUI 流程
5. 使用隔离临时文库，对一篇确认有效的真实公众号文章 URL 执行下载验收
6. `npm run build`

真实 URL 下载验收允许访问文章 HTML 和文章资源，但不得调用公众号后台搜索、文章列表、登录或订阅接口。至少核实正文产物、媒体、本地文库和下载历史；临时数据在验收后清理。

### Task 7：文档与 Git 收尾

- 更新 README：移除公众号批量下载、订阅和后台登录的当前能力说明。
- 更新 `agent/wx-kit-skill/` 的能力边界、命令参考和范例。
- 更新 `docs/devlog/wx-kit-vibe-coding.md`，记录从“频控治理”转向“能力退场”的产品判断。
- 在 `feat/m49-disable-private-api` 提交，合回本地 `main` 并删除 feature 分支；不 push。

## 4. 完成定义

- GUI 看不到“按公众号下载”、订阅页和相关设置；直接访问旧路径也不会进入失效功能。
- 应用启动不再查询订阅、不启动订阅检查调度。
- 所有旧 CLI 命令仍被识别为 CLI，返回稳定 JSON 后退出，不打开 GUI、不访问微信后台。
- 任意调用方请求私有类别时在 transport 前被拒绝；URL 下载请求正常。
- 旧实现代码与用户数据保留，没有迁移或删除。
- 旧功能测试已删除，新的停用边界测试通过。
- GUI 有效流程 e2e、真实 URL 下载、lint、typecheck、build 全部通过。
