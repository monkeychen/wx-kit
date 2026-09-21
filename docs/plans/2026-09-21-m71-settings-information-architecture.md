# M71 设置页信息架构重设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task and superpowers:test-driven-development for behavior changes. 按 AGENTS 在 feature 分支完成、验证、合 main，不 push。

**Goal:** 在不迁移或删除任何设置能力的前提下，把十三个平铺区块重组为五类左侧导航，并用统一粘性保存条管理持久设置。

**Architecture:** `Settings` 继续持有全部设置、平台状态和即时动作；新增纯视图模型负责分类元数据与 dirty 判定，新增导航组件只负责分类切换。右侧按当前类别条件渲染原有设置块，表单草稿保留在父组件；普通 AppSettings 与选题 AI 配置由同一个保存动作协调提交，即时动作仍走原 IPC。

**Tech Stack:** React 18、Ant Design 6、现有暖色编辑杂志 CSS、Vitest、Playwright Electron e2e；无新依赖。

**Spec:** [`docs/PRD-v0.12.0.md` R8 / §4.4](../PRD-v0.12.0.md)

## Global Constraints

- 所有现有设置、账户、保护、诊断和关于内容继续留在设置页。
- 固定五类：文库与下载、账号与平台、自动化与发布、AI 与工具、系统与支持。
- 桌面为左侧导航；窄宽度可变为横向可滚动导航。
- 正式页面只保留“设置”标题，不使用原型里的解释性副标题。
- 切换分类不丢草稿；持久设置统一保存/撤销；即时动作不进入保存事务。
- 不修改 SettingsService、订阅、下载、登录、模型调用或安全存储的底层契约。

---

## Task 1：分类与 dirty 纯逻辑（TDD）

**Files:**
- Create: `src/renderer/settings-view.ts`
- Create: `tests/renderer/settings-view.test.ts`

**Interfaces:**

```ts
export type SettingsCategory = 'content' | 'accounts' | 'automation' | 'ai' | 'system'
export interface SettingsCategoryDefinition {
  id: SettingsCategory
  label: string
  description: string
  icon: string
}
export interface TopicAiDraft { baseUrl: string; model: string; apiKey: string }
export function isSettingsDirty(input: {
  savedSettings: AppSettings | null
  draftSettings: AppSettings | null
  savedTopic: TopicAiConfigStatus | null
  topicDraft: TopicAiDraft
}): boolean
```

- [x] 写红灯：五类顺序和中文标签固定；普通设置嵌套值变化、AI base/model 变化、新 Key 均判 dirty；完全相同与仅空白 Key 判 clean。
- [x] 运行 `npm test -- tests/renderer/settings-view.test.ts`，确认因模块不存在失败。
- [x] 实现最小纯函数与常量，不 import React。
- [x] 重跑目标测试至通过。

## Task 2：分类导航与页面骨架（TDD + e2e 红灯）

**Files:**
- Create: `src/renderer/components/SettingsCategoryNav.tsx`
- Modify: `src/renderer/pages/Settings.tsx`
- Modify: `src/renderer/index.css`
- Modify: `tests/e2e/gui.e2e.mjs`

**Interfaces:**

```tsx
<SettingsCategoryNav
  value={activeCategory}
  onChange={setActiveCategory}
  statuses={{ content: 'ok', accounts: 'ok', automation: 'off', ai: 'ok', system: 'warning' }}
/>
```

- [x] 先改 e2e：进入设置后应看见五个 `settings-cat-*`，默认只有 `settings-panel-content` 可见；点击每类后对应 panel 可见、上一类不可见。
- [x] 构建并运行 e2e，确认因导航不存在失败。
- [x] 新增导航组件；Settings 增 `activeCategory='content'`，页面改成 `settings-shell` 两栏，只条件渲染当前分类。
- [x] 按 PRD R8 归类全部十三个区块；即时动作函数和原 data-testid 原样保留。
- [x] 增加每类标题、状态摘要卡和分组 surface；CSS 实现桌面左侧 sticky、窄屏横向滚动。
- [x] 删除解释设计本身的副标题；重跑类型检查和 renderer helper 测试。

## Task 3：统一保存与撤销（TDD）

**Files:**
- Modify: `src/renderer/pages/Settings.tsx`
- Modify: `src/renderer/settings-view.ts`
- Modify: `tests/renderer/settings-view.test.ts`
- Modify: `tests/e2e/gui.e2e.mjs`

- [x] 扩展红灯：普通设置和 AI 草稿同时存在时 dirty；保存后的新基线 clean；撤销应能恢复上次保存的 AppSettings/base/model 并清空未保存 Key。
- [x] Settings 保存 `savedSettings` 与 `savedTopicAi` 基线；所有分类共享一个 `settings-save-bar`，显示 clean/dirty，提供 `settings-revert` 与 `settings-save`。
- [x] `saveAll` 在写入前校验首次 AI 配置必须有 Key；AI dirty 时调用 `topicsSaveConfig`，再用返回的公开 base/model 同步并保存完整 AppSettings；成功后更新两份基线。
- [x] 删除 `topic-ai-save` 独立按钮；`topic-ai-clear-key` 仍是即时动作，成功后同步已保存 AI 基线。
- [x] e2e：在自动化页改开关，切到其它分类再返回，草稿仍在且 dirty；撤销恢复；AI 分类填写配置后用统一保存，导航往返后状态诚实。

## Task 4：回归现有设置操作与真实 Electron 流程

**Files:**
- Modify: `tests/e2e/gui.e2e.mjs`

- [x] 更新既有设置断言：微信读书/墨问走“账号与平台”，订阅/站点走“自动化与发布”，选题 AI/CLI 走“AI 与工具”，保护/诊断/更新走“系统与支持”。
- [x] 保留 M70 本地模型两请求、Key/Authorization/完整正文零泄漏断言；统一保存不得增加模型请求。
- [x] 运行 `npm run test:e2e`，确认全部历史 GUI 流程与新设置流程通过、无 console/page error。
- [x] 截取当前设置页原型实现画面进行人工视觉检查，确认桌面宽度无横向溢出、粘性保存条不遮挡最后一项。

## Task 5：文档、验证与收尾

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/PRD-v0.12.0.md`
- Modify: `docs/devlog/wx-kit-vibe-coding.md`

- [x] PRD §4.4 按实际证据勾选；ROADMAP 新增 M71 v0.12.0 未发布状态；devlog 记录“设置不等于偏好，关键是按用户目标分组”的决策与验证。
- [x] 运行 `npm test -- tests/renderer/settings-view.test.ts`、`npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`、`npm run test:e2e`。
- [x] 运行 `git diff --check`，核对 `package.json` 仍为 0.11.3。
- [x] commit -F，合并 main，删除 feature 分支，不 push。

## Self-review

- 五类覆盖 PRD R8 的十三个区块，没有把任何内容移出设置页。
- 统一保存只协调既有持久接口；登录、清空、重建、检测、保护、诊断和更新仍是即时动作。
- 草稿状态在父组件，条件渲染 panel 不会因分类切换丢失。
- e2e 测用户可见行为和持久结果，不只检查导航源码或 mock。
