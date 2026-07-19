# M26 · 安装通道:brew tap + npm 包（v0.6.0 R4）

> 需求/验收见 `docs/PRD-v0.6.0.md` R4。分支 `feat/m26-install-channels`。

## 现状核实(2026-07-19)

- npm 包名 `wx-kit` 未被占用(registry 404);**本机 npm 未登录**——publish 前需安哥 `npm login`(一次性)。
- gh token 有 `repo` scope,可建 `monkeychen/homebrew-wx-kit` tap 仓库;本机 Homebrew 5.1.15。

## 1. brew tap(cask 指向 GitHub Release dmg)

- 新建仓库 `monkeychen/homebrew-wx-kit`,`Casks/wx-kit.rb`:
  - `version`/`sha256`(arm64 与 intel 双 on_arch)、`url` 指 Release dmg、`app "wx-kit.app"`;
  - caveats 提示未签名与 `--no-quarantine` 用法。
- 本仓库 `scripts/update-brew-tap.sh`:入参版本号,取 `release/*.dmg` 算 sha256,渲染 cask 模板,commit+push 到 tap 仓库(gh 直连规约)。
- 安装命令:`brew install --cask --no-quarantine monkeychen/wx-kit/wx-kit`。

## 2. npm 包(全局装 CLI)

- 思路:npm 包内含**构建产物**(`dist/`、`dist-electron/`)+ `bin/wx-kit.js` 启动脚本(`#!/usr/bin/env node`,spawn `electron` 主入口透传 argv 与 stdio);electron 为 dependencies(用户侧 npm 装,国内镜像引导写 README/postinstall 提示,不强制)。
- `package.json`:加 `bin`、`files`(dist, dist-electron, bin;**排除源码/release/docs**);`prepublishOnly` 跑 build。
- mac/Linux 支持;win 不承诺(GUI 子系统 stdout 老问题,README 注明)。
- 发布:`npm publish`(需登录;发版规约步骤化)。

## 3. 发版规约扩展(AGENTS.md)

发版步骤追加:⑦ 跑 `scripts/update-brew-tap.sh <version>` 刷 tap;⑧ `npm publish`;两者都要真实安装验证(brew 全新装 + `npm i -g` 全新装,各跑 `--version` + `download`)。

## 4. 验证

- brew:本机 `brew install --cask --no-quarantine monkeychen/wx-kit/wx-kit` 全新装 → `wx-kit --version`/`download` 可用 → `brew uninstall` 清理。
- npm:`npm pack` 出 tarball → 全局装 tarball(免登录先验)→ 同上验证 → 卸载;正式 publish 待发版时(需安哥登录 npm)。
- e2e/单测全量回归(bin 脚本纯增量,不影响现有)。
