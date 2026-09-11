# Spike · 墨问 (note.mowen.cn) 接入 wx-kit 可行性

> **结论先行(2026-09-11 晚修订)**:墨问接入 v0.11.0 **完全可行**。最优路径 = `mocli` 做发现(搜用户/拉清单/元数据) + **`note/show` 匿名接口拿正文(主通道)** + `wx-kit offscreen BrowserWindow` 渲染兜底,**零新增依赖**。
>
> **修订说明**:初版结论(正文走 BrowserWindow 渲染)被安哥同日的接口逆向探索超越——`POST note.mowen.cn/api/note/wxa/v1/note/show` 无任何凭证即返回结构化正文 HTML + 图片映射 + 统计,比渲染 SPA 更快更稳。完整逆向过程见 `dreamble/site/content/posts/2026-09-11-mowen-cli-exploration/`;本报告 §5.5 收录该通道并附当日复验记录。
>
> **覆盖范围**:
> - ✅ **公开笔记**(任何人可访问)— `mocli notes homepage/search/tagged` 拿 list + BrowserWindow 无 cookie 渲染拿正文
> - ✅ **自己写的笔记**(私密/部分公开/公开/付费)— `mocli notes mine` + `--show-atom` 拿完整 AST
> - ❌ **他人私密笔记**— mowen 按作者授权,mocli 列表接口不返回,wx-kit 也无法访问(v0.11.0 范围外)
>
> **历史**:这份报告合并了 5 个 spike 的发现,涉及 API 直连、SPA 结构、BrowserWindow 渲染等多个角度。

## 0. 用户身份锚定(2026-09-11 spike)

- 当前 mocli 认证用户 = 安哥本人 = **UID `4L8RrxEaExmHJOf9xrGLo`** = 尼古拉-猴哥
- 主页:https://note.mowen.cn/user/4L8RrxEaExmHJOf9xrGLo?from=mocli
- 这是 R2 范围的核心前提:**安哥自己的笔记可走 `--show-atom` 路径**;**关注的/他人的公开笔记走 BrowserWindow 渲染路径**

## 1. Spike #1 · API 直连 open.mowen.cn(2026-09-10)

**问题**:wx-kit 是否能直接调墨问 OpenAPI?

**实测**:

| 测试 | URL/头 | 结果 |
|------|--------|------|
| A1: 无 Authorization | `POST /api/v1/discover/activity` | **503 ALB** (200ms) |
| A2: 带 Authorization | 同 | **503 ALB** |
| A3: OPTIONS | `OPTIONS /api/v1/note/info` | **503 ALB** |
| A4: 浏览器完整头 | `POST /api/v1/discover/activity` | **503 ALB** (606 bytes,含 IE/Chrome padding) |
| A5: 同源路径 | `POST note.mowen.cn/api/...` | **405 openresty** |
| A6: 直连 ALB IP | `POST 47.94.80.199/...` | **SSL 错误** |
| A7: 50 秒内 5 次重试 | 每 10 秒一次 | 全部 503 |
| 对照 `note.mowen.cn` 根 | `GET /` + 浏览器 UA | **200 OK** (244ms) |
| 对照 `mowen.apifox.cn` 文档站 | `GET /` | **200 OK** |

**每次 503 响应体**(`via: HTTP/1.1 SLB.{64|76|87|216}`):

```
HTTP/2 503
content-type: text/html
<center><h1>503 Service Temporarily Unavailable</h1></center>
<hr><center>alb</center>      # 阿里云 ALB 兜底
```

**排除的假设**:
- ❌ 鉴权失败(无 Authorization 也 503)
- ❌ 速率限制(无 Retry-After,50s 内 5 次都 503)
- ❌ WAF 拦截(无 challenge、无验证码)
- ❌ 本机出网问题(note.mowen.cn、mowen.apifox.cn、github.com 都 200)
- ❌ 路径错误(试 4 个常见路径 + OPTIONS 都 503)

**剩余可能**(按概率):
1. 本机出口 IP 不在 ALB 白名单(最可能)
2. API server 当前不健康(但持续 1 分钟+不健康通常会恢复)
3. 地域限制(阿里云 ALB cn-beijing 节点)

**DNS**:
- `open.mowen.cn` → `alb-eugdpjee6ke4qvzq6t.cn-beijing.alb.aliyuncs.com` (阿里云 ALB 北京节点)

**脚本**:`scripts/spike-mowen-api.mjs`(留库,KEY redact,未来可重跑)

**结论**:wx-kit 不应走 `open.mowen.cn` API 路径。改走方案 B。

## 2. Spike #2 · mocli `--show-atom` 限制(2026-09-11)

**问题**:mocli 能不能直接给他人笔记的完整 AST?

**实测**:

```
mocli note info --note-id sR7--cPyh93LY0inGk2yX --show-atom
→ reply.info.content = { "word_count": 554 }      // 仅字数,无 AST
```

mo-note skill 文档明示:
> `--show-atom`:返回完整 NoteAtom JSON 正文,**仅自己的笔记会生效**

**结论**:
- mowen 对**他人笔记的完整正文不开放 API**(只开放 brief + word_count + stat)
- 即使 wx-kit 自己写 OpenAPI client,拿到的也是这个降级响应
- **唯一的完整正文来源是 mowen 自己的 web/H5/小程序渲染管线**

## 3. Spike #3 · mowen 网页结构分析(2026-09-11)

**问题**:note.mowen.cn HTML 含不含正文?有没有公开 JSON API?

**实测**:

### 3.1 详情页 HTML

```html
<!doctype html>
<html lang="zh-Hans">
  <head>
    <title>我做了将近 20 年互联网产品设计…</title>
    <meta name="description" content="有着近20年互联网产品设计经验的作者..." />
    <meta property="og:article:author" content="chill2" />
    <script crossorigin src="/main.js?v=2.17.0"></script>
  </head>
  <body>
    <div id="app"></div>           <!-- 唯一内容:空 SPA 壳 -->
  </body>
</html>
<!-- sign src="http://mo-fe-web-note-mowen-cn-note-srv/note/" at="..." -->
```

**关键发现**:
- ❌ 无 SSR(HTML body 只有 `<div id="app">`)
- ❌ 无内嵌 `__INITIAL_STATE__`
- ⚠️ HTML 末尾注释有**内网 API 路径线索**(`mo-fe-web-note-mowen-cn-note-srv`)— 但**外网 DNS 解析不到**

### 3.2 main.js(2.3KB)

```
$ curl -I main.js?v=2.17.0
content-length: 2328
```

实际只有 2.3KB,只 modulepreload 12 个子模块。**无任何 fetch/axios 调用、无 API 路径常量**。

### 3.3 子模块 grep

| 模块 | 大小 | fetch-like | 路径字面量 |
|------|------|-----------|-----------|
| `Detail-DkmlrX_E.js` | 35KB | 0 | `/explore` `/paid` `/my/notes` `/tag` `/msg` `/know/time`(纯前端路由)|
| `NotePreview-CCYQpInK.js` | 24KB | 0 | 无 |

**Detail.js Vue 模板暴露的 NoteAtom 字段**(非 fetch endpoint,是已渲染后访问):
- `e.note.base.{uuid, createdAt}`
- `e.note.user.{...}`
- `e.note.flag.{hasFee, hasRef, hasVideo, hasImage, previewHideDigest}`
- `e.note.extra.previewHideDigest`
- `/intro/${e.note.base.uuid}`(uuid 字段)

**结论**:
- mowen 详情页是**纯 Vue SPA + 大量 modulepreload**,无 SSR
- fetch 逻辑被拆散在各子模块,且大概率是**运行时拼装路径**(API endpoint 不在 JS 字面量里)
- **没有公开的 JSON API endpoint 暴露给人写爬虫**(仅有 SPA 渲染管线)

## 4. Spike #4 · BrowserWindow 渲染实测(2026-09-11)— **关键技术决策**

**问题**:用 wx-kit 自己的 offscreen BrowserWindow 渲染 mowen SPA,能不能拿到完整正文?需要 cookie 吗?

**脚本**:`scripts/spike-mowen-render.mjs`(留库,~30 行)

**核心逻辑**:
```javascript
const win = new BrowserWindow({ show: false })
await win.loadURL('https://note.mowen.cn/detail/<id>')
// 等 Vue 异步渲染完成:稳定 3 轮(连续 3 次 innerText 不变)+ 长度 >100
for (let i = 0; i < 30; i++) {
  await sleep(1000)
  text = await win.webContents.executeJavaScript('document.querySelector("#app")?.innerText || ""')
  if (text === prev) stableCount++; else { stableCount = 0; prev = text }
  if (stableCount >= 3 && text.length > 100) break
}
```

**实测**:加载 `sR7--cPyh93LY0inGk2yX`(chill2 的笔记),**完全无 cookie**

|指标 | 值 |
| | |
| `textLength` | **1052** |
| `hasContent` | true |
| 关键词命中 | `京东健康` ×2 / `A380` ×2 / `驾驶舱` ×1 |
| snippet | "我做了将近 20 年互联网产品设计,用得更久,如今面对京东健康安卓客户端时,感觉自己像一个被捆住双手的五岁孩子,突然醒来,挣扎着从面罩里探出一只眼睛,发现正独自坐在空客 A380 的驾驶舱上..." |

**结论**:
- ✅ **公开笔记不需要 cookie 即可拿到完整正文**(mocli `stat.view:115` 印证)
- ✅ BrowserWindow 渲染路径**完全可行**,无新增依赖
- ✅ 复用 wx-kit 现有 PDF 导出的 `export-pdf.ts`(`new BrowserWindow({ show: false })`)模式

## 5. Spike #5 · 私密/付费笔记边界推论(2026-09-11,**未实测**)

**问题**:带 mocli cookie 渲染,能不能拿到他人私密笔记?

**推论**(未实测,但逻辑清晰):

| 笔记类型 | mocli list 是否返回 | 浏览器 + 当前用户 cookie 是否能看到 |
|---------|-------------------|--------------------------------|
| 公开 | ✅ | ✅ |
| 会员可看(付费) | ✅(若当前用户是会员)| ✅ |
| 他人私密 | ❌(不进 homepage/search)| ❌(按作者授权,非 cookie 身份)|

**关键洞察**:
- mowen 访问控制是**作者授权模型**,不是**登录态模型**
- mocli 列表接口只返回**当前用户能看到**的笔记 = 私密笔记**根本不会进 list**
- 「别人的私密笔记 + 别人的 cookie」= 仍看不到

**结论**:
- R2 v0.11.0 范围 = 「mocli 能列出的所有笔记」(公开 + 会员可看 + 自己写的)
- 他人私密笔记**不在 v0.11.0 范围**(mocli 也无能为力)
- **不需要 cookie 复用机制**(公开/会员可看无需,自己的有 mocli 自然访问)

## 5.5 Spike #6 · `note/show` 匿名正文接口(2026-09-11,安哥逆向 + 当日晚复验)— **正文主通道**

**来源**:安哥独立探索(完整记录 `dreamble/site/content/posts/2026-09-11-mowen-cli-exploration/index.md`),路径为「headless 浏览器 network 面板定位 SPA 的 XHR → 裸 curl 直调验证」。

**接口**:

```
POST https://note.mowen.cn/api/note/wxa/v1/note/show
Content-Type: application/json
{"uuid": "<笔记ID>"}
```

**匿名性已双重验证**(安哥原文 + wx-kit 侧 2026-09-11 晚复验):最裸请求(仅 Content-Type,UA 为 curl,无 Origin/Referer/Cookie/Authorization)返回完整正文。复验样本 `sR7--cPyh93LY0inGk2yX`(chill2):

| 字段 | 复验结果 |
|------|---------|
| `noteBase.title` / `content` | ✅ 命中,content 810 字符 HTML |
| `noteFlag` | ✅ 完整(isPublic/hasFee/hasImage/auditStatus 等 24 字段) |
| `noteStat` | ✅ `{duv:'126', comment:'5', favor:'14', ...}` |
| `user.base.name` | ✅ `chill2` |
| `noteFile` | ⚠️ **无图笔记为 `null`**(非缺省空对象)——解析器边界,已写进 PRD 验收 |

**响应关键结构**:`detail.noteBase.{uuid,title,digest,content,createdAt,publicAt,uid}`、`detail.noteFile.images[<uuid>].{url,scale.w_1200}`(OSS 签名 URL,约 7 天过期)、`detail.noteStat`、`detail.noteFlag`、`user.base`。

**行为边界**(安哥实测):

| 笔记类型 | 接口行为 |
|---|---|
| 公开笔记 | ✅ 完整正文,不管是否关注作者 |
| 付费笔记 | ❌ `400 ASSET_NOT_FOUND`(附 skuId,付费墙在服务端) |
| 私有笔记 | 不会出现在任何发现渠道,无从触达 |

**图片机制**:正文 HTML 中 `<img uuid="xxx">` 无 src,按 `noteFile.images` 映射取 URL;`scale.w_1200` 是合适下载规格;签名 URL 7 天过期→必须同次流程落盘、URL 不入库。

**与 spike #4(BrowserWindow)的分工**:`note/show` 更快(无 30s 渲染窗)、更结构化(HTML+图片映射+统计),升为**主通道**;BrowserWindow 降为**兜底**(接口失效/风控时),spike #4 验证结论与脚本继续有效。

**风险(如实记录,进 PRD)**:民间逆向接口无官方 SLA,随时可能加登录/频控(等级:高)。应对:限速 0.5s/篇 + 0.3s/图;`EmptyContent`/连续失败作为接口变更信号自动降级 BrowserWindow;个人工具形态(单用户、限速、仅自己关注的内容)是最安全的合规边界。

## 6. v0.11.0 R2 实现路径(2026-09-11 晚修订)

```
发现层(mocli,官方 OpenAPI,已认证)          获取层(匿名/渲染)
─────────────────────────────          ─────────────────────────
user search --keyword   → 候选用户      ① note/show POST {uuid}      ← 主通道(公开笔记)
notes homepage --uid    → noteId 清单      ↓ 结构化 JSON(HTML+图片映射+统计)
  (--filter/--recent/--count)         ② --show-atom AST            ← 自己笔记优先
note info --note-id     → 元数据        ③ BrowserWindow 渲染         ← 兜底(接口失效时)
                                             ↓
                                      mowen-to-article → ParsedArticle
                                      图片按 noteFile.images 落盘(scale.w_1200,URL 不入库)
                                             ↓
                                      复用 exporter: md/html/pdf/cover/meta → library.json
```

**三条正文路径(自动化选优)**:

| 优先级 | 路径 | 触发 | 数据形态 |
|------|------|------|---------|
| 1 | `mocli --show-atom` | 自己写的笔记(uid 匹配认证身份) | 完整 NoteAtom AST(结构化最稳) |
| 2 | `note/show` 匿名接口 | 公开/会员可看笔记(主通道) | 结构化 JSON(HTML + 图片映射 + 统计) |
| 3 | BrowserWindow 渲染 | 兜底(note/show 连续失败时) | DOM innerText + 解析 |

**限速**:笔记 0.5s/篇、图片 0.3s/张,写死在 core 层。

## 7. 关键设计决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | **不走 `open.mowen.cn` API** | spike #1 证实在本机 ALB 503,即使网络通了也是重复造客户端(API 仅给 brief 不给 AST)|
| 2 | **mocli 拿元数据,不用 `--show-atom`**(除自己笔记外) | spike #2 证 `--show-atom` 仅自己生效 |
| 3 | **正文主通道 = `note/show` 匿名接口,BrowserWindow 兜底** | spike #6(安哥逆向+复验):结构化 JSON 直接拿 HTML/图片映射/统计,无 30s 渲染窗;渲染路径保留为接口失效时的降级 |
| 4 | **不做 cookie 复用** | spike #5 推论 + spike #6 复验:公开/会员可看无需 cookie;私密不在范围 |
| 5 | **不引入 headless 浏览器** | 复用 wx-kit 已有 Electron,零新增依赖(CLAUDE.md:无独立 chromium)|
| 6 | **资源本地化,URL 不入库** | 与微信视频 mpvideo 同坑(CLAUDE.md 钉死):OSS 签名有时效 |
| 7 | **同源入 library.json** | 零迁移成本,`sourceUrl` 区分来源 |

## 8. 待实现模块清单(PRD R2 依据)

```
src/core/mowen/
├── detect.ts            # ~50 行  which mocli 检测
├── metadata.ts          # ~150 行 spawn mocli:user search / homepage 清单 / note info / --show-atom
├── note-show.ts         # ~120 行 note/show 匿名接口(gateway 域名路由 + 限速)——主通道
├── browser-render.ts    # ~150 行 offscreen BrowserWindow 兜底渲染
│                                  复用 src/core/exporter/export-pdf.ts 模式
│                                  复用 spike-mowen-render.mjs 稳定轮询逻辑
├── mowen-to-article.ts  # ~250 行 note/show JSON / NoteAtom / DOM → ParsedArticle(图片本地化)
└── errors.ts            # ~50 行  MocliNotFound / MocliFailed / MowenNoteUnavailable / RenderTimeout / EmptyContent

src/core/download-article.ts
└── URL 路由识别 note.mowen.cn/detail/<id> → mowen 分支(~30 行)

src/cli/
└── mowen { import | detect | list-user | search-user | list-mine | search }  (~350 行)

src/renderer/
└── 下载页「墨问笔记」tab:搜用户 → 条件 → 清单(默认全选) → 批量下载  (~400 行,复用批量页骨架)
```

**总预估**:~700-850 行,1 个主里程碑(M60) + 1 个验收里程碑(M61)

## 9. 不变项与后续

- 安哥提供的 API-KEY 已在 spike 中使用并被脚本自动 redact,key 未落盘任何文件、未进代码库、未进 git 历史
- `scripts/spike-mowen-api.mjs`、`scripts/spike-mowen-render.mjs` 保留库,未来可重跑
- 旧 spike 文件 `2026-09-10-mowen-api-feasibility.md` 保留为历史(本报告替代)
- 后续如果要支持「他人私密笔记」,需先 spike mowen 鉴权机制(分享链接 token?会员白名单?)再决定路径