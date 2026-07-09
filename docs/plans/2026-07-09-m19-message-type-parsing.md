# M19 · 文字消息 + 图文消息解析支持（v0.5.1）

> 需求与验收：`docs/PRD-v0.5.1.md`。本计划只写「怎么做」。
> 分支：`feat/m19-message-type-parsing`。只动 `src/core/parse-article.ts` + 测试 + fixtures。

## 页面结构实证（2026-07-09，真实 URL 抓取分析）

- **文字消息**（`/s/SF5PlWYTHiuHqWYmFmKh9Q`，`item_show_type: '10'`）：
  无 `#js_content`；正文在脚本 `text_page_info: { content: '...' }`（JS 单引号字符串，`\x0a` 转义换行）；
  **og:title 是整篇正文**（换行为字面 `\n` 两字符）——不可用作标题；`nick_name`/`ct` 变量正常（既有回退可用）。
- **图文消息**（`/s/2enR9fGb9oQ0edZlplkVxA`，`item_show_type: '8'`，小绿书）：
  无 `#js_content`；正文在脚本 `cgiDataNew` 的 `content_noencode: '...'`（同为 `\x0a` 转义）；og:title 为正常短标题；
  图片在 `window.picture_page_info_list = [...]`，每项开头为 `width → height → cdn_url` 三连。
  **锚定坑**：`cgiDataNew` 段里也有零散三连（空 URL / 封面变体），`watermark_info`/`share_cover` 的 cdn_url 字段顺序不同——
  **必须先截取 `window.picture_page_info_list = [` 所在 script 段（起点到 `</script>`），段内匹配三连并滤空**，实测恰得 7 张主图。

## 实现步骤

### 1. 制作 fixtures（裁剪真实页面）
- `tests/fixtures/text-message.html`：保留 og meta（title=全文带字面 `\n`）、`text_page_info` script 片段、`nick_name`/`ct` 变量行；几 KB 即可。
- `tests/fixtures/picture-message.html`：保留 og meta（正常短标题 + og:description）、`cgiDataNew` 干扰段（含空 cdn_url 三连与 `content_noencode`）、`window.picture_page_info_list` script（≥3 项主图 + watermark_info/share_cover/live_photo 干扰结构）。
- 正文文字可用占位段落替换真实内容（保留 `\x0a` 转义形态与段落数），图片 URL 保留真实形态截短。

### 2. TDD：`tests/core/parse-article.test.ts` 增测
- 文字消息：标题 = 正文首行截 30 字 + `…`、不含 `\n` 字面；`contentHtml` 为 `<p>` 分段（段数与 fixture 一致）；`imageUrls` 空；account/publishTime 走既有回退。
- 图文消息：标题 = og:title；`contentHtml` 含文字 `<p>` 段 + 每图一个 `<img data-src>`；`imageUrls` = 主图列表（**不含**水印/分享封面/空 URL）；顺序与页面一致。
- 转义还原单测：`\x0a`→换行、`\u` 形态、`\'`、`\\`；HTML 特殊字符（`&`/`<`/`>`) 在 `<p>` 内被转义。
- 标题截断边界：首行 ≤30 字不加 `…`；空行开头取第一个非空行。
- 回归：`sample-article.html` 解析结果不变；无正文无脚本变量的错误页 title 为空（无效判定不被绕过）。

### 3. 实现 `src/core/parse-article.ts`
新增辅助（均为模块内纯函数）：
- `unescapeJsString(s)`：还原 `\xNN`/`\uNNNN`/`\n`/`\t`/`\r`/`\'`/`\\` 等 JS 字符串转义。
- `cleanMetaText(s)`：og meta 兜底清洗——字面 `\n`、`\x0a` 等转义序列替换为空格并归并空白。
- `escapeHtml(s)` + `textToParagraphs(text)`：按空行分段包 `<p>`。
- `titleFromText(text)`：首个非空行截 30 字符（按码点），超出加 `…`。
- `extractTextMessageContent(html)`：正则取 `text_page_info: { content: '...' }` → unescape。
- `extractPictureMessage(html)`：`content_noencode` 正文 + 截取 `window.picture_page_info_list` script 段内的 `width→height→cdn_url` 三连（滤空、去重、`&amp;`→`&`）。

`parseArticle` 主流程：`#js_content` 缺失/为空时，依次探测文字消息 → 图文消息，命中则构建 `contentHtml`/`imageUrls`/（文字消息）标题；都不中维持现状。og:title/og:description 回退一律过 `cleanMetaText`。

### 4. 验证
- `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`。
- 真实端到端：CLI 下载两条验证 URL（md,html,pdf,meta）到临时目录，检查标题/目录名/正文/图片本地化。
- GUI 真机：隔离 userData（`--user-data-dir` + seed `cliLinkPrompted:true`）下载并打开阅读器截图验证（见 memory：UI 验证要真实数据态）。

### 5. 收尾
- ROADMAP：M19 行 + 当前状态；devlog 增补 §29。
- 合回 main、删分支；发版（R2）按 PRD §4 走，push/release 等安哥发话。
