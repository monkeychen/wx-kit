# M82 · v0.12.2 实现计划：依赖安全升级（R2）+ 视频入口（R1）

- 日期：2026-10-08
- 分支：`feat/v0.12.2`
- PRD：`docs/PRD-v0.12.2.md`（§4 为验收契约；R1 已 2026-09-30 定案，R2 同日并入）
- 顺序：**先 R2 后 R1**——依赖升级先建干净基线，e2e 若挂能区分是升级引起还是 R1 引起。

## R2 · 依赖安全升级（先行）

现状：undici 7.29.0（cheerio 传递依赖，锁文件唯一副本）、electron 42.8.1（devDep）。
告警与修复线见 PRD §3 R2。

1. [x] `npm update undici` → 核实锁文件 `node_modules/undici` ≥ 7.29.1
2. [x] `npm install --save-dev electron@^42.11.12`（npmmirror 镜像 + no_proxy 直连）
3. [x] 基线验证：`npm test` / `npm run lint` / `npx tsc --noEmit` /
       `WXKIT_E2E_HEADLESS=1 npm run test:e2e`（Electron 42.11 下全流程）

决策：undici 走 lockfile update 不进 package.json（传递依赖最小变更）；electron 同大
版本内升最新 patch 不跨 43；`vite.config.ts` undici external 不动（与版本无关）。

## R1 · 视频入口（TDD）

### 现状与改造点（已核对源码）

| 文件 | 现状 | 改造 |
|---|---|---|
| `src/core/types.ts` | `ArticleMeta.videos[]` 无 url 字段（不存 url 纪律） | 加 `streamUrl?` + `fallbackUrl`（PRD §3 R1 裁决：不是长期副本而是双入口，须诚实标注时效） |
| `src/core/parse-video.ts` | `MpVideoSource.url` 必填（当次签名直链） | 不动；新定义 `VideoEntry`（url 可选 + fallbackUrl），`ParsedArticle.videos: VideoEntry[]` |
| `src/core/parse-article.ts` | videos 透传 MpVideoSource | map 为 VideoEntry（结构兼容，直传） |
| `src/core/exporter/export-video.ts` | `downloadVideos(MpVideoSource[])`：未下载=纯说明文字，下载成功=本地 `<video>` | 签名改 `VideoEntry[]`；未下载且有 streamUrl：html= `<video src=streamUrl>` + `<a fallbackUrl>` + 时效标注，md= fallbackUrl 链接；无 streamUrl（墨问）：html/md= fallbackUrl 链接；records 落 streamUrl（仅未下载/失败条目）与 fallbackUrl |
| `src/core/exporter/index.ts` | `exportArticle` 已收 `sourceUrl` | 把条目缺省的 `fallbackUrl` 补为 `sourceUrl`（微信侧兜底=文章原页；墨问条目自带 channels 页不覆盖） |
| `src/core/mowen/note-show.ts` | 不读 `noteFlag` | 读 `detail.noteFlag.hasVideo` → `NoteShowResult.hasVideo` |
| `src/core/mowen/mowen-to-article.ts` | 不认 `<channel-video>`（静默吞） | 正则替换 `<channel-video … feed-id="X">` → 跳转链接段落 + `VideoEntry{fallbackUrl: channels.weixin.qq.com/X}`；`hasVideo && 解析数=0` → warnings 告警 |
| `src/renderer/pages/Reader.tsx` | `videos/` 本地链接 → `<video>`（先例） | md 视图 a 组件按 **href ∈ meta.videos[].fallbackUrl** 精确匹配 → `VideoEntryBlock`：有 streamUrl 渲染 `<video onError>` + 「可能已过期」小字，error/无 streamUrl 自动降级为「在微信里打开」（B1，openExternal）；已下载条目走现状本地分支 |

**B1 落点说明**：落盘 html 是 sandbox iframe（无 allow-scripts，CLAUDE.md 安全红线），
内联 onerror 不执行——html 文件形态按定案给「video + 跳转链接」并存（不卡死）；
**error 自动降级落在阅读器 md 视图的 React 渲染层**（`videos/` 链接渲染 `<video>` 的
同构先例，Reader.tsx:101）。md **文件**仍是纯链接（定案原文）。

**链接识别防误伤**：fallbackUrl 是外部 URL，不能按 URL 特征猜（正文可能原生含
mp.weixin.qq.com 链接）——阅读器用 meta.videos 精确集合匹配，不用启发式。

### 步骤（每步先测后码）

1. [ ] `types.ts` + `parse-video.ts`：VideoEntry 类型 + ParsedArticle.videos 放宽 + parse-article 透传（tsc 兼容）
2. [ ] `export-video.ts`：先写单测（未下载+streamUrl 的 html/md 形态、无 url 条目、
       fallbackUrl 缺省补 sourceUrl、下载失败带 fallback、时效标注存在）→ 实现
3. [ ] `note-show.ts`：单测（hasVideo 读取，含缺省 false）→ 实现
4. [ ] `mowen-to-article.ts`：单测（channel-video 替换与链接拼装、多视频、
       hasVideo 不一致告警、无 feed-id 保留原标签+告警）→ 实现
5. [ ] `Reader.tsx` VideoEntryBlock（实现时先读 `docs/design-system.md`，走语义 class）
6. [ ] e2e：mowen mock（`WXKIT_MOWEN_BASE` 换 base，Node fetch 链路）返回含
       `<channel-video>` + `hasVideo:true` 的 note/show → 断言 md/html/meta/阅读器入口
7. [ ] 真实样本回归：`Jlvxr4t3bWSmXoGGNEOfm` 真机下载，确认视频号入口
8. [ ] skill 刷新核查：`agent/wx-kit-skill/` 若描述 meta.videos 结构则同步

## 收尾发版（按发版规约）

1. [ ] 版本号 0.12.2：`package.json` + `package-lock.json` 手改 version 行
2. [ ] `docs/releases/v0.12.2.md`
3. [ ] ROADMAP：当前状态行、里程碑表 M82、PRD 索引行、发布史
4. [ ] `npm run build` + `npm run package:win`（镜像 env）→ 三平台包
5. [ ] 真实启动 .app 验证（GUI + CLI 子命令出 JSON）
6. [ ] README 版本相关处 + `npm run docs:download-stats`
7. [ ] devlog §82
8. [ ] commit 合 main、tag `v0.12.2`、GitHub Release 三资产、brew tap + verify、
       push（unset 代理）、`git fetch --tags`
9. [ ] 回源核实 Dependabot 告警清零（gh api）

## 风险与回退

- electron 42.8→42.11 全流程 e2e 盖；若 42.11 有行为变化，回退 42.10.0（告警修复线）
- undici 7.29.1 为 patch 级，cheerio.load 路径不受影响
- R1 全部是**新增**入口（未下载视频此前是纯说明文字），不改动已下载视频的本地播放路径
