# 贡献指南

欢迎贡献 wx-kit。本项目仍在第一阶段,任何规模的 PR 都受欢迎——修个 typo、加个注释、补个单测、提个 feature,都算。

## 提 Issue

- **Bug**:用 [Bug report 模板](.github/ISSUE_TEMPLATE/bug_report.md),提供复现步骤 + 预期 vs 实际 + 环境(mac/win 版本、Node 版本、wx-kit 版本)。
- **Feature**:用 [Feature request 模板](.github/ISSUE_TEMPLATE/feature_request.md),讲清楚"解决什么问题 / 理想体验 / 替代方案"。
- **安全问题**:**不要**提 issue。按 [`SECURITY.md`](SECURITY.md) 私下报告。

## 提 PR

1. **先开 issue** 讨论(对非显然改动);小改动直接 PR 也行。
2. **从 main 切分支**:`git checkout main && git checkout -b feat/xxx`(或 `fix/xxx`/`docs/xxx`/`chore/xxx`)。
3. **本地三件套**:`npm run typecheck && npm test && npm run lint` 全部通过。
4. **GUI 改动**:如有能跑的 e2e,跑 `npm run test:e2e`;在 PR 描述里说明"手动验证了哪些页面/操作"。
5. **commit message** 用英文,描述**变更意图**而非"改了 X 文件"。
6. **PR 描述**:用 `.github/PULL_REQUEST_TEMPLATE.md`,列出变更摘要 + 验证方式 + 截图(若 UI 改动)。
7. **review 通过后**会自动合入 main(项目已授权),无需你手动操作。

## 开发环境

- Node 20+
- macOS / Linux / Windows 都可;CI 友好。打包目前只验证了 mac(mac 同时出 win)。
- 推荐 `npm run dev` 起 GUI(支持热更)。

## 架构与约定

- 项目权威指南:`AGENTS.md` —— 含**已定关键决策、关键约束与已知陷阱**(必读)。
- 进度状态:`ROADMAP.md`;逐里程碑复盘:`docs/devlog/wx-kit-vibe-coding.md`。
- 设计/实现计划:分别在 `docs/superpowers/specs/` 与 `docs/plans/`。

## 风格

- 代码风格由 `eslint` 管;提交前 `npm run lint` 跑过。
- 命名:文件 kebab-case、类型 PascalCase、函数/变量 camelCase。
- 与用户的所有交流用中文(commit/注释/标识符用英文)。

## 测试

- 纯逻辑写到 `tests/core/`,TDD。
- GUI 端到端在 `tests/e2e/gui.e2e.mjs`,Playwright 驱动真实 Electron。
- 涉及真实微信后台的链路(扫码登录 + 批量爬取)由维护者手动验证,不进自动化 e2e(详见 AGENTS.md 已知约束)。

## 许可证

提交即同意按 [Apache-2.0](LICENSE) 授权。
