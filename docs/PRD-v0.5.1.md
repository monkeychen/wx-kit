# wx-kit v0.5.1 产品需求文档（迭代 PRD）

> 本文件是 **v0.5.1 迭代**的需求源头与验收依据，建立在 `docs/PRD.md`（v0.1.0）及各版迭代 PRD 之上。
> 实现计划见 `docs/plans/2026-07-09-m19-message-type-parsing.md`；状态/进度见 `ROADMAP.md`。
> 本迭代是解析层缺陷修复 + 内容类型扩展，真正的增量是 **§4 验收标准**（逐条可勾）。

## 1. 一句话定义

让 wx-kit 正确解析微信公众号的两种非标准消息类型——**文字消息**（纯文字短内容，`item_show_type: '10'`）与**图文消息**（小绿书图片贴，`item_show_type: '8'`）——下载后标题、正文、图片在 md/html/pdf/阅读器全链路正常呈现，而不是现在的「标题是整篇正文、正文一片空白、图片全丢」。

## 2. 背景：现状为什么坏

这两种消息页面与标准图文文章结构完全不同（2026-07-09 以真实 URL 实证）：

| | 标准图文 | 文字消息（type 10） | 图文消息（type 8） |
|---|---|---|---|
| 标题 | `#activity-name` | **无标题**；og:title 被微信塞入**整篇正文**（换行为字面 `\n` 两字符） | og:title 正常短标题 |
| 正文容器 | `#js_content` | **无**；正文在脚本变量 `text_page_info.content`（`\x0a` 转义） | **无**；正文在脚本变量 `cgiDataNew.content_noencode`（`\x0a` 转义） |
| 图片 | `#js_content img[data-src]` | 无（或 `short_msg_pic_url`） | 脚本变量 `window.picture_page_info_list[].cdn_url` |
| 页面渲染 | 服务端 HTML | 前端 JS 渲染 | 前端 JS 渲染 |

现有 `parseArticle` 只认 `#activity-name` + `#js_content`，于是：

- **文字消息**：标题回退到 og:title → 整篇正文成了标题（带一堆字面 `\n`），正文为空。连带污染目录名（截 80 字、`\` 净化成 `_` 出现 `_n_n`）、meta.json、md frontmatter、文库列表、阅读器标题栏。且因标题「非空」，恰好绕过「标题为空即无效文章」的失败判定，坏数据静默入库。
- **图文消息**：标题正常，但正文为空、图片全部丢失——下载下来只有一个标题壳。

## 3. 功能需求

### R1 · 非标准消息类型解析（里程碑 M19）

**总原则**：只改 `src/core/parse-article.ts` 一处（含其辅助函数），产出规范的 `ParsedArticle`（`contentHtml` 用 `<p>` 分段、图片用 `<img data-src>`）；下游图片本地化、md/html/pdf 导出、GUI 阅读器、CLI 均零改动自动受益。

**需求**：

- **类型检测**：`#js_content` 非空走既有逻辑（不回归）；为空时依次探测脚本变量——`text_page_info.content` 非空 → 文字消息；`picture_page_info_list` 含图 → 图文消息；都不中维持现状（空正文，交给「标题为空即无效」判定）。不依赖 `item_show_type` 数字做主判据（以内容存在性为准，更稳）。
- **正文提取**：从脚本变量提取正文文本，还原 JS 字符串转义（`\x0a` → 换行、`\xNN` 十六进制、`\uNNNN`、`\'` 等），按空行分段生成 `<p>` 序列作为 `contentHtml`。
- **图片提取**（图文消息）：从 `window.picture_page_info_list` 提取每项主图 `cdn_url`（以 width→height→cdn_url 的项结构锚定，**排除** `watermark_info`/`share_cover` 里的 cdn_url），在正文段落后以 `<img data-src="...">` 逐张追加进 `contentHtml`，并计入 `imageUrls` → 走既有图片本地化管线。live_photo 视频**只取其静态图、不下视频**（非目标）。
- **标题策略**：
  - 文字消息（无标题）：取还原换行后正文的**首行截断**（≤ 30 字符，超出加 `…`）——与微信客户端列表展示一致；目录名随之恢复正常长度。
  - 图文消息：沿用 og:title（本就正常）。
  - 兜底清洗：og:title / og:description 回退值中的**字面 `\n`/`\x0a` 转义序列**统一清洗（换行类替换为空格），任何路径都不再让转义序列渗入标题/摘要。
- **失败判定不弱化**：已删除/失效文章的错误页不含上述脚本变量，仍走「标题为空即无效」抛错，不因新分支误判为成功。

**存储影响**：无新增持久化文件/字段；`ParsedArticle` 类型不变。

### R2 · 发版（v0.5.1）

按 AGENTS.md 发版规约走完整发版：version bump、`docs/releases/v0.5.1.md`、重新打包、真机验证、README/ROADMAP 同步、tag + GitHub Release（push/release 等安哥发话）。

## 4. 验收标准

### R1 / M19 · 非标准消息类型解析

**文字消息**（验证 URL：`https://mp.weixin.qq.com/s/SF5PlWYTHiuHqWYmFmKh9Q`）：
- [ ] 下载后标题为正文首行截断（≤30 字 + `…`），**不含**字面 `\n`；目录名正常长度、无 `_n_n`。
- [ ] `content.md` 正文完整分段（该篇 13 段全在），frontmatter title 干净。
- [ ] `index.html` 正文完整分段，`<title>`/`<h1>` 干净。
- [ ] GUI 阅读器打开该文章：标题栏一行短标题，正文完整可读（真机验证）。

**图文消息**（验证 URL：`https://mp.weixin.qq.com/s/2enR9fGb9oQ0edZlplkVxA`）：
- [ ] 下载后标题为 og:title（「有海鸥还看什么A股行情...」），正文文字完整分段。
- [ ] 图片全部提取并本地化到 `images/`（该篇为多图贴；不含水印图/分享封面图的重复项），md/html 中图片引用指向本地文件。
- [ ] GUI 阅读器打开该文章：文字 + 图片完整呈现，图片 `naturalWidth > 0`（真机验证）。

**回归与通用**：
- [ ] 标准图文文章（既有 fixture `sample-article.html`）解析结果不变（标题/正文/图片/时间/公众号）。
- [ ] 已删除文章错误页仍判定为无效（「标题为空」路径不被新分支绕过）。
- [ ] 两种新类型的解析纯逻辑 TDD 覆盖（真实页面裁剪 fixture），含 JS 转义还原、图片锚定排除水印/封面、标题截断边界。
- [ ] `npm test` / `npx tsc --noEmit` / `npm run lint` 全绿。

### R2 · 发版
- [ ] `package.json`/`package-lock.json` version = 0.5.1；`docs/releases/v0.5.1.md` 就绪。
- [ ] 重新打包并**真实启动打包后的 .app** 验证两条 URL 下载 + 阅读正常。
- [ ] README 徽章/版本号/安装包文件名、ROADMAP 状态段同步刷新。
- [ ] main 打 annotated tag `v0.5.1` + GitHub Release 三平台包（push 与 release 等安哥发话）。

## 5. 里程碑拆分

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M19** | 文字消息 + 图文消息解析支持（R1） | ⏳ 待实现 |

单里程碑：两种类型共用同一套「脚本变量提取 + 转义还原 + contentHtml 构建」机制，拆开反而重复。

## 6. 非目标（v0.5.1 明确不做）

- **live_photo 视频下载**——图文消息里的实况图只取静态图；音视频卡片保真延续既往非目标。
- **其他 item_show_type**——只做实证过的 type 10/8；遇到新类型再按同机制扩展（探测器已留好「都不中维持现状」的出口）。
- **历史坏数据迁移**——已下载的坏记录由用户删除重下即可（文库已有删除入口），不做自动迁移。
