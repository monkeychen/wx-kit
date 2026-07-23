# wx-kit v0.8.2 产品需求文档(迭代 PRD)

> **状态:需求收集中**(2026-07-22 起,安哥逐条报)。收齐并确认后再拆里程碑、写实现计划。
> 已收:R1、R2。

## 1. 一句话定义

(待收齐后补)

## 2. 需求清单

### R1 · 订阅检查后要有反馈,尤其是「自动下载」模式(2026-07-22 安哥)

**原始现象**:设置页「发现新文章时」选了**自动下载**后,在订阅页点「检查全部」或某个号的「检查」,若有新文章就直接下走了——**页面没有任何反馈**,不出现「下载 / 忽略」的选项,只在最后多一条日志。安哥一度以为是 bug(查出新文章却没下载),直到在「下载」页看到记录才反应过来是自动下载了。

**现状核实(2026-07-22,回源看代码)**:属实,而且**根子上有一处实现遗漏**。

- `electron/ipc.ts:288`:
  ```ts
  ipcMain.handle('subscriptions:checkNow', async (_e, fakeids?) => { await runSubscriptionCheck('manual', fakeids) })
  ```
  `runSubscriptionCheck` 明明返回 `{ accounts, newFound, failed, failures, note, authExpired }`,**IPC 层把返回值整个丢掉了**。渲染层拿到 `undefined`,所以 `checkNow()` 只能 `await load()` 刷列表,**想提示也无从提示**。
- `Subscriptions.tsx` 的 `checkNow` / `checkOne`:`await api.subscriptionsCheckNow(...)` → `await load()`,**全程无任何 message/行内反馈**。
- 「自动下载」路径最静默:新文章下完即 `clearNewRefs`,`newRefs` 为空 → 行内自然不会出现「下载 N 篇 / 忽略」→ **列表看上去毫无变化**。对比「仅提示」模式至少有按钮冒出来,算有视觉变化。**恰恰是自动下载这条路径零反馈**。
- 自动下载的**过程**也不可见:手动点「下载 N 篇」走 `subscriptions:downloadNew`,有 `subscriptions:download:progress` 事件驱动行内进度条;而自动下载走的是 `runSubscriptionCheck` 内部的 `downloadRefs`,**不发进度事件**。
- 下载完也没指路:安哥是自己切到「下载」页才发现的。

**关键约束(决定改法)**:`RunCheckResult` 目前**只有汇总数**(`accounts` / `newFound` / `failed`),**没有逐号明细**。而行内反馈要求「每一行显示自己新增了几篇」,所以**必须给结果加 per-account 明细**——这是本需求的主要结构改动,不是加个 toast 就完事。

**交互选型(2026-07-22 安哥定)**:

安哥先否掉了我最初按「改动深浅」分的三个方案——**指出提示文案是照着「检查全部」写的,套到单号「检查」上就不对了**。由此确立原则:**反馈落在被操作的对象上**。

- **行内为主**:每个号检查完,结果就地显示在那一行(含自动下载进度),几秒后淡出。
- **单号检查不弹全局提示**——操作范围小,反馈就近。
- **「检查全部」额外给一条汇总**(如「查 3 号,新 7 篇,已自动下载」),因为它的操作对象是全体。
- **策略常驻可见**:「检查全部」旁标注当前策略(如「发现新文章将自动下载」),可点击直达设置。设置是几天前设的,点检查时早忘了——**让状态可见,而不是让人回忆**。

**细化方案**:

- **编排层**(`electron/services/subscription-check.ts`):`RunCheckResult` 增逐号明细,形如
  `results: Array<{ fakeid, nickname, newFound, downloaded, ok, error? }>`(`downloaded` 区分「自动下载了几篇」与「仅提示,待处理几篇」)。汇总字段保持不变,向后兼容。
- **IPC**:`subscriptions:checkNow` **返回**该结果(修掉丢返回值);`preload.ts` + `api.ts` 同步类型。
- **自动下载进度**:`ipc.ts` 构造给 `runSubscriptionCheck` 的 `downloadRefs` 时挂上进度回调,复用既有的 `subscriptions:download:progress` 事件(带 `fakeid`),让行内进度条对自动下载也生效——**与手动下载同一套 UI,不新造机制**。
- **渲染层**(`Subscriptions.tsx`):
  - 行内结果态:`✓ 已自动下载 N 篇 [去看看]` / `发现 N 篇待处理` / `暂无新文章` / `✗ 失败原因`;几秒后淡出(失败态可考虑常驻至下次检查)。
  - `[去看看]` 直达文库(带该公众号筛选),解决「东西下到哪了」。
  - 「检查全部」结束追加一条汇总 message;单号检查不弹。
  - 顶部「检查全部」旁常驻策略标注 + ⚙ 直达设置。
- **CLI 一致性**(工作流第 7 条):`subscription check-now` 的 stdout JSON 同步带上逐号明细——agent 同样需要知道「哪个号新增了几篇」,而不只是总数。若字段变更须刷 `agent/wx-kit-skill/`。
- **频控**:纯 UI/数据透传改动,**不改任何抓取行为**,频控纪律不变。

**验收(草)**:

- [ ] 「自动下载」模式下点某行「检查」:该行显示下载进度,完成后显示「已自动下载 N 篇」,不弹全局提示。
- [ ] 同模式下点「检查全部」:各行分别显示自己的结果,结束后顶部一条汇总(查 N 号 / 新 M 篇 / 已自动下载)。
- [ ] 「仅提示」模式行为不回归:行内照旧出现「下载 N 篇 / 忽略」,并同样有「发现 N 篇待处理」的行内反馈。
- [ ] 无新文章 / 检查失败(频控等)也有明确行内反馈,不再是「点完什么都没发生」。
- [ ] 行内「去看看」能直达文库并定位到该公众号的文章。
- [ ] 订阅页常驻显示当前「发现新文章时」策略,点击直达设置页对应项。
- [ ] CLI `subscription check-now` 输出含逐号明细;skill 文档同步。
- [ ] 既有自动检查(定时触发)、手动下载、订阅增删链路不受影响(单测 + e2e 全绿)。

### R2 · 支持下载含视频的文章(2026-07-22 安哥)

**原始需求**:支持下载正文含视频的文章。测试 URL `https://mp.weixin.qq.com/s/bXUTSRQ_zIvyigWiqw3UfA`。

**现状核实 + 抓包实证(2026-07-23,真实拉取那篇文章)**:

- 当前完全不处理视频:`DownloadFormat = 'cover'|'md'|'html'|'pdf'|'meta'`,`parse-article.ts` / `download-article.ts` 无任何 video/mpvideo 逻辑。
- **微信文章里的视频有两种源,难度天差地别**:
  - **`mpvideo.qpic.cn`(内嵌上传视频)**——公众号作者直接上传到文章的视频。**mp4 直链就写在初始 HTML 里**(curl 即得,无需 headless 渲染);同一视频有 4 档清晰度(`f10002` 标清 … `f10104` 高清)。**已实测可下**:range 请求 `HTTP 206`,文件头 `ftyp isom` 是真 mp4,`content-type: video/mp4`。测试文章的正文视频即此类。
  - **`findermp.video.qq.com`(视频号卡片)**——`encfilekey` 加密,需另做解密 + 视频号 API,复杂度高一个量级、接口易变。测试文章里只在 `cover_url` 出现。
- **直链有时效**:URL 带 `dis_t` 时间戳 + `auth_key` 签名,过期即失效。**这条决定架构**:视频必须在「解析 HTML 的同一次流程里」立即下载,不能像别的格式那样存 URL 隔次再下。恰好与现有「图片解析后立即本地化」同构。

**范围/清晰度选型(2026-07-22 安哥定)**:

- **只做 `mpvideo` 内嵌上传视频**;`findermp` 视频号卡片本版不做——遇到则在 meta 标注「含未支持的视频号内容」(不静默丢弃,让用户知情)。
- **默认下最高可用清晰度**(`f10104 > f10102 > f10004 > f10002`,择高存在者);那档取不到自动回退次高档。

**细化方案(次要决策为 agent 按项目惯例所定,安哥可推翻)**:

- **新增格式 `video`**(`DownloadFormat` 加一项):
  - **不进 `defaultFormats` 默认勾选**——视频动辄几十上百 MB,默认下会拖垮批量。用户/agent 显式选 `video` 才下(YAGNI + 尊重带宽)。
  - GUI 的 FormatPicker 增「视频」项;CLI `--formats ...,video`。
- **解析**(`parse-article.ts`):从 HTML 提取 mpvideo 直链集合——每个视频取 `vid` + 各清晰度 URL + 封面(`cover_url`)。产出 `videos: Array<{ vid, url, cover, ... }>`(择最高清 URL)。
- **下载/本地化**(`download-article.ts`):选了 `video` 时,解析后**立即**顺序下载(不并发,视频大;range 206 支持,失败可整段重下,首版不做断点续传)到文章目录 `videos/video-N.mp4`,带下载进度(复用 fetchBinary + 进度回调)。**auth_key 时效:必须在本次流程内下完,URL 绝不入库缓存**。
- **正文引用改写**:
  - `md`:视频位置插入 `[📹 视频](videos/video-N.mp4)`(纯文本无法内联,给可点链接;可附封面图引用)。
  - `html`:`<video controls poster="images/..." src="videos/video-N.mp4">`——阅读器 html 视图可直接播(video 标签不依赖脚本,不受 iframe `sandbox` 无 allow-scripts 限制)。
- **meta.json**:记录 `videos`(vid、清晰度档、本地路径、封面);若检测到 `findermp` 视频号内容,加 `unsupportedVideoNote`。
- **阅读器**:html 视图播视频即可(md 视图链接可点跳系统播放器);GUI 文库项可考虑标「含视频」角标(次要,实现时定)。
- **频控/体积**:视频与文章串行,不额外并发;大文件下载给明确进度,失败话术归一(复用现有频控/失败 UI)。**mpvideo 直链是腾讯 CDN,与微信公众号频控是两套,但仍串行保守**。
- **CLI/skill 同步**(工作流第 7 条):`--formats` 支持 `video`;输出与 meta 结构变更后刷 `agent/wx-kit-skill/`。

**验收(草)**:

- [ ] 选 `video` 格式下载测试文章:`videos/video-1.mp4` 落盘,是可播放的完整 mp4(非 206 半截),清晰度为最高可用档。
- [ ] `md` 正文在视频位置有可点链接指向本地 mp4;`html` 正文 `<video>` 在阅读器里能播。
- [ ] 不选 `video` 时行为与现状完全一致(不下视频、不改正文),`defaultFormats` 不含 video。
- [ ] 一篇多视频文章:各视频分别落 `video-1/2/...mp4`,引用一一对应。
- [ ] auth_key 时效:解析后立即下,URL 不写入 library.json/meta;隔次下载重新解析取新链。
- [ ] 含视频号(findermp)卡片的文章:mpvideo 部分正常下,视频号部分 meta 标注「未支持」,不报错、不阻断其余格式。
- [ ] 视频下载失败(网络/超时):话术清晰、不阻断其他格式;可整篇重下。
- [ ] CLI `--formats video` 与 GUI 一致;meta.json 含 videos 明细;skill 文档同步。
- [ ] 既有 cover/md/html/pdf/meta 全链路不受影响(单测 + e2e 全绿)。

## 3. 里程碑拆分

(待收齐后补)

## 4. 非目标

- (待收齐后补)

## 待议 / 顺带发现

- **定时自动检查(`trigger: 'auto'`)时的反馈**:用户多半不在订阅页,甚至窗口在后台。当前只有日志。是否需要系统通知 / 应用内红点提醒?**本轮先不做**,若安哥后续提再议(记在这里防遗漏)。
