# wx-kit v0.8.1 产品需求文档(补丁版)

> **状态:已实现,待发版**(2026-07-22)。
> 起因:v0.8.0 宣称修复的 R5(mac CLI 堆程序坞图标)**实际没修好**,安哥用正式版跑 `wx-kit -h` 当场复现。
> 本版是 hotfix + 一条小改动。

## 1. 一句话定义

**把 v0.8.0 没真正修好的 dock 图标补上**(换到 plist 层解决),顺带在设置页「站点同步」加一个 hover 提示,指向个人站点的开源源码。

## 2. 需求清单

### R1 · 真正修掉 mac CLI 的程序坞图标(bug 回归,2026-07-22 安哥)

**现象复现**:装 v0.8.0 正式版后跑 `wx-kit -h`,程序坞仍冒图标,跑 N 次出现 N 个。

**v0.8.0 的修法为什么无效**(回源实测):

在 `wx-kit -h` 执行期间高频采样进程的 macOS 激活策略(`lsappinfo info -only ApplicationType`),状态序列是:

```
NULL(×3) → Foreground(×4) → UIElement(×1) → 退出
```

- `app.dock.hide()` 放在 `app.whenReady()` **之前调用并不生效**——dock API 要等 app ready 才被应用。
- 而 **AppKit 在 ready 之前就已把进程注册成 `Foreground` 并画出了 dock 图标**。
- 所以 v0.8.0 的效果是「图标先出现、随后才被隐藏」。命令跑得越短,图标可见时间占比越大;`-h` 这种一秒内结束的命令几乎全程可见,连跑多次即视觉上堆叠。

**为什么 v0.8.0 的验证没抓到**(方法论缺陷,已记入 devlog):

验证时用的是跑 2–3 秒的 `download`,且第一次采样前先 `delay 2`——**正好跳过启动瞬间的 `Foreground` 窗口期,只采到了稳态的 `UIElement`**,得出「已修复」的假阴性结论。**采样验证必须覆盖启动瞬间;且该拿最极端用例(最短命的命令)测,而不是最顺手的那个。**

**修复方案(plist 层,唯一能覆盖「JS 执行前」的手段)**:

- `package.json` 的 `build.mac.extendInfo` 加 **`LSUIElement: true`**——由 Launch Services 在进程启动时就定为 accessory,**不给图标出现的机会**;任何 JS 层调用都晚于图标绘制,治不了根。
- GUI 分支在 `whenReady()` 后 `app.dock.show()` 把图标要回来;accessory 应用的窗口不会自动抢焦点,故一并 `app.focus({ steal: true })`。
- CLI 分支不再需要 `app.dock.hide()`(已删,注释留下「为什么它不管用」)。
- **只能在打包态验证**:dev 模式(`npx electron .`)走的是 Electron.app 自己的 Info.plist,改动不生效。

**验收**:

- [x] 打包 app 跑 `wx-kit -h`,全程采样 **40/40 为 NULL**,从未出现 `Foreground`(即从未注册为 dock 应用)。
- [x] 打包 app 跑 `wx-kit download`,采样为 `NULL → UIElement`,**无 `Foreground`**。
- [x] GUI 无参启动:`ApplicationType=Foreground`(程序坞图标正常)、`frontmost=wx-kit`(窗口正常到前台)、窗口数 1。
- [x] win/linux 不受影响:`LSUIElement` 是 mac Info.plist 专有键,其他平台的打包配置不含该项;`app.dock` 在非 mac 为 undefined,`dock.show()` 走存在性判定。

### R2 · 设置页「站点同步」加建站指引(2026-07-22 安哥)

**原始需求**:如果刚好有用户也想建个人站,可以参考另一个开源项目 `monkeychen/dreamble`,其 `site` 子目录就是个人建站及日常发文的源码。**不要写一大段常驻文案**,给个「?」之类的图标,hover 才显示。

**方案**:

- 「站点同步」标题右侧加 `?` 图标(`opacity: 0.5`、`cursor: help`,不抢视线),hover 出 Tooltip。
- 文案组织:**去掉「如果你想建站…」的条件句——`?` 图标本身就是那个条件**,愿意 hover 的人就是想知道的人。只说三件事:同步目标是什么、源码在哪、能拿到什么:
  > 同步目标是一个 Astro 静态站。我的开源项目 **dreamble** 的 `site/` 子目录就是这个站点的完整源码——主题、发文规范、构建脚本都在里面,想自建个人站可直接取用。
- Tooltip 内含可点链接 `github.com/monkeychen/dreamble`,走 `openExternal` 开系统浏览器。
- `maxWidth: 360` + `placement="right"`(默认宽度会把文案挤成 6 行)。

**验收**:

- [x] 设置页「站点同步」标题旁有 `?` 图标;hover 出提示,含 dreamble 仓库信息与链接。
- [x] 提示不常驻——不 hover 时页面只有原有说明,视觉无新增噪音。
- [x] e2e 覆盖:图标存在 + hover 后 tooltip 文案含 `dreamble`(全套 e2e 全绿、控制台 0 错误)。

## 3. 里程碑拆分

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M33** | R1 dock 图标真修复(LSUIElement)+ R2 站点同步 hover 指引 | ✅ 2026-07-22 |

## 4. 非目标

- **GUI 启动时图标出现时机的优化**——LSUIElement 下图标由 `dock.show()` 在 ready 后要回,比之前晚几百毫秒;实测无感,不做额外处理。
- **为 dock 行为加自动化测试**——启动分流在 app 生命周期里跑,单测构造不出;靠打包态真机采样验证(本版已建立可复用的采样方法:`lsappinfo info -only ApplicationType <pid>`)。
