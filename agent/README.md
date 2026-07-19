# agent/ — wx-kit 的 agent 集成

本目录放**消费 wx-kit 的 Claude Code skill**，与应用代码物理隔离。skill 只经 wx-kit 的 **CLI / 导出文件**取数据，绝不 import 应用代码——换任何 agent 都按同一契约接入。这是 v0.4.0「文库供料 agent」的参考实现。

## 内含

- `wx-kit-skill/` —— **wx-kit 能力说明书 skill**（v0.6.0）：安装（brew/npm 自动检测）、登录态（含 headless 的 session 迁移）、全部 CLI 原子能力速查与组合范例。agent 从零上手 wx-kit 看这个。
- `wx-kit-compose/` —— 文库素材创作编排 skill：用文库文章作素材，走「选料 → 选题 → 写作」（带人工检查点），写作委派给 `khazix-writer`。环境/安装前置问题参见 `wx-kit-skill`。详见其 `SKILL.md`。

## 安装

用 skill-kit（软链接安装）把 `wx-kit-compose` 装进你的 agent：

```
/skill-kit            # 交互选择：安装 → 选本目录的 wx-kit-compose → 选目标 agent
```

依赖的写作 skill `khazix-writer` 需已安装（它承载笔调）；研究 skill `hv-analysis` 可选（仅旁路深研用）。

## 供料契约（wx-kit `library export`）

输出 stdout 纯 JSON 清单（**正文不内联**，给 `content.md` 绝对路径）：

```json
{ "ok": true, "count": 2,
  "articles": [
    { "id": "...", "title": "...", "account": "...", "author": "...",
      "publishTime": "...", "sourceUrl": "...",
      "dir": "/abs/article/dir", "contentPath": "/abs/article/dir/content.md" } ] }
```

选料器（可组合，交集语义）：`--ids a,b,c` / `--since YYYY-MM-DD`（按 `downloadTime`）/ `--account <公众号名>`（昵称包含匹配，注：无 fakeid）/ `--all`（无选料器时必须显式给，否则报 `NO_SELECTOR` 退出 1）。`--out <库根>` 指定文库目录（默认 `~/Documents/wx-kit`）。

### 怎么跑这条 CLI

同一二进制带子命令即进 CLI 模式（见根 `CLAUDE.md`「模式分流」）：

- **开发/仓库内**（已 `npm run build` 出过 `dist-electron/`）：
  ```bash
  npx electron . library export --account "刘备教授" --out ~/Documents/wx-kit
  ```
- **macOS 安装包**（别用 `open -a`，拿不到 stdout）：
  ```bash
  /Applications/wx-kit.app/Contents/MacOS/wx-kit library export --since 2026-06-22 --out ~/Documents/wx-kit
  ```
- **Windows 安装包**：Electron 是 GUI 子系统程序，**stdout 不回贴控制台**，必须重定向到文件，管道取 stdout 不可靠：
  ```
  "%LOCALAPPDATA%\Programs\wx-kit\wx-kit.exe" library export --ids a,b --out "%USERPROFILE%\Documents\wx-kit" > out.json
  ```
  （agent 集成优先 mac/Linux。）

## 不走 CLI 也行：GUI 导出

文库页多选文章 →「导出为素材」→ 写出 `<库根>/exports/<时间戳>.json`（同上清单格式）。skill 读最新那个文件即可，无需跑 CLI。

## 设计边界（v0.4.0 既定）

wx-kit 只**供料**，不内置创作模块；选题/写作/审阅的编排活在这些外部 skill 里，人在环中。需求见 `docs/PRD-v0.4.0.md` §R3，设计见 `docs/superpowers/specs/2026-06-22-v0.4.0-agent-feed-and-storage-design.md`「M15」节。
