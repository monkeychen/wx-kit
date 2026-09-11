# M61 · 墨问正文通道 + 下载页墨问 tab + `mowen import`（v0.11.0 主菜）

> 需求/验收：`docs/PRD-v0.11.0.md` §3 R2（R2a tab / R2b URL / R2c 正文通道 / R2d import）、§6 R2 未勾项。
> 前置：M60 已落 mocli 封装层（`src/core/mowen/` 的 runner/detect/metadata/url）与 CLI 骨架。

## 关键事实（plan 前 2026-09-11 真机钉死）

1. **`note/show` 响应结构**（带图笔记 `Ni2ZIpWVBtm1qu8sAmihb` 实测）：
   - `detail.noteBase.{uuid,title,digest,content,createdAt,uid,publicAt}`——`content` 是完整正文 HTML；
   - 正文图片形态：`<img uuid="NGQaWuJHAcNMk5lcQx-hx">`（**无 src**），URL 在 `detail.noteFile.images[uuid]`，
     每项含 `{url, scale:{w_1200,w_240}, format,width,height}`——**用 `scale.w_1200`**（PRD 钉）；
   - 无图笔记 `noteFile` 为 **`null`**（M59 前已实测）；无音频 `noteAudio` 为 `[]`；
   - 作者：`user.base.{uid,name}`；
   - **付费笔记 HTTP 400**：`{code:400, reason:"ASSET_NOT_FOUND", metadata:{skuId}}`（真机复验 `-Bh35Ogyfr7OQTs-GGsCu`）。
   - 注意 `noteFlag.hasFee` 有 **false 但清单 `with_fee:true`** 的形态（免费试读笔记）：清单付费标记以 mocli `flag.with_fee` 为准，正文可得性以 note/show 实际返回为准——两者不一致不算错。
2. **exporter 图片本地化**（`exporter/index.ts`）匹配 `img` 的 `data-src || src` → 本地路径；
   墨问的 `<img uuid>` 需在 adapter 阶段改写成 `<img src="<w_1200 签名URL>">` 并产出 `imageUrls`，
   后续下载/重写/落盘全复用现有链路（buildImageMap 按 contentType 定扩展名，签名 query 不碍事）。
3. **现有 `download` IPC**（ipc.ts:166）收 `urls[]` → DownloadQueue → `downloadArticle`。
   **墨问 URL 在 downloadArticle 顶部路由到 `downloadMowenNote` 后，GUI 批量下载零新增 IPC**——
   tab 的批量下载直接复用 `download` 通道：进度广播、history（kind:'url'）、「照此再下」（回填 URL 再跑，
   mowen URL 会再次路由到 mowen 分支）全部免费复用。
4. **`articleId()` 对 mowen URL 会算出 `h_<hash>`**——不可读且与 UUID 语义脱节。mowen 用独立主键
   `mowen_<uuid>`（确定性、可读、与微信主键空间天然隔离），在 `downloadMowenNote` 内生成，不走 `articleId()`。
5. **`note/show` 不走 mp gateway**：gateway 是微信请求保护闸（pause/resume 语义只对 mp.weixin.qq.com），
   墨问是另一个平台，被「暂停微信请求」误伤没有道理。走独立 `fetchJsonPost`（Node 内建 fetch + 超时）。
6. **stderr 教训延续**（M60 实录）：对 note/show 的失败分类测试要覆盖「HTTP 400 + JSON 体」（不是 mocli 通道，无 stderr 问题，但传输层错误形态要按真机钉）。
7. **合集 = 引用链，非特殊类型**（2026-09-12 安哥追问后真机钉死）：`--filter album` 返回的是**普通笔记**，
   引用挂载在 `detail.noteRef: [子uuid...]`（数组，可多条）；子笔记是**独立完整笔记**（note/show 可单独取全文，
   实测两层链 `05-oJ...` → `6ipCT...` → `uhMLo...` → 叶子，无回环）；付费分区在 `noteEmbed.ref.{charge,free}`。
   处理方案（安哥拍板）：**引用块如实呈现 + 递归显式开关（默认关）**——不做隐式展开（勾 3 篇下 17 篇是意外）。
8. **export-markdown 的转换器是手写最小规则**（M29）——对 `<audio>`/`<pre>` 的行为未验证，
   T1 里先补验证测试再决定是否加规则；**改 exporter 共用路径必须带微信文章回归**。

## 设计决定

- **正文三通道自动化选优**（PRD R2c）：自己笔记（uid === mocli moUid）优先 `mocli --show-atom`（M61 先落
  note/show 主通道 + **BrowserWindow 兜底**；`--show-atom` AST 通道若时间紧可顺延 M62——note/show 对
  「自己写的公开笔记」同样可用，私密笔记是唯一 gap，见下）。
  **范围修正**：`--show-atom` 仅对自己私密笔记是刚需，其余场景 note/show 全覆盖。M61 范围 =
  note/show 主通道 + 渲染兜底；`--show-atom` 通道在 plan 里预留接口位（`fetchOwnPrivateNote` 可选注入），
  实现若顺延 M62 需在 PRD 勾选时如实标注。
- **付费/私密不可见 = 独立失败类型**（宪法红线）：`MowenNoteUnavailable('该笔记不可匿名获取（付费/私密）')`，
  汇总里进 `unavailable` 形态（与微信 `ArticleUnavailableError` 同等待遇），**不进 failed、不产出空文件**。
- **清单默认勾选**：默认全选，**但「文库已有」与「付费」两类默认不选**（各自标注原因：文库已有 / 付费）。
  付费项手动勾上会真跑并得到不可见失败——允许，如实呈现。〔对 PRD「默认全选」的收窄，安哥可砍回〕
- **限速写死 core**：note/show 调用间隔 500ms、图片 binary 间隔 300ms；`throttledFetch` 包装器 +
  注入 `sleep`（单测 fake timer 断言间隔）。横跨一次批量下载的多次 note/show 由串行队列自然串行。
- **渲染兜底的产出形态如实降级**：BrowserWindow 拿内容根的 innerHTML + `<title>`，包成最小 HTML 文档，
  meta 加 warning「正文经渲染兜底获取，格式可能不完整」。不假装与 note/show 同质。
- **音频**：`noteFile.audios`（或 `noteAudio`）有 URL 时，在 contentHtml 尾部/原位注入
  `<audio controls src="<remote>">`；md 走同一 HTML 的转换。远程 URL 不下载不入库（PRD 非目标），
  失效即失效——PRD 已接受。

## T1 · note-show 客户端 + 单测（TDD 红→绿）

**`src/core/mowen/note-show.ts`**：

```ts
export interface NoteShowResult {
  uuid: string; title: string; digest: string; contentHtml: string  // 原始 content
  publicAt: number | null                                            // unix 秒
  authorUid: string; authorName: string
  images: Map<string, string>                                        // img uuid → w_1200 URL
  audios: string[]                                                   // 远程音频 URL
  refNoteIds: string[]                                               // noteRef 引用的子笔记 uuid（合集/引用块）
  warnings: string[]                                                 // uuid 映射缺失等
}
export class MowenNoteUnavailable extends Error {}                   // 400 ASSET_NOT_FOUND
export async function fetchNoteShow(uuid: string, deps: {
  fetchJson: (url: string, init: { method: 'POST'; body: string; headers: Record<string,string> }) => Promise<{ status: number; text: string }>
}): Promise<NoteShowResult>
```

- URL `https://note.mowen.cn/api/note/wxa/v1/note/show`，body `{"uuid"}`，`Content-Type: application/json`，超时 15s。
- status 200 → 解析映射；`noteFile:null` → 空 Map；`<img uuid>` 的 uuid 不在 images → warning「图片映射缺失」；
  `noteRef` → `refNoteIds`（顺序保留）。
- status 400 且 body 含 `ASSET_NOT_FOUND` → 抛 `MowenNoteUnavailable`；其他非 200 → 抛 `MowenShowFailed`（含 status + 截断 body）。

**`tests/core/mowen/note-show.test.ts`**：fixture 用真机响应裁剪（上面关键事实 #1 与 #7）——成功映射（含 w_1200 选择）、
无图 null noteFile、400 付费、500、非 JSON、uuid 缺失 warning、noteRef 顺序解析。

## T2 · mowen-to-article 适配器 + 单测

**`src/core/mowen/mowen-to-article.ts`**：`noteShowToParsedArticle(r: NoteShowResult): ParsedArticle`

- title/author/account（=作者名）/digest 直取；`publicAt` → 北京时间 `YYYY-MM-DD HH:mm`（复用 publication-time/formatCnTime 模式）。
- contentHtml：`<img uuid="x">` → `<img src="images 映射的 w_1200">`（正则或 cheerio，**注意必须保持出现顺序**产出 imageUrls）。
- 音频注入 `<audio controls>`。coverUrl 空、videos 空、itemShowType null。
- **`tests/core/mowen/mowen-to-article.test.ts`**：带图（uuid→src 重写 + imageUrls 顺序）、无图 null、音频、
  代码块 HTML 原样保留、digest 缺省。
- **T2b · export-markdown 行为验证**：对含 `<audio>`/`<pre class="shiki">` 的 contentHtml 跑现有转换，
  断言不崩、pre 保留；若 audio 丢失 → 在 export-markdown 加最小规则（`<audio>` → md `[音频](url)`），
  **带微信 fixture 回归**。

## T3 · downloadMowenNote + download-article 路由 + 单测

**`src/core/mowen/download-mowen-note.ts`**：

```ts
export async function downloadMowenNote(url: string, formats: DownloadFormat[], deps: DownloadArticleDeps & {
  fetchNoteShow?: (uuid: string) => Promise<NoteShowResult>   // 注入点，缺省 T1 实现+限速
}): Promise<DownloadItemResult>
```

- id = `mowen_<uuid>`；`library.has(id)` → skipped（与微信同待遇，title/dir 回填）。
- fetchNoteShow → 适配 → 目录命名（`sanitizeName(作者名)/YYYY-MM-DD_标题`，复用 articleDirName/dedupeDirName）→
  `exportArticle`（images 走注入的 fetchBinary，包 300ms 限速）→ `library.add`。
- `MowenNoteUnavailable` 原样上抛（调用方归 unavailable）。

**`src/core/download-article.ts`**：函数顶部加路由——

```ts
const mowenId = extractMowenNoteId(url)
if (mowenId) return downloadMowenNote(normalizeMowenUrl(mowenId), formats, deps)
```

（`normalizeMowenUrl` 加进 `mowen/url.ts`：裸 id → `https://note.mowen.cn/detail/<id>`。微信路径零改动，既有测试守。）

**`tests/core/mowen/download-mowen-note.test.ts`** + **`tests/core/download-article.test.ts` 增补**：
mowen URL 路由进 mowen 分支（fetchNoteShow mock）、skipped 判重、unavailable 上抛、微信 URL 不受影响、
裸 noteId 归一。

## T4 · BrowserWindow 渲染兜底 + 单测

**`src/core/mowen/browser-render.ts`**：`renderMowenNote(uuid, BrowserWindowCtor): Promise<{title, html}>`

- 复用 export-pdf 的 offscreen 模式 + spike-mowen-render.mjs 稳定轮询（3 轮不变 + length>100，30s 上限）；
  取 `#app` innerHTML 与 `document.title`；超时抛 `RenderTimeout`。
- **触发条件**：仅 note/show 网络层失败（`MowenShowFailed`/fetch 异常）时降级；`MowenNoteUnavailable` 不降级
  （付费墙渲染也拿不到）。降级产出的 meta.warnings 加「渲染兜底，格式可能不完整」。

**单测**：mock BrowserWindowCtor + webContents（executeJavaScript 脚本化返回），钉轮询收敛与超时两条路径。

## T4b · 合集引用块 + 递归开关（2026-09-12 追加，安哥拍板）

**引用块渲染（无条件，防信息丢失）**：`mowen-to-article.ts` 的适配阶段——`refNoteIds` 非空时在
contentHtml 尾部追加「引用笔记」块（`<section class="mowen-refs">`，每条：标题占位 + 作者 + `note.mowen.cn/detail/<uuid>`
链接）。子笔记的标题**不在父级响应里**（noteRef 只有 uuid 数组），首版链接文案用「引用笔记 · detail/<uuid 前 8 位>」；
不为拿标题对每条引用加 note/show 往返（递归开启时子笔记下载后自然有标题，父级记录不再回写——如实即可）。
md 走同一 HTML 的转换；清单条目 `with_ref` 标「含引用」（GUI T6 / CLI 输出加 `hasRefs` 字段）。

**递归下载（显式开关，默认关）**：

- `downloadMowenNote(url, formats, deps, opts?: { expandRefs?: boolean })`——`expandRefs` 开启且
  `refNoteIds` 非空时，对每个子 uuid 构造 detail URL **递归调用 downloadMowenNote**（天然复用：判重跳过、
  限速、unavailable 分类、library.add 全部同一条路径）；深度上限 **3 层**（真机实测两层，留一层数字余量，
  超深 warning「引用层级过深，已停止展开」防失控）。子笔记付费墙 → unavailable 如实进父级 result 的
  `refResults` 摘要（不阻塞父级成功）。
- CLI：`mowen import --expand-refs`；GUI：清单条目勾选框旁「含引用」标记 + 展开子勾选（T6）。
- 单测：链式两层展开（mock fetchNoteShow 按深度返回不同 noteRef）、付费子篇 unavailable 不阻塞父级、
  默认不展开（只有引用块）、深度 3 截断、判重跳过（父子重复引用同一篇只下一次）。

## T5 · CLI `mowen import` + 单测

`src/cli/index.ts` mowen 组追加：

- `mowen import <note-id...>`：逐个 `extractMowenNoteId` → 归一 URL → DownloadQueue（formats 跟设置
  `defaultFormats`，与 digest --download 一致）→ 输出与其他下载命令同构的 DownloadSummary JSON。
- `mowen import --uid <uid> [--recent 7d] [--count 20] [--filter all] [--expand-refs]`：先 listUserNotes →
  URL 列表 → 同上；`--expand-refs` 开启递归（每条 URL 的 opts 透传）。
- **`tests/cli/mowen-import.test.ts`**（或沿用既有 CLI 测试模式）：mock downloadMowenNote/metadata，钉参数拼装与 summary 形态。

## T6 · GUI 墨问 tab

**`src/renderer/pages/Download.tsx`**：顶部加 `Segmented`（链接 / 墨问笔记）——链接=现 UrlMode；
**`src/renderer/components/download/MowenMode.tsx`**（新）三段式：

1. 搜索行：`Input.Search`（`data-testid="mowen-search-input"`）→ IPC `mowen:searchUsers`；
   候选列表（昵称 / 简介 / UID 尾 6 位），行点击选中（`data-testid="mowen-user-item"`）。
2. 条件行：`--filter`（全部/合集/付费/热门）、`--recent`（24h/3d/7d/15d）、`--count`（默认 20）→
   IPC `mowen:listUserNotes` → 清单表（标题/发表时间/字数/「付费」标记/「含引用」标记/「文库已有」标记）。
   勾选：默认全选，文库已有与付费默认不选（标注原因，见设计决定）。
   含引用条目的操作区带「展开引用子笔记」子勾选（`data-testid="mowen-expand-refs"`，默认关）——
   勾选该行的下载 opts 带 expandRefs（T4b）。
3. 下载行：「下载选中（N）」→ 组装 mowen URL 数组 → **复用 `api.download(urls, formatsFromSettings)`**
   （现有通道：进度、历史、结果区全复用）；完成 toast + onDone() 刷历史。

**IPC**（ipc.ts）：`mowen:searchUsers(keyword)` / `mowen:listUserNotes(uid, opts)`——内部先 detectMocli
（未装 → 返回 `{ok:false, error:{code:'MOCLI_NOT_FOUND'}}`，渲染层显示指引；与 CLI 同话术）。
**preload/api.ts** 加两个方法。

- mocli 未装时 tab 顶部显示指引条（不灰死整页，PRD R3 降级语义）。
- **e2e（gui.e2e.mjs）**：下载页出现墨问 tab；切过去断言搜索输入与指引/状态条渲染（**不真调 mocli**，
  断言 UI 骨架与未装/已装文案二选一）；发现→下载链路的真机验收走 CLI（不入 e2e）。

## T7 · 收尾

1. 真机验收：① `mowen import <公开笔记id>`（带图笔记）→ 入库 + 阅读器打开 + 图片本地；
   ② `mowen import --uid 池建强UID --count 3`（含付费 1 篇 → unavailable 如实）；③ GUI tab 搜→选→批量下 2 篇。
2. `npm test` / lint / tsc / e2e 全绿。
3. PRD §6 R2 逐项勾选（未落项如实留白：--show-atom 通道、他人私密）；ROADMAP M61 行；devlog 实录。
4. wx-kit-skill 若 CLI 契约有增补（import）→ 按 AGENTS.md 规约同步速查表。
5. feat/m61 → main（push/tag 仍等安哥，v0.11.0 整版发）。

## 验收对照（PRD §6 R2 未勾项）

| PRD 条款 | 落点 |
|---|---|
| tab 搜用户（候选昵称/简介/UID） | T6 |
| 条件拉清单 + 默认全选（文库已有/付费默认不选） | T6（收窄项已标注，可砍回） |
| 批量下载串行/进度/可取消 + 格式跟设置 | T6（复用 download 通道） |
| URL 识别 detail/<id> 与裸 noteId | T3（normalizeMowenUrl） |
| note/show 主通道 + noteFile null 边界 | T1/T2 |
| BrowserWindow 兜底（note/show 网络失败才触发） | T4 |
| 图片 w_1200 落地、URL 不入库 | T2/T3（exporter 复用） |
| 音频嵌入、代码块保留 | T2/T2b |
| 合集引用块（含引用标记） | T4b |
| 递归下载显式开关（默认关，深度 3，付费子篇如实） | T4b/T5/T6 |
| 付费 ASSET_NOT_FOUND → unavailable 不伪装 | T1/T3 |
| 限速 0.5s/篇 0.3s/图 | T1/T3（注入 sleep 单测） |
| 同源入 library.json，sourceUrl 区分 | T3 |
| CLI import（单篇 + --uid 批量） | T5 |
| mocli 未装：tab 指引 + import 报错指引 | T5/T6 |
