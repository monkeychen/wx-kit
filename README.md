# wx-kit · 微信百宝箱

把微信公众号文章下载为多种格式（封面 / Markdown / 网页 / PDF / 元信息）并在应用内浏览；支持按公众号批量爬取；同一二进制带 CLI，供 AI agent 调用。单进程 Electron，GUI 与 CLI 双启动模式。

## 下载与安装

当前为**未签名**构建，首次打开需手动放行（应用本身可信）：

- **macOS**：打开 `.dmg` 拖入「应用程序」。首次启动若提示「无法验证开发者」→ 右键应用→「打开」→ 再次「打开」；或终端执行 `xattr -cr /Applications/wx-kit.app` 后再开。
- **Windows**：运行 `wx-kit Setup *.exe`。SmartScreen 提示→「更多信息」→「仍要运行」。

## 开发

见 `AGENTS.md`（项目权威指南）与 `ROADMAP.md`（进度）。常用命令：

```bash
npm install
npm run dev          # GUI 开发模式
npm test             # 单测
npm run typecheck    # 类型检查
npm run package:mac  # 打 mac 安装包（release/）
npm run package:win  # 打 win 安装包
```
