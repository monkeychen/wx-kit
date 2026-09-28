# 暖色编辑杂志风（Warm Editorial）— UI/UX 设计系统

> 通用设计系统文档，**与任何具体业务无关**，只定义视觉与交互契约。任何项目可按本文从零落地。
> 本系统在 wx-kit 中的落地位置与源文件索引见 **附录 B**，仅供查证与拷贝，不属于设计系统本体。
> 文档与实现漂移时，以实现为准，并回改本文。

---

## 1. 设计定位

一套面向**内容型应用**的暖色纸感界面语言：暖白纸底、衬线刊头、朱砂点缀。观感像一本纸质刊物，而不是一个后台管理系统。

三条底层判断（移植时不可丢）：

1. **内容是主角，界面是纸张。** 纸底三层制造空间层次，墨色三层制造信息层级；强调色只做点缀（下划线、圆点、选中态），绝不整片铺陈。
2. **不打扰用户是最高的礼貌。** 通知用导航圆点而非弹窗/toast；补充信息用弱化边框标而非警告色；原始报错折叠备查，人话指引放明面。
3. **反馈引导行动，而非只报告状态。** 失败提示 = 标题 + 下一步；提示/告警就地变成可执行动作，不让用户自己猜下一步。

---

## 2. 技术栈与分工

| 层 | 技术 | 用途 |
|---|---|---|
| 组件库 | antd 6 | Input/Button/Select/Modal/message/Popconfirm 等交互控件 |
| 主题对接 | antd `ConfigProvider` token（参考实现：`theme.ts`） | 让所有组件库控件自动套用设计系统配色 |
| 设计 token + 组件样式 | 全局 CSS（CSS 变量 + 语义 class） | 全部自定义视觉 |
| Tailwind 3 | **基本闲置**（preflight 关闭、theme 为空） | 仅偶发 utility，不作为样式主方案 |
| 路由 | react-router-dom 7 | 横向导航 `NavLink` |

**关键决策：不用原子类堆样式，不用 CSS-in-JS。** 一份语义 class 表 + CSS 变量，可读、可移植、组件库之外的视觉全部可控。新项目若不想带 Tailwind，直接删掉零成本。

> 组件库是可以替换的：本文的色彩/字体/圆角/尺寸契约不依赖 antd。换组件库时只需把 §4 的 token 映射重写一遍，§3 与 §7 原样保留。

---

## 3. 设计 Token

### 3.1 色彩

```css
:root {
  /* 纸底三层：空间层次 */
  --paper:        #faf7f0;   /* 暖白纸底（页面背景） */
  --paper-raised: #fffdf8;   /* 卡片/浮层略亮（surface） */
  --paper-sunken: #f3ede1;   /* 凹陷区/输入底/表头 */

  /* 墨色三层：信息层级 */
  --ink:       #211c15;      /* 墨黑正文/标题 */
  --ink-soft:  #6c6354;      /* 次要暖灰（说明文字） */
  --ink-faint: #a59c89;      /* 占位/弱提示/计数 */

  /* 朱砂：唯一主强调色 */
  --cinnabar:      #b5462f;
  --cinnabar-soft: #c9603f;  /* hover 态 */
  --cinnabar-wash: #f6e7df;  /* 极浅底（选中/引用/失败徽章） */

  /* 语义色：各配一个 wash 浅底 */
  --jade:  #3f6b51;  --jade-wash:  #e6efe7;  /* 成功/已完成 */
  --amber: #9a6b1e;  --amber-wash: #f3e9d4;  /* 警告/待处理 */
  --celadon: #3f8f6f;                        /* 信息态（非故障提示，不用警告色吓人） */

  /* 线条与阴影：全部从墨色派生 */
  --line:        rgba(33, 28, 21, 0.10);
  --line-strong: rgba(33, 28, 21, 0.18);
  --shadow-soft: 0 1px 2px rgba(33, 28, 21, 0.04), 0 8px 24px rgba(33, 28, 21, 0.06);
}
```

用色纪律：

- **语义色只用于状态**（成功/警告/失败/信息），品牌强调只用朱砂，二者不混用。
- **wash 浅底永远配套主色出现**：徽章、选中态、引用块 = 主色文字 + wash 底，形成统一的「着色不描边」语言。
- **失败与主强调共用朱砂**——本系统刻意如此（暖色体系里没有真正的「红」）。若目标项目需要区分 error 与 brand 色，把两者拆开即可，其余契约不变。

### 3.2 字体

```css
  --font-serif: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong",
    "SimSun", Georgia, "Times New Roman", serif;
  --font-sans:  "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui,
    -apple-system, "Segoe UI", Roboto, sans-serif;
```

**分工铁律：衬线 = 阅读，黑体 = 操作。**

| 用衬线（--font-serif） | 用黑体（--font-sans） |
|---|---|
| 品牌刊头、页面大标题 | 导航、按钮、表单、表格数据 |
| 内容标题、分组名、卡片标题 | 说明文字、元信息、徽章 |
| 长文视图的各级标题 | 长文正文（16.5px 黑体）——只有标题衬线 |
| 空状态符号、印章字 | 等宽场景单独用 mono 栈 |

### 3.3 尺寸

- 圆角阶梯：`4px`（小标签）/ `6–8px`（按钮、输入、缩略图）/ `10px`（卡片）/ `12px`（分组、大卡）/ `999px`（药丸：徽章、进度条、批量条）。
- 控件基准：圆角 `8px`、高度 `38px`、字号 `14px`。
- 布局：页面左右留白 `40px`；刊头高 `68px`；长文版心 `max-width: 720px`；双栏页左栏 `248px`。

### 3.4 纸张质感（标志性细节）

页面背景叠加一层极淡 SVG 噪点（opacity 0.025），营造纸的肌理而非死平色：

```css
body {
  background-color: var(--paper);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E");
}
```

---

## 4. 组件库主题对接

组件库 token 与 CSS 变量逐项镜像，保证控件与自定义 UI 无缝一致（以 antd 为例）：

```ts
export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#b5462f',      // = --cinnabar
    colorInfo:    '#b5462f',      // 信息也走朱砂，不引入蓝色系
    colorSuccess: '#3f6b51',      // = --jade
    colorWarning: '#9a6b1e',      // = --amber
    colorError:   '#b5462f',      // = --cinnabar
    colorText:            '#211c15',   // = --ink
    colorTextSecondary:   '#6c6354',   // = --ink-soft
    colorTextTertiary:    '#a59c89',   // = --ink-faint
    colorBgBase:      '#faf7f0',      // = --paper
    colorBgContainer: '#fffdf8',      // = --paper-raised
    colorBgElevated:  '#fffdf8',
    colorBorder:          'rgba(33, 28, 21, 0.18)',  // = --line-strong
    colorBorderSecondary: 'rgba(33, 28, 21, 0.10)',  // = --line
    borderRadius: 8,
    controlHeight: 38,
    fontSize: 14,
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Button: { fontWeight: 600, primaryShadow: 'none' },
    Input: { activeShadow: '0 0 0 2px rgba(181, 70, 47, 0.12)' },  // 朱砂淡焦环
    Segmented: { itemSelectedBg: '#fffdf8', trackBg: '#f3ede1' },   // 凹陷轨道 + 凸起滑块
    Modal: { titleFontSize: 18 },
  },
}
```

移植时：**改 CSS 变量必须同步改这份 token**，两处漂移是最常见的腐烂点（建议从一处生成另一处）。

---

## 5. 排版系统

| 元素 | 规格 |
|---|---|
| 页面大标题 | 衬线 700 / 30px / line-height 1.15 |
| 长文标题 | 衬线 700 / 32px / 1.25 |
| 卡片/分组标题 | 衬线 600–700 / 16–20px / 1.3–1.42 |
| 眉题 eyebrow | 黑体 600 / 12px / letter-spacing 0.22em / 大写 / 朱砂 |
| 页面副题 | 黑体 / 14.5px / --ink-soft |
| 长文正文 | 黑体 16.5px / line-height 1.85 |
| 正文内标题 | 衬线 700，h1 25 / h2 21 / h3 18，上边距 1.8em |
| 元信息 | 12–13px / --ink-soft 或 faint |

标志性排版细节：

- **h2 前置朱砂短线**（18×2px，`::before`），全文最克制也最有效的章节记号。
- **眉题/分区头用大字距大写小字**（letter-spacing 0.16–0.28em + uppercase + 11–12px），杂志目录页语言。
- **正文引用**：左 3px 朱砂边 + 斜体 + --ink-soft；**正文链接**：朱砂字 + wash 底色下边线，无下划线。

---

## 6. 布局系统

### 6.1 顶部刊头 masthead（取代侧边栏）

左品牌右横向导航，68px 高，底部 1px 线，背景 `linear-gradient(paper-raised, paper)`。**刻意不用左侧 Sider**：横向导航更像刊物报头，把纵向空间还给内容。

- 品牌：衬线 700 / 22px + 字距 0.06em；右侧配大字距大写小字副标（朱砂）。
- 导航项：黑体 15px，--ink-soft → hover --ink → active --ink 600；**active 态在刊头底部压 2px 朱砂条**（`::after`，与刊头边线重合）。
- 通知一律用导航项上的 6px 朱砂圆点承载，不弹任何窗。

### 6.2 页面容器

```
.page      → flex:1, overflow-y:auto, padding: 0 40px 64px
  .fade-in → padding-top: 44px（顶部留白放在这里，让 sticky 组头能钉到滚动容器真正顶边）
  .page-head → margin-bottom 28px；标题 30px 衬线 + 副题 14.5px
```

### 6.3 双栏工作台（设置/详情类页面）

`grid-template-columns: 248px 1fr`，gap 22px，max-width 1420px 居中。左栏 sticky（top 92px）；≤900px 时降级单栏、左导航变横向滚动条。

### 6.4 长文阅读视图

顶栏（与刊头同渐变）→ 滚动区 → 正文容器（720px 版心，48/32/96 内边距）。结构固定为：眉题（朱砂小字）→ 衬线大标题 → 署名行（底边线分隔）→ 正文。

---

## 7. 组件规范

组件在本文档中以**语义名**定义；括号内是参考实现的 class 名，移植时可按需改名。组件层纪律：**状态与类型文案收口到单一模块**，两处各写一份必然漂移。

### 7.1 容器基元（`.surface`）

```css
.surface {
  background: var(--paper-raised);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-soft);
}
```

一切「容器」的基形。卡片族（内容卡/设置分组/事件行/任务卡）都是它的变体，统一规则：**细边线 + 柔影，不用粗边框不用重投影**。

### 7.2 媒体卡片（`.article-card`）

- 结构：封面（16:10）→ 卡片体（衬线标题两行截断 + 元信息沉底）→ hover 浮出的操作条。
- 无封面时用**朱砂渐变占位 + 衬线首字**，是整站通用的「印章」母题（分组印章、列表缩略图占位同款）。
- hover：`translateY(-3px)` + 阴影加深；入场：`rise` 动画（10px 上移淡入 0.4s）。
- 选中：`outline: 2px solid var(--cinnabar)`（offset -1px）+ 左上角浮现朱砂勾选块；列表行选中：wash 底 + `inset 3px` 朱砂竖条。
- 大列表性能：`content-visibility: auto` + `contain-intrinsic-size: auto 300px`。
- 操作条默认 `opacity: 0`，卡片 hover 才浮现——**操作密度让位内容密度**。

### 7.3 状态徽章（`.badge-*`）

药丸形，黑体 600 / 12.5px，自带 6px 圆点：

| 变体 | 语义 | 配色 |
|---|---|---|
| `ok` | 成功/已完成 | jade 字 + jade-wash 底 + jade 点 |
| `skip` | 跳过/待处理 | amber 同构 |
| `fail` | 失败 | cinnabar 同构 |
| `cancel` | 已取消/中性 | ink-soft 字 + paper-sunken 底 |

配套 **弱化属性标**（`.kind-tag`，11px 细边框小标）：默认灰边灰字；`.warn` 朱砂；`.info` 青瓷——**信息态绝不借警告色**。

### 7.4 chip 选择器（`.fmt-chip` / `.tb-toggle`）

多选/开关类控件的统一形态：raised 底 + line-strong 边 → hover 朱砂 soft 边 → 选中 `cinnabar 边 + wash 底 + 朱砂字 600`，active 微沉（translateY 1px）。自带圆形指示器（空心 → 选中实心朱砂 + 白勾缩放浮现）。

### 7.5 主行动按钮（`.cta`）

朱砂实底、白字、600、圆角 8、`9px 24px`；hover 变 `--cinnabar-soft`，disabled 0.6 透明。**每屏主行动唯一**，次级动作用组件库 default 按钮或文字按钮（hover wash 底），危险动作 hover 才显朱砂。

### 7.6 进度（`.progress`）

6px 圆角轨道（sunken 底）+ `linear-gradient(90deg, cinnabar, cinnabar-soft)` 填充，width 过渡 0.35s。头部：阶段名朱砂 600 + 计数弱灰；底部当前项单行截断 faint。

### 7.7 批量操作条（`.selbar`）

底部居中浮动药丸：wash 底 + cinnabar-soft 边 + 大投影，`position: fixed; bottom: 28px`。**刻意不挤动列表**——选中后内容零重排，单击/双击语义不串位。左计数、右危险动作实底钮。

### 7.8 空状态（`.empty-state`）

居中列：52px 衬线符号（朱砂、opacity 0.5）→ 19px 衬线标题 → 说明文字。符号母题延续「印章」语言，不用插画、不用 emoji 堆砌。

### 7.9 分组头（`.ghead`）

sticky 钉顶（z-index 5、paper 底遮滚动内容）：caret（收起 rotate -90deg，0.15s）→ 印章（`.gseal`，26px 朱砂渐变底衬线字）→ 衬线组名 16px → faint 计数 → 弹性 1px 线。

### 7.10 表单行（`.settings-row`）

`grid-template-columns: minmax(180px,260px) 1fr`：左列标签 600 + 小字 hint；右列控件**右对齐**、输入类控件 `flex: 1 1 320px` 弹性占满。行间以 border-top 分隔，首行无线。组级状态徽章（ok/warning/off）钉在组标题右侧。

### 7.11 提示条三件套

- **提示条**（`.settings-callout`）：amber-wash 底 amber 字，用于隐私/风险类说明，权重高于普通 hint。
- **结果条**（`.settings-test-result`）：ok= jade / fail= cinnabar / pending= sunken；**默认两行截断，hover 原地展开全文**——不用浮层（父容器圆角裁剪会吞 tooltip，原地切换最稳）。
- **失败指引**（`.fail-hint`）：人话指引（标题+下一步），`cursor: help`，原始报错放 `title` 折叠备查。

---

## 8. 动效与滚动条

**动效只有一套语言：`rise`。** `opacity 0→1 + translateY(10px→0)`，0.4–0.45s ease，用于页面入场与卡片入场。所有 hover/选中过渡统一 `0.14–0.18s ease`；位移反馈只两处：卡片 hover 上浮 3px、按压下沉 1px。没有弹跳、没有缩放动画、没有长时长——工具型应用，动效服务定位感，不表演。

滚动条统一重塑：11px 宽、透明轨道、`line-strong` 圆角滑块 + 3px paper 内边距（悬浮感），hover 加深为 `ink-faint`。

---

## 9. 交互行为准则

通用 UX 契约，与业务无关，随功能逐步落地即可：

1. **打断用户是最差的告知方式。** 后台检查静默进行，有结果只在导航上点一枚朱砂圆点——不弹窗、不 toast、不闪烁。角标加载失败当没发生，绝不阻塞渲染。
2. **反馈引导行动。** 失败项显示「标题 · 下一步」的人话指引；提示/告警可点击，点开即见详情与可执行动作。只罗列问题、不给下一步的界面是失败设计。
3. **说结果，不说过程。** 异步任务返回即已结束，提示「已完成 N 项」而非「已提交」。
4. **信息态与警示态分离。** 功能性提示用青瓷/灰边小标，不用警告色吓用户；warn 才用朱砂。
5. **补充信息不是主角。** 次要属性标 11px 弱化处理，仅在非默认状态出现。
6. **就地展开优于浮层。** 长文本默认两行截断 + hover 原地展开；不用 tooltip（圆角裁剪吞浮层的实录教训）。
7. **布局不漂移。** sticky 组头钉到滚动容器真正顶边（顶部留白放进 `.fade-in`）；列表行动作与行首对齐，不随展开明细数上下漂移。
8. **批量操作不重排内容。** 底部浮动批量条，选中后列表纹丝不动，单击/双击语义不串位。
9. **渐进式渲染。** 大列表首屏限量 + 「加载更多」，弹层列表限高滚动贴尾。
10. **跨会话记忆界面状态。** 排序、分组展开集、列宽等用户调过的东西全部持久化，下次还在。
11. **一次性参数用完即清。** 跨页带入的筛选参数消费后立即清除，避免刷新时把用户手动改的状态拽回去。
12. **次要操作悬停浮现。** 卡片操作条默认隐藏，hover 才出；操作密度让位内容密度。

---

## 10. 移植指南

### 10.1 最小可用集（半小时落地）

1. 拷贝 §3 Token（CSS 变量）+ 纸张噪点 + §8 动效与滚动条到全局 CSS。
2. 拷贝 §4 主题 token 接入组件库 `ConfigProvider`（换组件库则重写映射，其余不变）。
3. 拷贝刊头 / 页面容器 / surface / 徽章 / 主行动按钮 / 空状态六个基元。
4. 字体栈原样保留（思源宋体系 + 苹方/雅黑体系，全平台免安装可用）。

### 10.2 渐进引入顺序

**Token → 布局骨架（刊头 + 页面容器）→ surface/卡片 → 徽章与 chip → 表单与设置体系 → 长文阅读视图。** 每一层独立可用，按需取用；§9 行为准则随功能逐渐落地，不要求一次到位。

### 10.3 换肤自由度

整套系统只依赖「纸×3 + 墨×3 + 主色×3(wash) + 语义色×2~3(wash) + 线×2 + 阴影×1」约 15 个变量。换主色 = 改朱砂三兄弟 + 组件库 token 三处；换风格（冷色纸、深色模式）= 重定义变量表，组件层零改动。**深色模式注意**：本系统为暖浅色设计，墨色/纸色语义需整套反转，勿单点替换。

### 10.4 适用范围

适合内容型、工具型、阅读型应用。若目标产品是强数据密度的后台系统（大量表格、密集表单），本系统的留白与衬线会显得奢侈——可保留 token 与行为准则，收敛排版尺度（缩小留白、减少衬线使用面）。

---

## 附录 A：组件速查表

| 语义组件 | 参考实现 class | 章节 |
|---|---|---|
| 容器基元 | `.surface` | 7.1 |
| 媒体卡片 | `.article-card` | 7.2 |
| 状态徽章 | `.badge-ok / -skip / -fail / -cancel` | 7.3 |
| 弱化属性标 | `.kind-tag`（`.warn` / `.info`） | 7.3 |
| chip 选择器 | `.fmt-chip` / `.tb-toggle` | 7.4 |
| 主行动按钮 | `.cta` | 7.5 |
| 进度 | `.progress` | 7.6 |
| 批量操作条 | `.selbar` | 7.7 |
| 空状态 | `.empty-state` | 7.8 |
| 分组头 | `.ghead` / `.gseal` | 7.9 |
| 表单行 | `.settings-row` | 7.10 |
| 提示条 | `.settings-callout` / `.settings-test-result` / `.fail-hint` | 7.11 |

## 附录 B：参考实现落地索引（wx-kit）

本文档描述的这套系统在 wx-kit 中的实际落地位置，供查证与拷贝。**以下属于实现细节，不属于设计系统定义。**

| 文件 | 内容 |
|---|---|
| `src/renderer/index.css` | 全部 token + 组件样式（单一真相源） |
| `src/renderer/theme.ts` | 组件库 token 镜像 |
| `src/renderer/layouts/MainLayout.tsx` | 刊头 + 导航 + 圆点通知模式 |
| `src/renderer/components/SettingsGroup.tsx` | 分组/表单行组件封装 |
| `src/renderer/components/ArticleCard.tsx` | 媒体卡片完整实现（含行动反馈模式） |
