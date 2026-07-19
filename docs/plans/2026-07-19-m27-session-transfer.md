# M27 · session 跨机器导出/导入（v0.6.0 R5）

> 需求/验收见 `docs/PRD-v0.6.0.md` R5。分支 `feat/m27-session-transfer`。TDD:纯逻辑先测。

## 1. 纯逻辑(electron/services/mp-auth.ts 旁,或独立 session-transfer.ts)

```ts
/** 校验导入文件的最小结构:token 非空字符串 + cookies 数组(name/value 字符串)。 */
export function validateSessionShape(raw: unknown): { ok: true; session: MpSession } | { ok: false; error: string }
```

导出/导入本体走注入路径的纯文件操作(可单测):
- `exportSession(sessionPath, outPath)`:读→写(mode 0600),源不存在报错。
- `importSession(filePath, sessionPath)`:读→validate→写 sessionPath(0600)。

## 2. CLI 命令组 `session`

- `session export [-o <file>]`(默认 `./wx-kit-session.json`):成功 outJson `{ok:true, path, warning:"此文件等同登录态,勿提交仓库/勿外传"}`;无 session → `{ok:false, error:{code:'NO_SESSION'}}` 退出码 1。
- `session import <file>`:结构非法 → `CLI_ERROR` 退出码 2、不写入;合法 → 写入后用 `searchAccount` 真探测(auth-status 同款),输出 `{ok:true, valid:true|false}`(失效仍导入,提示可能需重新扫码),网络错误 `valid` 置 `null` 并带 note。
- 顶层帮助 examples 与命令组 description 同步(R3 的规范)。

## 3. 测试

- validateSessionShape 矩阵:合法 / 缺 token / token 非串 / cookies 非数组 / cookie 项缺 name / 非对象。
- export/import 文件操作:0600 权限、源缺失报错、导入不破坏既有(非法时)。
- CLI 契约测试(tests/cli):export 无 session 退 1;import 非法文件退 2;import 合法 + mock 探测成功/失败。

## 4. 真机验证

本机 login 后 `session export` → 隔离 userData(`--user-data-dir` 不可用,用 tarball npm 全局装的实例或直接指定 HOME 无效——用 mac 打包态 + 临时 userData 的 Playwright 不适合 CLI;改用**两个 npm 隔离 prefix 实例**或直接 `-o` 到文件后手动放入隔离实例 userData)→ `session import` → `auth-status` valid:true → `search` 真查询成功。

## 5. 收尾

单测/lint/tsc/e2e 全量;合 main 删分支;ROADMAP M27 ✅。
