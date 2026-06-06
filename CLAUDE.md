# wx-kit 项目约定

## 是什么
微信百宝箱桌面应用。第一阶段只做"文章下载器"。单进程 Electron，双启动模式：GUI 与 CLI。

## 结构约定
- `src/core/`：UI 无关核心层，被 GUI（IPC）与 CLI 共享。不得 import React/renderer。
- `electron/`：主进程，仅做模式分流与平台能力（窗口、printToPDF）。
- `src/cli/`：命令行入口，输出契约见 PRD §F4（stdout 纯 JSON，stderr 进度，退出码）。
- `src/renderer/`：React 界面（M2 起）。
- `tests/`：镜像 `src/core/` 的 vitest 单测；HTML 样本放 `tests/fixtures/`。

## 命名/格式
- 文件 kebab-case，类型 PascalCase，函数/变量 camelCase。
- 注释、commit message 用英文；与用户沟通用中文。

## 开发纪律
- 纯逻辑一律 TDD；依赖网络/Electron 的部分注入依赖 + 手动验证。
- 改完跑 `npm test` 与 `npm run lint`。
- 不为跑通而注释报错，找根因。密钥不进代码。

## 关键约束
- 微信后台接口有频控：批量抓取默认串行 + 随机延迟（见 PRD §9）。
- 文章库默认在用户文档目录下，可配置。
