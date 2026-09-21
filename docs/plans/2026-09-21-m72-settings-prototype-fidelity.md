# M72 设置页原型保真复原实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task and superpowers:test-driven-development for behavior changes. 按 AGENTS 在 feature 分支完成、验证、合 main，不 push。

**Goal:** 将已实现的五类设置功能，100%复原为已确认 `settings-left-nav-v1.html` 原型的页面层级、布局、分组和视觉比例。

**Architecture:** 不再在单个 `settings-panel` 中沿用旧的 `setting-block` 长列表。抽出只负责视觉容器的 `SettingsGroup` / `SettingsRow`，由 `Settings` 继续持有既有状态与动作；每类由三张摘要卡 + 若干独立 group 卡组成。逻辑、IPC、data-testid、dirty/save/revert 契约不改变。

**Tech Stack:** React 18、Ant Design 6、现有 CSS、Vitest、Playwright Electron e2e；无新依赖。

**Spec:** `docs/PRD-v0.12.0.md` R8 / §4.5；原型源 `.superpowers/brainstorm/56694-1789954698/content/settings-left-nav-v1.html`。

## Global Constraints

- 视觉和空间关系以原型为唯一标准，包含原型中的页面副标题文本。
- 桌面容器 1420px、侧栏 248px、两栏间距 22px；窄屏仍保留 M71 横向导航降级。
- 所有设置与即时动作继续留在设置页，行为和 IPC 不变。
- 每类必须有 3 张摘要卡；每个关联组是独立 surface 卡，不复用一个大 panel。
- 组内字段必须是“左侧说明 + 右侧控件”的行布局；保存条宽度、阴影、圆角和底部位置对齐原型。

---

## Task 1：原型层级的 e2e 红灯

**Files:**
- Modify: `tests/e2e/gui.e2e.mjs`

- [x] 在进入设置时断言页面副标题完全等于原型文案。
- [x] 默认“文库与下载”断言恰有 2 个 `settings-group`：文章库、下载偏好；3 张摘要卡存在。
- [x] 依次跳转账号、自动化、AI、系统，断言各类有独立 group 卡，旧大 panel 容器不存在。
- [x] 运行 e2e，确认当前实现因缺少 group 结构/副标题而失败。

## Task 2：保真视觉容器

**Files:**
- Create: `src/renderer/components/SettingsGroup.tsx`
- Modify: `src/renderer/components/SettingsCategoryNav.tsx`
- Modify: `src/renderer/index.css`

**Interfaces:**

```tsx
export function SettingsGroup(props: {
  title: string
  description: string
  status?: { text: string; tone: 'ok' | 'off' | 'warning' }
  children: ReactNode
}): JSX.Element

export function SettingsRow(props: {
  label: string
  hint: string
  children: ReactNode
}): JSX.Element
```

- [x] 实现 group/header/row 视觉组件，保留内容插槽，不接业务状态。
- [x] 将 shell、侧栏、摘要卡、group、row、control、savebar 的 CSS 值对齐原型；移除 M71 单一大 panel 的背景、边框和分隔线。
- [x] 恢复页面副标题，并按原型修正 sidebar sticky top、尺寸和导航项内边距。
- [x] 运行 TypeScript 和组件相关测试。

## Task 3：按原型重组五类内容（TDD 绿色）

**Files:**
- Modify: `src/renderer/pages/Settings.tsx`
- Modify: `tests/e2e/gui.e2e.mjs`

- [x] 文库与下载：文章库 group（位置/重建）+ 下载偏好 group（格式/视频/历史）。
- [x] 账号与平台：微信读书账号 group + 墨问集成 group。
- [x] 自动化与发布：订阅自动检查 group + 站点同步 group。
- [x] AI 与工具：选题 AI group（含隐私提示、Base URL/Model/Key 行）+ 命令行快捷方式 group。
- [x] 系统与支持：微信请求保护 group + 诊断 group + 关于 wx-kit group。
- [x] 每项保留原 data-testid、事件处理器、条件显示与即时动作；将字段控制区放入 `SettingsRow`。
- [x] 重跑 e2e 至全绿，确认保存、撤销、AI Key、登录、诊断、更新等行为没有回归。

## Task 4：视觉验收、文档与收尾

**Files:**
- Modify: `docs/PRD-v0.12.0.md`
- Modify: `ROADMAP.md`
- Modify: `docs/devlog/wx-kit-vibe-coding.md`

- [x] 桌面 Electron 截图与原型逐项人工比对：页头/副标题、1420 容器、248 侧栏、摘要卡、group 卡、行布局和保存条；确认无横向溢出且保存条不挡最后一行。
- [x] PRD §4.5 按实际结果勾选；ROADMAP 追加 M72；devlog 记录“方向一致不等于设计复原”的教训。
- [x] 运行 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`、`npm run test:e2e`、`git diff --check`；核对 `package.json` 仍为 0.11.3。
- [x] commit -F，合并 main，删除 feature 分支，不 push。
