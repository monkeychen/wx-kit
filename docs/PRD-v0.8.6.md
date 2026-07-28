# wx-kit v0.8.6 产品需求文档(迭代 PRD)

> **状态:需求收集中**(2026-07-28 起,安哥逐条报)。收齐并确认后再拆里程碑、写实现计划。
> 已收:R1、R2。

## 1. 一句话定义

(待收齐后补)

## 2. 需求清单

### R1 · 可点的东西要看起来可点:链接缺手型光标(2026-07-28 安哥)

**原始现象**:订阅页「发现新文章时:仅提示 ⚙ … 📄 打开检查日志」这一行里的两个链接
(打开设置、打开检查日志),**鼠标移上去没有变成手型**。

**核实结论(2026-07-28 读代码 + 查 antd 实现)**:属实,但根因不在这两个链接。

- **全库没有 `a { cursor: pointer }`**,只有 `.selbar a` 一处局部声明(`index.css:427`)。
- 浏览器**只给 `a[href]` 手型**,而本项目的链接一律是 `<a onClick>` 无 href
  (刻意的:渲染层不做页面跳转,点击走 IPC 或 `openExternal`)。
- 那为什么别处看着正常?**antd 把 `cursor: pointer` 按组件作用域注入**
  (`theme/util/genStyleUtils.js` 的 `getResetStyles` → `genLinkStyle`),
  所以落在 `.ant-list` / `.ant-tooltip` 里的 `<a>` 顺带拿到了手型。

逐一核过全部 15 处 `<a onClick>`,**实际受影响的只有安哥指出的这 2 处**:

| 位置 | 有手型 | 原因 |
|---|---|---|
| `Subscriptions.tsx:241` 策略行的 ⚙ | ❌ | 在我们自己的 `<div>` 里 |
| `Subscriptions.tsx:247` 打开检查日志 | ❌ | 同上 |
| 行内动作 / 待处理标题 / 检查记录 / 候选号「订阅」 | ✅ | 在 antd `List` 作用域内 |
| 文库批量栏(全选/清除/导出/同步) | ✅ | `.selbar a` 有局部声明 |
| 站点同步 Tooltip 里的仓库链接 | ✅ | 在 `.ant-tooltip` 作用域内 |

**所以真正的问题是:一个链接有没有手型,取决于它的祖先恰好是不是 antd 组件——这是偶然,不是设计。**
只补这两处等于把同一个坑留给下一个写在 antd 组件外面的链接。

**方案**:

- **在 `index.css` 加一条全局规则**,让"可点的 `<a>`"自己就有手型,不再依赖祖先是谁。
  同时删掉 `.selbar a` 里冗余的 `cursor: pointer`(它现在是全局兜住的,留着会让人以为局部必须声明)。
- **顺带核一遍其它可点元素**:凡是靠 `onClick` 而不是 `<button>` 实现的(卡片、分组头、表头排序等),
  确认都已有 `cursor: pointer`——上面查到的几处 `.ghead`/`.article-card`/`.lrow`/`.lh-sort` 都有,
  但**这次要把"检查清单"落成可回归的东西**,而不是又一次目视扫过。
- **不改成 `<button>`**:这些是"看着像链接、行为是动作"的元素,antd 的 List actions 也期望 `<a>`;
  为了语义纯度整体重构与本需求收益不成比例(真要做是独立的一次可访问性专项)。

**验收(草)**:

- [ ] 策略行的 ⚙ 与「打开检查日志」hover 时是手型。
- [ ] 修法是**全局规则**而不是给这两处各加一行 style
      ——下一个写在 antd 组件外的链接不该再踩一次。
- [ ] `.selbar a` 的冗余 `cursor` 已删,行为不变(文库批量栏仍是手型)。
- [ ] **e2e 断言 computed style**:至少覆盖「antd 作用域外的链接」这一类
      (`getComputedStyle(el).cursor === 'pointer'`)。目视验证会随改版失效,断言不会。
- [ ] 阅读器正文里的真链接(`.prose a`,有 href)行为不回归。

### R2 · GitHub 又报了一批安全告警(2026-07-28 安哥)

**核实结论(2026-07-28,`gh api .../dependabot/alerts`)**:**23 条 open,涉及 7 个包,全部有补丁**。

先说一个操作层的坑:**`npm audit` 在国内镜像下不可用**
(`registry.npmmirror.com` 返回 `[NOT_IMPLEMENTED] /-/npm/v1/security/*`),
所以本项目的安全事实来源是 **GitHub Dependabot**(或显式 `--registry=https://registry.npmjs.org` 跑 audit)。
别因为 `npm audit` 没报就以为干净。

| 包 | 条数 | 最高级别 | 补丁版本 | 作用域 | 够不够得着 |
|---|---|---|---|---|---|
| axios | 10 | medium | 1.18.0 | **运行时** | 选项解析的多项式耗时;**我们的 axios 选项是代码里的常量**,不由外部输入构造 |
| react-router | 5 | high | 见下 | **运行时** | 见下 |
| brace-expansion | 3 | high | 2.1.2 | 开发 | 只在构建/测试链路 |
| fast-uri | 2 | high | 3.1.4 | 开发 | 同上 |
| js-yaml / postcss / tar | 各 1 | high/medium | 4.3.0 / 8.5.18 / 7.5.18 | 开发 | 同上 |

**react-router 这 5 条要分开看**(当前 7.17.0):

- **4 条补丁是 `7.18.0`**——同大版本内的小版本升级,**照升**(开放重定向、反序列化注入、协议校验、DoS)。
- **剩下 1 条(RSC Mode CSRF Bypass)补丁是 `8.3.0`**,即**大版本升级**。
  但本项目**用不到那条代码路径**:渲染层是 Electron 里的 `HashRouter`(`main.tsx:13`),
  **没有服务端、没有 RSC、没有 server action**。为一条够不着的告警吃一次 major 升级,
  收益与风险不成比例。

**方案(倾向,安哥可推翻)**:

- **能靠小版本/补丁版升的全升**:`axios` 1.17→1.18、`react-router-dom` 7.17→7.18,
  开发依赖的那 5 个包靠更新其父级(vite / vitest / electron-builder)或 `npm update` 收敛。
- **RSC 那条不升 major,改为在 GitHub 上 dismiss 并写明理由**(「本项目不使用 RSC 模式」)。
  **dismiss 不是掩盖**:留下判断依据,比装作没看见或盲目 major 升级都诚实。
  ——若日后真引入 RSC/服务端渲染,这条要重新评估。
- **依赖升级必须真验**:v0.2.1 的教训是依赖升级的风险在打包与运行时,不在单测。
  升完要 `npm test` + `lint` + `tsc` + e2e + **真实启动打包后的 .app**(undici external 那条不变量)。

**验收(草)**:

- [ ] Dependabot open 告警从 23 降到 **仅剩那条 RSC(且已 dismiss 并写明理由)**,
      核实方式是重新 `gh api .../dependabot/alerts` 数一遍,**不靠「应该修好了」**。
- [ ] `axios` / `react-router-dom` 升级后功能不回归:下载单篇、按公众号抓取、订阅检查、页面路由跳转。
- [ ] 打包后的 .app 真实启动 + 跑一条 CLI(undici external 仍站得住)。
- [ ] 把「`npm audit` 在国内镜像下不可用」写进 AGENTS.md 的陷阱清单
      ——这条不写下来,下次还会有人拿 `npm audit` 的沉默当安全。

## 3. 里程碑拆分

(待收齐后补)

## 4. 非目标

- (待收齐后补)
