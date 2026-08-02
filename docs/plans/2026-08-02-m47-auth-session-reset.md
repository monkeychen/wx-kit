# v0.8.6 M47 公众号会话重置实现计划

> 日期：2026-08-02
> 对应需求：`docs/PRD-v0.8.6.md` R8
> 状态：实现与离线验收完成，真实账号切换待解冻
> **网络红线**：安哥明确解除前，只能使用 fake Electron Session、临时 userData 和网络封锁 e2e；不得打开真实扫码页、探测登录态或访问任何微信资源。

## 1. 问题与边界

当前应用没有安全的重新登录/退出登录入口。手工删除
`~/Library/Application Support/wx-kit` 虽能清 Cookie，也会连带删除 `settings.json`，
已经造成每日检查时刻、默认下载格式等用户设置回到默认值。

M47 只清应用管理的公众号登录态：

- `userData/mp-session.json`；
- 专用 `persist:mpweixin` 分区中的全部站点存储；
- 该分区的 HTTP 缓存、HTTP 认证缓存和现有连接。

必须保留：`settings.json`、订阅、文库、下载历史、请求审计和频控熔断状态。
退出登录不能成为绕过频控保护的开关。

## 2. 用户语义

- **扫码登录**：即使本地 session 文件缺失，也先清空分区里的旧登录残留，再打开扫码窗口。
- **重新登录**：先通过请求保护闸确认允许用户发起登录，再彻底清旧会话，最后打开扫码窗口；用户取消后保持未登录。
- **退出登录**：纯本地清理，不经过请求网关、不联网；完成后设置页立即显示未登录。
- 任一清理步骤失败都返回失败步骤，不显示“已退出”；其余清理步骤仍继续尝试，尽量减少残留。

## 3. TDD 任务

### Task 1 · 会话清理服务

**修改**：`electron/services/mp-auth.ts`
**新增测试**：`tests/electron/mp-auth.test.ts`

1. fake Session 钉住完整清理调用：关闭连接、`clearStorageData()`、`clearCache()`、
   `clearAuthCache()`、删除 session 文件；
2. session 文件不存在时幂等成功；
3. 任一步失败时继续执行其余步骤，并抛出带失败步骤的 `MP_AUTH_CLEAR_FAILED`；
4. 清理目标只接收 `mp-session.json` 路径，不接触设置或库目录；
5. 登录窗口仍统一引用 `MP_PARTITION`。

### Task 2 · IPC 与界面

**修改**：`electron/ipc.ts`、`electron/preload.ts`、`src/renderer/api.ts`、
`src/renderer/pages/Settings.tsx`、`src/cli/index.ts`

1. 新增只读本地 `mp:sessionInfo`；
2. 新增纯本地 `mp:logout`；
3. 新增 `mp:relogin`，与 GUI/CLI 初次 `login` 共用“通过网关 → 清旧会话 → 扫码”的唯一流程；
4. 设置页新增“公众号账号”区，显示未登录/扫码时间；
5. 已登录时提供“重新登录”和“退出登录”，未登录时提供“扫码登录”；
6. 清理失败显示可行动提示，取消扫码后保持未登录且不谎报成功。

### Task 3 · 网络封锁 e2e

**修改**：`tests/e2e/gui.e2e.mjs`

1. 隔离 userData 预置 fake session 与非默认设置；
2. 设置页断言登录状态与两个入口；
3. 点击退出登录后断言状态立即变未登录、session 文件消失；
4. 断言默认下载格式和每日检查时刻保持原值；
5. 继续要求 `blockedWechatRequests === 0`。

重新登录的真实 A → B 扫码链路只在安哥明确解除微信访问冻结后执行；当前用单测覆盖
“先清理、后开窗”和取消后保持未登录。

## 4. 文档与验收

- 将 `docs/PRD-v0.8.7.md` R5 迁至 `docs/PRD-v0.8.6.md`，在 v0.8.7 留迁移说明而非重复需求；
- `ROADMAP.md` 新增 M47，并把 v0.8.6 状态改为 M44–M47 实施中/完成；
- 刷新 `docs/releases/v0.8.6.md` 与 `docs/devlog/wx-kit-vibe-coding.md`；
- 本功能不改变 CLI 命令或输出，不需刷新 agent skill 命令参考；
- 运行 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`、
  `npm run test:e2e`、`npm run build`；所有验证保持微信网络封锁。

## 5. 完成标准

- 退出登录不再需要删除整个 userData；
- 重新登录不会自动回到旧账号；
- 设置、订阅、文库、历史、审计和频控状态均不受影响；
- 清理失败不谎报成功；
- 离线测试证明零微信请求；真实账号切换明确标记为冻结期未验证。
