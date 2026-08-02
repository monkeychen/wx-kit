# v0.8.6 M44–M46 请求指纹与全局频控治理实现计划

> 日期:2026-08-02
> 对应需求:`docs/PRD-v0.8.6.md`
> 状态:待实现
> **网络红线**:安哥明确解除前,所有任务只能使用 fake transport、fixture 和隔离 userData,
> 不得登录、探测、搜索、抓取、检查订阅或下载任何真实微信资源。

## 0. 实现原则

1. **先堵旁路,再调参数**:没有统一出口时,任何局部随机延迟都是假安全。
2. **策略纯逻辑,网络薄适配**:频控决策放 `src/core`,Electron 只负责 Session、文件状态和等待。
3. **先失败再实现**:每个行为先写会失败的测试,测试 transport 只计数,绝不联网。
4. **频控不是可重试错误**:高置信风险信号打开持久熔断,不自动探测恢复。
5. **不伪造浏览器 Header**:用 Chromium Session 的真实行为替代手工拼接。
6. **冻结期不做 live smoke**:离线通过只能证明客户端行为,不能证明微信侧已恢复。

## 1. 目标结构

```text
GUI / CLI / scheduler / subscription / crawl / download
                         │
                         ▼
               MpRequestGateway(唯一出口)
               ├─ MpRequestGovernor(纯策略)
               ├─ MpRequestStateStore(持久状态)
               ├─ MpRequestLease(跨进程预约)
               ├─ ChromiumMpTransport(Session.fetch)
               └─ MpRequestAudit(脱敏决策日志)
                         │
                         ▼
              persist:mpweixin Chromium Session
```

业务层仍只依赖小接口:

- `MpFetch(endpoint, params)`供 `mp-client.ts` 使用;
- `fetchHtml(url)` / `fetchBinary(url)`供下载核心层注入;
- 业务层不知道 Electron Session,也无权绕开网关。

## 2. M44 · 全局请求治理与熔断

### Task 1 · 用测试钉住当前危险行为

**新增**:`tests/core/mp-request-governor.test.ts`

先写失败用例:

- 两个入口同时申请后台请求,第二个只能得到晚于第一个的预约时间。
- 随机间隔使用注入的 RNG,测试不依赖真实 `Math.random()`。
- 用户暂停/冻结状态下 transport 调用次数为 0。
- 模拟 `200013` 后状态变为 `rate-limited`,后续所有类别调用次数为 0。
- 熔断状态序列化再加载后仍生效。
- 取消等待后不调用 transport。
- 普通超时不会伪装成频控,但也不会自动紧密重试。

**新增**:`tests/electron/mp-request-state.test.ts`

- 用临时目录验证原子读写与损坏文件回退为“保护性暂停”,不能回退成无限制放行。
- 两个 store 实例并发预约时不得得到同一执行窗口。
- 过期 lease 可恢复,活跃 lease 不可被抢。

### Task 2 · 建纯逻辑 governor

**新增**:`src/core/mp-request-governor.ts`

核心类型:

```ts
export type MpRequestKind =
  | 'auth-verify' | 'account-search' | 'article-list'
  | 'article-page' | 'article-asset'

export type MpProtectionMode = 'active' | 'user-paused' | 'rate-limited'

export interface MpRequestState {
  mode: MpProtectionMode
  lastRequestAt: number | null
  nextAllowedAt: number
  pausedReason?: string
  rateLimitSignal?: string
  updatedAt: number
}
```

提供纯函数/类:

- `planRequest(state, request, now, rng)` → `allow-now | wait-until | reject`;
- `reserveRequest(...)` → 在发请求前推进 `nextAllowedAt`;
- `recordResponse(...)` → 普通成功/失败更新状态;
- `tripRateLimit(...)` → 持久熔断;
- `resumeProtection(...)` → 只响应明确用户动作。

默认策略以保守为先:

- 后台接口全局严格串行,请求间隔使用区间随机值,不写固定整秒;
- 同账号翻页、跨账号首屏、搜索/列表使用不同区间;
- 文章页面是另一个受控动作;同一篇文章内部资源是有上限的资源阶段,
  不把每张图片伪装成一次“人工点击”;
- 参数集中在一处并写明“经验保护值,非微信官方阈值”,不暴露“极速档”。

### Task 3 · 持久状态与跨进程预约

**新增**:`electron/services/mp-request-state.ts`

- 状态文件:`<userData>/mp-request-state.json`;
- lease 文件:`<userData>/mp-request-state.lock`;
- 使用原子写,权限 0600;
- lease 只保护“读取状态→预约→写回”这个短临界区,不在整个网络请求期间长期持锁;
- lease 内容包含 pid/创建时间,仅超出明确上限才视为陈旧;
- 解析失败或无法确认状态时 fail closed,返回保护性暂停并给出修复提示。

跨进程流程:

1. 获取短 lease;
2. 读取持久状态并执行 `planRequest`;
3. 若需等待,释放 lease后等待,到点重新竞争,不能拿旧决定直接发;
4. 获准时先持久化预约窗口再释放 lease;
5. 调用 transport;
6. 再次短 lease 写入结果或熔断。

### Task 4 · 唯一 gateway 与结构化错误

**新增**:`electron/services/mp-request-gateway.ts`

- `requestJson`、`fetchHtml`、`fetchBinary`都经过同一 `execute()`;
- 注入 `clock`、`rng`、`wait`、`transport`、`stateStore`、`audit`;
- 等待支持 `AbortSignal`;
- 识别 `base_resp.ret=200013`、HTTP 429及高置信验证页信号,调用 `tripRateLimit`;
- 频控不重试;普通错误也由业务显式决定是否重试,网关不暗中重放;
- 错误码:`MP_GOVERNOR_PAUSED`、`MP_RATE_LIMITED`、`MP_COOLDOWN`。

### Task 5 · 删除 crawl 的频控重试

**修改**:`src/core/mp-crawl.ts`
**修改**:`tests/core/mp-crawl.test.ts`

- 删除 30/60/90 秒自动重试循环和 `onBackoff` 的“即将重试”语义;
- 命中 `MpRateLimited` 立即结束列表阶段并把错误交给全局网关/调用方;
- UI 进度改为“已停止所有微信访问”,不再倒计时后重试;
- 保留取消能力,但不再为等待一个危险重试服务。

## 3. M45 · Chromium 会话请求栈

### Task 6 · 登录分区常量与 Cookie Jar 单一真相

**新增**:`electron/services/mp-session.ts`
**修改**:`electron/services/mp-auth.ts`
**修改**:`electron/services/session-transfer.ts`

- 唯一定义 `MP_PARTITION = 'persist:mpweixin'`;
- 登录窗口、请求 transport、重新登录/退出登录(R5 已顺延到 v0.8.7,但底层常量可先复用)都引用它;
- 扫码完成后保留 token/时间等元数据,运行时 Cookie 从 Session Cookie Jar 读取;
- 导入 session 时把 Cookie 明确恢复到该 Session,不再只写一份孤立 JSON;
- 导出格式若需补 domain/path/secure/expires,提供向后兼容解析,旧 name/value 文件仍能导入;
- 文件与 Cookie Jar 写入失败时不产生“半登录成功”。

### Task 7 · Chromium transport

**新增**:`electron/services/mp-chromium-transport.ts`
**新增**:`tests/electron/mp-chromium-transport.test.ts`

- 使用 `session.fromPartition(MP_PARTITION).fetch()`;
- 不手工设置固定 Mac Chrome 124 UA,不手工拼 Cookie;
- 后台 JSON、HTML、binary 都通过同一个 Session;
- 保留现有分档超时与 body 大小能力,超时由 `AbortSignal` 统一实现;
- 非 2xx、JSON 解析失败、超时返回可分类错误;
- transport 测试注入 fake Session/fetch,只检查调用参数与响应解析,不联网。

### Task 8 · 替换所有生产调用点

**修改**:

- `electron/services/mp-fetch.ts`
- `src/core/fetch-html.ts`
- `electron/ipc.ts`
- `src/cli/index.ts`
- `electron/services/subscription-check.ts`
- 相关单测

步骤:

1. `makeMpFetch`改为由 gateway 提供,不再直接 `axios.get`;
2. 生产 `fetchHtml/fetchBinary`改成 gateway 注入版本;
3. core 保留纯函数与依赖接口,不 import Electron;
4. GUI 与 CLI 启动各构造一个 gateway,所有业务复用;
5. 删除微信生产路径对 axios 的依赖后再决定是否保留 axios给非微信用途;
6. 加静态检查脚本,发现微信域名旁边出现 `axios`/Node fetch 即失败。

## 4. M46 · 隐藏请求、可观测性与离线验收

### Task 9 · 把登录状态查询改成本地

**修改**:`electron/ipc.ts`
**修改**:`src/cli/index.ts`
**修改**:`src/renderer/components/download/AccountMode.tsx`
**修改**:对应 IPC/CLI/renderer 测试

- `mp:authStatus`只读本地 session 元数据/Cookie Jar 是否存在,不调用 `searchAccount('腾讯')`;
- CLI `auth-status`默认返回 `{valid:'unknown'|'known-valid'|'known-expired', checkedAt}`一类诚实状态;
- 删除固定关键词“腾讯”的隐藏探测;
- `session import`导入后返回 `valid:null`,显式 `--verify`才申请一次网关请求;
- 所有文案区分“本地有登录态”与“已向微信验证有效”,不能把前者说成后者。

### Task 10 · 修复 digest 与其它旁路节奏

**修改**:`src/core/subscription-digest.ts`
**修改**:`src/core/check-subscriptions.ts`
**修改**:`src/core/mp-client.ts`
**修改**:对应测试

- digest 每个账号的首屏也必须申请全局后台请求窗口;
- 移除业务层散落的 `randMs/sleep`,等待统一由 gateway 决策;
- scheduler、手动 check、建立 watermark、search、crawl 共享 gateway;
- `checkInFlight`仍用于合并同一次订阅检查,但不再被误认为全局频控;
- 多个 DownloadQueue 同时存在时,真正的出网仍由 gateway 收口。

### Task 11 · 保护状态 UI、CLI 与审计日志

**修改**:

- `electron/preload.ts`
- `src/renderer/api.ts`
- `src/renderer/pages/Settings.tsx`
- `src/renderer/components/download/AccountMode.tsx`
- `src/renderer/pages/Subscriptions.tsx`
- `src/cli/index.ts`

**新增**:`electron/services/mp-request-audit.ts`

- 设置页“微信请求保护”展示 mode、reason、lastRequestAt、nextAllowedAt、queued;
- v0.8.6 首次读取不到既有治理状态时初始化为“保护性暂停”,用户明确恢复后才允许微信请求;
- 频控熔断时停止 scheduler,所有入口显示同一原因;
- GUI 提供“暂停所有微信访问”和“恢复请求”动作;恢复不是验证,不会立即联网;
- CLI 增加只读状态与显式 pause/resume入口,stdout纯JSON;
- 审计日志只写脱敏 path/类别/决策,用单测扫描 token/Cookie/完整 query 不得出现。

### Task 12 · 网络封锁模式

**新增**:`electron/services/wechat-network-freeze.ts`
**修改**:`tests/e2e/gui.e2e.mjs`
**修改**:`package.json`

- 环境变量 `WX_KIT_BLOCK_WECHAT_NETWORK=1` 时,对专用 Session 和 defaultSession 注册
  `webRequest.onBeforeRequest`,命中微信相关 host 立即 cancel 并记录测试失败信号;
- 覆盖至少:`mp.weixin.qq.com`、`weixin.qq.com`子域、`mmbiz.qpic.cn`及代码解析出的微信媒体 host;
- 由于 Chromium block 拦不住 Node axios,再用静态检查保证生产代码没有 Node 微信旁路;
- e2e 必须以隔离 userData + block 模式启动;
- 增加 `test:offline-e2e`或让现有 `test:e2e`默认开启 block;live smoke 不属于默认测试。

### Task 13 · 全量离线验证

只允许运行:

```bash
npm test
npm run lint
npm run typecheck
npm run test:e2e
npm run build
```

前提:

- e2e/build 后的启动验证使用隔离 userData;
- `WX_KIT_BLOCK_WECHAT_NETWORK=1`;
- 测试输出明确打印拦截计数为 0;
- 不运行任何 `live`、`login`、`auth-status --verify`、search、crawl、subscription check/digest、download命令。

验收报告必须分开写:

- 已验证:纯策略、跨入口收口、持久熔断、网络封锁、UI/CLI反馈、fixture解析、构建启动;
- 未验证:真实微信兼容性、当前账号/IP是否解除频控、微信是否接受新的请求栈。

## 5. 文档与发版收尾

实现完成后同步:

- `ROADMAP.md`:M44–M46状态;
- `docs/devlog/wx-kit-vibe-coding.md`:记录“局部 sleep 不等于全局治理”、隐藏探测、
  Node/Chromium 指纹割裂、200013重试反模式、冻结期验证边界;
- `agent/wx-kit-skill/`:若 CLI 状态/pause/resume/auth-status输出变化,同步命令参考和范例;
- `docs/releases/v0.8.6.md`:明确这是紧急保护版,以及“未做真实微信联调”的限制;
- `README.md`:只同步最新版本与用户可见的保护状态,不提前做已顺延到 v0.8.7 的整体重写。

## 6. 解冻后的首次真实验证(现在不执行)

只有安哥明确说“可以恢复真实访问”后才写入执行状态:

1. 确认旧 wx-kit 全部退出、只有一个 v0.8.6 进程;
2. 请求保护先保持暂停,检查状态/日志均为零访问;
3. 用户手动恢复,只做一个明确动作;
4. 最多一次后台请求,零重试;若出现任何风险信号立即熔断并停止;
5. 不在同一天继续用更多请求“定位原因”;
6. 结果只用于兼容性确认,不据一次成功宣称“以后不会频控”。
