# Dependabot audit 收尾（v0.2.0 → v0.2.1 预热）

> 26 个 Dependabot 漏洞全部是**间接依赖**（package-lock.json 的传递依赖）。实际可动手的只有 3 个直接依赖：`electron` / `vite` / `vitest`，外加 `electron-builder`（它拽的 tar/glob 漏洞）。**不盲升**——CLAUDE.md 记的 undici 必须 external、@electron/rebuild 等对版本敏感。

## 漏洞分布（来自 Dependabot API）
- `electron` 31.7.7 → 15 条（运行时，必升）
- `vite` v5.4.21 → 1 条（devDep）
- `vitest` v2 → 1 条（devDep）
- `esbuild` → 1 条（仅 `vite dev` 触发；生产 build 不受影响，vite 升级一并修）
- `tar` → 4 条（electron-builder 间接，build 时）
- `glob` → 1 条（electron-builder 间接，CLI 工具链）

## 策略：分批最小升级、每批全套验证
每升一个直接依赖跑：
- `npm test`（119 单测）
- `npx tsc --noEmit -p tsconfig.json`
- `npm run lint`
- `npm run test:e2e`（24 条 e2e，含真实公众号链路）
- 用 `npm audit` 比对前后漏洞数

## Batch 计划

### B1 · `electron` 31.x → 31.x 最新补丁
**保守升级**，不跨大版本（CLAUDE.md 规约）。先 `npm install -D electron@31` 取 31.x 末版，验证打包与启动都正常。

### B2 · `electron-builder` 24.x → 24.x 最新
间接修 tar/glob。同样不跨大版本。

### B3 · `vitest` v2 → v3
`vitest@3` 改了一些 API（`expect.assertions`/`expect.objectContaining`），小心测试里是否用过。先看 diff。

### B4 · `vite` v5 → v6
v5→v6 是大版本。vite.config 改用 `defineConfig` 形态、`assetsInlineLimit` 单位从 KB 改 B、SSR 行为等。我们的 vite.config 简单，先试再修。

## 验证口径
- 单测 119 全绿、tsc/lint 干净
- e2e 24 全绿（重点看 vite 升级后 vite-plugin-electron/vite-plugin-electron-renderer 是否兼容）
- `npm audit` 漏洞数 < 5
- 重新构建 `npm run build`，mac dmg + win exe 都出包
- 真实 session e2e 跑一次，确认升级没破运行时

## 不在范围
- Dependabot 数量降到 0（有些 CVE 在 31.x 仍未修；要彻底清需升 electron 32+，那是另一个版本号 v0.3.0 决定的事）
- 重写 `vite.config.ts` 之外的构建配置
