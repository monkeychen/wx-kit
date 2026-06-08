# M8 · PDF 保真：图片不跨页切断（R4）

> 对应 PRD-v0.2.0 R4。R7（库根提示）已在 M6 完成，本里程碑只做 R4。

## 为什么（对用户的影响）
导出的 PDF 里，长文的图片在 A4 页边界被拦腰切断（半张在上一页、半张在下一页）。`export-pdf.ts` 裸 `printToPDF({ pageSize:'A4' })`，无任何分页控制。要让图片/表格/代码块/引用在分页时**整体不被切断**。

## 现状锚点
- `src/core/exporter/export-pdf.ts`：离屏 BrowserWindow 加载 `index.html` → `printToPDF`。
- `src/core/exporter/export-html.ts`：`buildHtml` 生成的 `index.html` 带**内联 `<style>`**，PDF 加载的就是它。
- 微信代码块结构是 `<pre><code>行1</code><code>行2</code>…</pre>`（见 export-markdown 注释），故 `pre` 即覆盖代码块。

## 方案：把防切断规则作为 `@media print` 注入 HTML（而非 insertCSS）
理由：
- printToPDF 用打印媒介渲染，`@media print` 规则生效。
- 规则只在打印时作用，**屏幕阅读器（HTML iframe）零影响**。
- 规则随 HTML 走，用户自己 Ctrl+P 打印这份 HTML 也受益（额外红利）。
- 可在纯函数 `buildHtml` 层 TDD；`export-pdf.ts`（依赖 electron）保持最简、不碰。

### 规则（加进 export-html.ts 的 STYLE）
```css
@media print {
  img { break-inside: avoid; page-break-inside: avoid; display: block; max-width: 100%; height: auto; margin: 0 auto; }
  figure, table, pre, blockquote { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }   /* 标题不落在页尾成孤行 */
  p { orphans: 3; widows: 3; }
}
```
- `break-inside` + 旧别名 `page-break-inside` 双写，兼容性兜底。
- img 在打印态设 `display:block`，让每张图成独立块、`break-inside:avoid` 才能阻止其被拆页。`margin:0 auto` 保持居中。
- 超过整页高度的图/表，`avoid` 是「尽量」非强制，Chromium 放不下时仍会断——不会产生无限空白。

## 步骤
1. **export-html.ts**：把上面 `@media print` 块追加进 `STYLE` 常量。
2. **export-html.test.ts（TDD）**：断言 `buildHtml` 输出含 `@media print`、`break-inside: avoid`，且 `img`/`table`/`pre` 被命中；并断言屏幕态 `img{max-width:100%}` 仍在（不回归）。
3. **真实 PDF 验证**：用真实图文长文（安哥给过的 `https://mp.weixin.qq.com/s/L1ISA0FvxY_7OR994RttWw` 或另一篇图多的），CLI 下 `--formats pdf` 出 PDF，用 Read 工具翻页目视确认图片不再被页边界切断（清代理 + sandbox 关闭）。
4. **文档**：ROADMAP（M8 ✅、计划索引）、PRD R4 标注实现、devlog 增补 M8。
5. 验证通过 → 合回 main 删分支，commit（push 等安哥）。

## 验证口径
- 单测：`buildHtml` 含打印规则；既有 109 全绿；tsc + lint。
- e2e 不覆盖 PDF（默认格式无 pdf），故 R4 靠**真实 PDF 出件 + 翻页目视**端到端验证（这是依赖 electron 的部分，端到端兜底）。
