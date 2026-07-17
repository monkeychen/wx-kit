# M23+M24 · 文库导航 + 关键词过滤（v0.5.5）

> 需求/验收见 `docs/PRD-v0.5.5.md`。分支 `feat/m23-m24-library-nav-keyword-filter`。纯逻辑 TDD。

## M24(先做,纯逻辑多)

### 1. core 过滤纯函数(TDD)

`src/core/mp-crawl.ts` 新增:

```ts
export interface KeywordFilter { include?: string[]; exclude?: string[] }
/** 标题关键词过滤:include 任一命中才留(空=不限),exclude 任一命中即去(后应用,优先)。不区分大小写。 */
export function filterRefsByTitle(refs: ArticleRef[], f?: KeywordFilter): ArticleRef[]
```

测试矩阵:仅 include / 仅 exclude / 并用(exclude 优先)/ 大小写不敏感 / 空串与空白关键词忽略 / 未传 filter 原样返回。

### 2. crawlAccount 接线

`CrawlDeps` 加 `keywords?: KeywordFilter`;列表退避循环之后、`onListed` 之前:
`const kept = filterRefsByTitle(refs, deps.keywords)`,其后全用 kept;
`CrawlSummary` 加 `filteredOut?: number`(= refs.length - kept.length,>0 才携带)。
测试:过滤后 onListed 收到的是过滤后列表、summary.listed/filteredOut 正确。

### 3. IPC / preload / api / CLI

- `electron/ipc.ts` `mp:crawl` payload 加 `keywords`,透传 crawlAccount。
- `electron/preload.ts` + `src/renderer/api.ts` `mpCrawl` 加参。
- `src/cli/index.ts` crawl 加 `--include <kws>` `--exclude <kws>`(逗号分隔→数组),outJson 含 `filteredOut`。

### 4. GUI(AccountMode)

范围行下加一行两个可选 Input(`data-testid="kw-include"` / `"kw-exclude"`,placeholder 说明逗号分隔可留空);
start 时解析成数组传 `api.mpCrawl`;完成反馈句含「按关键词过滤 N 篇」(filteredOut>0 时)。

## M23

### 5. 设置字段

`electron/services/settings.ts` `AppSettings` 加 `libraryExpandedGroups?: string[]`(无默认值,undefined=从未设置)。

### 6. Library.tsx 折叠反转 + 记忆 + 全部展开/收起

- `collapsed: Set` 反转为 `expanded: Set<string>`(组显示 = expanded.has(account));初始从 settings 读,undefined → 空集(全收起)。
- toggle 时同步 `api.saveSettings({ libraryExpandedGroups: [...] })`(fire-and-forget)。
- 工具栏加「全部展开/全部收起」按钮(`data-testid="expand-all"`,全展开时文案变收起)。

### 7. 粘性组头 + 回顶(CSS + FloatButton)

- `src/renderer/index.css`(或既有样式文件):`.ghead`、`.lgrp-head` `position: sticky; top: <偏移>` + 不透明背景;列表视图 `.lhead` 同钉,`.lgrp-head` top 让开列头高度。
- Library 页加 `<FloatButton.BackTop />`。

### 8. e2e 适配 + 增补

- 既有步骤在进文库后先点「全部展开」(默认折叠会藏起 article-card)。
- 增:首进全收起断言、点组头展开、expand-all 切换、(可选)关键词过滤走 fixture 抓取断言只下匹配篇。

## 验证与发版

`npm test` / lint / tsc / `npm run test:e2e`;GUI 真机(真实文库数据态)截图折叠目录 + 粘头;
发版规约(README 亮点段替换不追加);发版后 gh issue #1 回复 + 关闭。
