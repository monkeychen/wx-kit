# M60 · R3 启动检测 mocli + mocli 封装层 + 发现链路 + CLI 骨架（v0.11.0）

> 需求/验收：`docs/PRD-v0.11.0.md` §3 R3、§6 R3、R2d（CLI 五个只读命令；`import` 属 M61）。
> 本里程碑不碰 GUI 墨问 tab、不碰正文通道（note-show / browser-render 均 M61）。

## 关键事实（plan 前实测 mocli v0.5.4，改变/钉死实现形状）

1. **mocli 输出契约**：stdout 恒为单行 JSON `{code, status, reply?, reason?, msg?, meta.hints?, api_error?}`。
   成功 `code:0`；失败退出码非零（实测 `user search` 空 keyword → `code:2 VALIDATE`；坏 noteId → `code:7 NOT_FOUND`）。
   → runner 统一规则：**exit!==0 或 code!==0 → 抛 `MocliFailed(reason, msg)`**；解析后按需取 `reply`。
2. **`user search`**：`reply:{uids:[...], users:{<uid>:{uid,name,intro,home_url}}}`——候选列表从 `uids` 顺序取 `users` 映射。
3. **`notes homepage`**：`reply:{note_ids:[], notes:{<id>:{note_id,uid,title,brief,url,created_at,updated_at,public_at,flag:{with_text,with_image,with_fee,...},content:{word_count},status:{public_status,audit_status},stat:{view,favor,share,comment}}}}`——清单展示（标题/时间/字数/付费标记）字段齐全，无需二次 `note info`。
4. **`auth info`**：`reply.auth.mo_uid` = 当前认证身份（安哥 = `4L8RrxEaExmHJOf9xrGLo`）；`api_key` 已自动打码，无需 redact。
5. **`mocli --version`** → `mocli version v0.5.4 (PROD-BUILD ...)`（单行文本，非 JSON）。
6. **检测方式**：`execFile('which'|'where', ['mocli'])`（node:child_process），win 用 `where`。
7. **CLI 白名单**在 `electron/cli-dispatch.ts` 的 `CLI_COMMANDS`——加 `'mowen'`；commander 分组命令模式参照 `protection`/`library`。
8. **settings 是扁平键结构**（`AppSettings` interface）——PRD 的 `mowen.mocliPath` 记法落为 `mowenMocliPath: string | null` / `mowenMocliVersion: string | null` / `mowenDetectedAt: string | null`。
9. **URL 形态**：`note.mowen.cn/detail/<id>`，id 实测 20–24 位 `[A-Za-z0-9_-]`（`sR7--cPyh93LY0inGk2yX`=22、`Ni2ZIpWVBtm1qu8sAmihb`=21）。

## 设计决定

- **spawn 全部走注入的 runner**：`type MocliRunner = (args: string[], timeoutMs?: number) => Promise<MocliRunResult>`；
  core 层（`detect.ts`/`metadata.ts`）只认 runner，node:child_process 的具体实现放
  `src/core/mowen/runner.ts`（纯 node，无 electron 依赖）——单测 mock runner，零子进程。
- **detect 与「调用」分离**：`detect.ts` 只回答「装没装、在哪、什么版本」；`metadata.ts` 只管发命令解析响应。
  R3 启动检测 = `detect`；R2 发现链路 = `metadata`。auth 身份（`authInfo()`）放 metadata，M61 的「自己笔记」判断用。
- **URL 路由本里程碑只做识别纯函数**（`isMowenNoteUrl` / `extractMowenNoteId` + 单测）；
  `download-article.ts` 的 mowen 分支接线随 M61 的 note-show 一起落——**避免 main 上出现「识别了但下不了」的半成品中间态**。
- **R3 检测失败必须隔离**：启动检测整体 try/catch，任何异常只写 `mowenMocliPath: null` + stderr 一行，不阻塞窗口创建。
- **CLI 五命令全部只读**，输出 JSON 契约与其他命令一致（`outJson`）；`import` 不在本里程碑（M61）。

## T1 · runner + detect + 单测（TDD 红→绿）

**新文件 `src/core/mowen/types.ts`**：

```ts
export interface MocliRunResult { code: number; stdout: string; stderr: string }
export type MocliRunner = (args: string[], timeoutMs?: number) => Promise<MocliRunResult>

export interface MowenUser { uid: string; name: string; intro: string; homeUrl: string }
export interface MowenNoteListItem {
  noteId: string; uid: string; title: string; brief: string; url: string
  publicAt: number | null          // unix 秒
  withFee: boolean; withImage: boolean; withText: boolean
  wordCount: number | null
  viewCount: number | null; favorCount: number | null
}
```

**`src/core/mowen/errors.ts`**：`MocliNotFound`（which 失败；附平台安装命令文案）/ `MocliFailed`（携带 `reason`/`msg`，透传 mocli 的 reason）。

**`src/core/mowen/runner.ts`**：`createMocliRunner(): MocliRunner`——`execFile('mocli', args, {timeout})`，
统一把 spawn 错误（ENOENT 等）归为 reject `MocliNotFound`，非零退出返回 `{code, stdout, stderr}` 由上层按 JSON 判。

**`src/core/mowen/detect.ts`**：

```ts
export interface MocliDetectResult { installed: boolean; path: string | null; version: string | null }
export async function detectMocli(run: MocliRunner): Promise<MocliDetectResult>
```

- `which mocli`（win: `where mocli`）失败 → `{installed:false, path:null, version:null}`（不抛，这是正常态）。
- 装了再 `mocli --version`（5s 超时）解析 `version v(\S+)`；版本探测失败不影响 installed=true。

**`tests/core/mowen/detect.test.ts`**：mock runner——未装（runner reject ENOENT）；装了有版本；装了但 --version 炸（installed 仍 true）。**不 spawn 真进程**。

## T2 · metadata.ts（发现链路）+ 单测

**`src/core/mowen/metadata.ts`**，四个函数 + 一个共享解析：

```ts
export async function searchUsers(run, keyword: string): Promise<MowenUser[]>
export async function listUserNotes(run, uid: string, opts?: { filter?: 'all'|'album'|'fee'|'popular'; recent?: string; count?: number }): Promise<MowenNoteListItem[]>
export async function listMyNotes(run, opts?): Promise<MowenNoteListItem[]>        // notes mine
export async function authInfo(run): Promise<{ moUid: string }>
// 共享:parseMocliJson(raw) → code!==0 → throw MocliFailed(reason,msg)
```

- `listUserNotes` 参数直接映射 CLI flags（`--filter`/`--recent`/`--count`）；`note_ids` 顺序为准映射 `notes`。
- `listMyNotes` 额外支持 `priv/cond-pub` filter（mocli mine 独有）。
- `MowenNoteListItem` 从实测响应字段逐一映射（`flag.with_fee`→`withFee`、`content.word_count`→`wordCount`、`stat.view`→`viewCount`），缺省 null 不猜。

**`tests/core/mowen/metadata.test.ts`**：fixture 用**当天真机响应裁剪**（已录进本 plan 上方「关键事实」）——成功映射、`code:2 VALIDATE` 抛 MocliFailed、`note_ids` 缺失容错（空数组）、字段缺省 null。

## T3 · URL 识别纯函数 + 单测

**`src/core/mowen/url.ts`**：

```ts
export function isMowenNoteUrl(url: string): boolean          // note.mowen.cn/detail/<id>
export function extractMowenNoteId(input: string): string | null
// 接受:完整 URL(带/不带 query)、裸 noteId(20-24 位 [A-Za-z0-9_-]);其余 null
```

**`tests/core/mowen/url.test.ts`**：真实 URL、带 query、裸 id、过短 id（19 位拒绝）、微信 URL 拒绝、空串拒绝。

## T4 · R3 启动检测 + settings + IPC + 设置页

**`electron/services/settings.ts`**：`AppSettings` 加三键（默认全 null），`save` 无需特判（Partial patch 已通用）。

**`electron/services/mowen-detect.ts`**（新）：

```ts
export async function runStartupMowenDetect(settings: SettingsService): Promise<void>
// detectMocli → 写 settings 三键;整体 try/catch,失败写 null + stderr 一行,绝不抛
export function registerMowenIpc(settings: SettingsService): void   // ipcMain.handle('mowen:detect') → 立即重检并返回结果
```

**`electron/main.ts`**：GUI 分支 `registerIpc` 后 fire-and-forget `void runStartupMowenDetect(settings)`（不 await，不阻塞出窗）。CLI 分支不做（R3 是 GUI 需求；CLI `mowen detect` 即时检测）。

**`electron/ipc.ts`**：调 `registerMowenIpc(settings)`。

**`electron/preload.ts` + `src/renderer/api.ts`**：`mowenDetect(): Promise<MocliDetectResult>`。

**设置页（Settings.tsx）**：新增「墨问集成」区块（`data-testid="mowen-section"`）——
- 已装：显示 `已检测到 mocli` + path + version + 「重新检测」按钮（`data-testid="mowen-redetect"`，点击转 loading、完成刷新并 toast）。
- 未装：显示「未检测到 mocli」+ 安装命令（mac: `npm install -g @mowenxd/cli`；说明经 mocli 认证后可用）。
- 读 settings 缓存渲染，挂载不重检（PRD 交互约定）。

**单测**：settings 三键读写往返（tests/electron 或 core 既有 settings 测试同款）。

## T5 · CLI 五命令 + 白名单

**`electron/cli-dispatch.ts`**：`CLI_COMMANDS` 加 `'mowen'`。

**`src/cli/index.ts`**（参照 protection 分组）：

```
mowen detect                       → detectMocli + authInfo（装了才查身份），outJson {ok, installed, path?, version?, moUid?}
mowen list-user --uid <uid> [--filter all] [--recent 7d] [--count 20]
mowen search-user --keyword <kw>
mowen list-mine [--filter priv|fee|pub|cond-pub] [--count 20]
mowen search --keyword <kw> [--count 20]
```

- 所有命令先 `detectMocli`：未装 → `outJson({ok:false, error:{code:'MOCLI_NOT_FOUND', message:'未检测到 mocli...安装指引'}})`，exit 1（**不静默**，PRD R3）。
- 透传语义：`list-user`/`list-mine`/`search` 输出 `{ok:true, notes:[MowenNoteListItem...]}`；`search-user` 输出 `{ok:true, users:[MowenUser...]}`——**统一成数组形态，不透传 mocli 原始 map**（agent 消费数组最省事；原始形态已进单测 fixture，不丢信息）。
- `tests/cli/` 有既有模式则加 CLI 分发单测（mowen 进白名单 → isCliInvocation true）。

## T6 · e2e + 收尾

- **gui.e2e.mjs**：设置页断言——「墨问集成」区块存在（`mowen-section`）；显示两种状态之一（有 mocli → 路径+版本；无 → 指引文案）；（不点「重新检测」——避免 e2e 依赖真 mocli）。
- **真机 CLI 验收**（不入 e2e）：`wx-kit mowen detect` / `search-user --keyword 池建强` / `list-user --uid vtv_... --count 2` 真跑核对 JSON。
- 全绿后：devlog 增补、PRD §6 R3 勾选（GUI/CLI 断言项）、feat/m60 → main、ROADMAP M60 行。

## 验收对照（PRD §6 R3 + R2d）

| PRD 条款 | 落点 |
|---|---|
| whenReady 后每次启动检测（mock which 单测） | T4（单测在 T1 detect 层 + T4 隔离测试） |
| 结果写 settings 三键 | T4 |
| 设置页区块（状态/重检/指引） | T4 + T6 e2e |
| 「重新检测」立即触发并刷新 | T4（IPC mowen:detect） |
| 未装时 CLI 命令报错出指引 | T5 |
| 检测失败不影响其他功能 | T4 隔离（try/catch + fire-and-forget） |
| R2d CLI detect / list-user / search-user / list-mine / search | T5 |
