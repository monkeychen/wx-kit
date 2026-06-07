# M4 设计：electron-builder 打包（mac + win，未签名）

> 状态：已与安哥对齐（2026-06-07）。本文件是设计依据；实现步骤由 writing-plans 产出到 `docs/plans/`。
> 前置：M1–M3.5 已合入 main，功能齐活（URL 下载 / 批量爬取 / 书架阅读 / CLI）。

## 1. 目标与范围

把 wx-kit 打成 macOS 与 Windows 可分发安装包，本地一台 mac 上构建。**未签名**（开箱即用、不加门槛，贴第一阶段定位）。

**三大决策（安哥确认）：**
- **未签名本地包**：mac `.dmg` + win `.exe(nsis)`，首次打开有系统警告，靠 README 写清放行步骤。
- **本地一并出 mac+win**：electron-builder 在 mac 上同时构建两端；若 win-from-mac 在本机翻车，退回加 CI workflow 出 win。
- **品牌占位图标**：自绘「百宝箱/潘多拉宝盒」图形，非汉字。

## 2. 构建配置（package.json `build` 块）

在现有 `build`（appId/productName/output/files）基础上补：

- `mac`: `target: dmg`，`arch: [arm64, x64]`（两个 dmg，覆盖 Apple Silicon 与 Intel）；`category: public.app-category.productivity`。
- `win`: `target: nsis`，`arch: x64`。
- `nsis`: `oneClick: false`（让用户选安装位置）、`allowToChangeInstallationDirectory: true`。
- `icon: build/icon.png`（electron-builder 从 1024 png 自动生成 mac `.icns` / win `.ico`）。
- 产物入 `release/`（已 gitignore，不入库）；asar 默认开。
- `files` 维持 `dist-electron/**` + `dist/**`；生产依赖由 electron-builder 默认带（见 §5）。

## 3. 图标（百宝箱 / 潘多拉宝盒）

- **概念**：朱砂（#b5462f）圆角方块底，居中一只宝盒——暖金/暖白箱体、拱形盖、正面小锁扣；盖微开、内透暖光 + 几点星火上扬（呼应"潘多拉宝盒"开启、百宝涌出）。扁平、暖色编辑风，32px 下剪影清晰。
- **产出方式**：写成自包含 SVG/HTML → 用 playwright（已装）headless 渲染 1024×1024 → 截图存 `build/icon.png`，**提交入库**（保证构建可复现）。生成脚本一次性、用完删。
- **签收**：实现阶段先渲染、截图给安哥过目，可迭代（箱体造型/配色/开合/星火），满意后再接进 `build.icon`。

## 4. 脚本（package.json）

- 修 `build`：现有 `tsc -b && vite build && electron-builder` 的 `tsc -b` 未配 project references，会挂。类型检查独立走 `npx tsc --noEmit -p tsconfig.json`；打包脚本不含 `tsc -b`。
- 新增：
  - `package:mac`: `vite build && electron-builder --mac`
  - `package:win`: `vite build && electron-builder --win`
  - `package`: `vite build && electron-builder --mac --win`

## 5. 打包正确性（关键风险）

既定陷阱：**undici 必须 external 且永不加载**（`vite.config.ts`；cheerio 的 sqlite-cache-store 静态 `require('node:sqlite')` 在 Electron 31 没有该内置模块）。

- vite 把 cheerio/axios 等打进 `dist-electron/main.js`，仅 undici external（惰性 require，运行时永不触达——我们只用 `cheerio.load`）。
- electron-builder 默认把生产依赖打进 asar，undici（cheerio 的传递依赖）会随之入包，故惰性 require 即便被求值也能解析到、但实际不会进启动路径。
- **验证靠真实启动**：打出 mac 包后启动打包的 `.app`，确认主进程不崩、窗口能开（§7）。这是唯一可靠的打包正确性判据。

## 6. 分发文档（README）

README 加「下载与安装」一节，写清未签名包的放行步骤（反馈引导行动，不让用户对着报错发懵）：
- **macOS**：首次打开若提示「无法验证开发者」→ 右键应用→打开，或终端 `xattr -cr /Applications/wx-kit.app`。
- **Windows**：SmartScreen 提示→「更多信息」→「仍要运行」。
- 注明当前为未签名构建、来源可信即可放行。

## 7. 验证

打包无可测纯逻辑，验证走"构建成功 + 真实启动"：

- **mac（可自动化）**：`package:mac` 出 dmg 与 `release/mac*/wx-kit.app`；用 playwright 启动**打包后的** `.app`（`executablePath` 指向包内 Electron），断言窗口渲染、无主进程崩溃。这覆盖 §5 的 undici 打包风险。
- **win**：`package:win` 出 `.exe`；mac 上无法运行，验证到「electron-builder 构建成功 + 产物文件存在」。
- **CI 兜底**：若 win-from-mac 在本机构建失败（wine/图标转换等），加 `.github/workflows/build.yml`（windows runner 出 win），作为 §1 既定的退路；本地仍出 mac。

## 8. 非目标（YAGNI）

- 代码签名 / 公证（已定未签名）。
- 自动更新（electron-updater）。
- Linux 包。
- 应用内「关于/版本」页（版本号已在 package.json，本里程碑不加 UI）。
