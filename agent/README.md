# agent/ — wx-kit 的 agent 集成

本目录放**消费 wx-kit 的 Claude Code skill**，与应用代码物理隔离。skill 只经 wx-kit 的 **CLI / 导出文件**取数据，绝不 import 应用代码——换任何 agent 都按同一契约接入。这是 v0.4.0「文库供料 agent」的参考实现。

## 内含

- `wx-kit-skill/` —— **wx-kit 能力说明书 skill**：安装（brew/npm 自动检测）、按 URL 下载、本地文库、素材导出、站点同步，以及已停用命令的兼容边界。agent 从零上手 wx-kit 看这个。
  **它是 CLI 契约的唯一真相**——参数、输出结构、错误码只在这里维护，随每次 CLI 变更同步。
- `wx-kit-compose/` —— 素材创作编排 skill：走「取料 → 选题 → 写作」（带两个人工检查点），定稿后可选发到个人站点；写作委派给 `khazix-writer`。
  取料的起点可以是**已下载的文库**、GUI 导出的素材清单，也可以是用户给出 URL 后新下载的文章。
  **它刻意不复述 CLI 参数**，只说「哪一步用哪个能力」——抄来的命令细节不会跟着源头变，这正是它曾落后二十个里程碑的原因。

## 安装

用 skill-kit（软链接安装）把 `wx-kit-compose` 装进你的 agent：

```
/skill-kit            # 交互选择：安装 → 选本目录的 wx-kit-compose → 选目标 agent
```

依赖的写作 skill `khazix-writer` 需已安装（它承载笔调）；研究 skill `hv-analysis` 可选（仅旁路深研用）。

## 供料契约

素材有两个入口，对应“已经下过”与“用户已经给出 URL”：

| 入口 | 命令 | 什么时候用 |
|---|---|---|
| 已下载的文库 | `library export` / `library search` / `library list` | 素材已在本地 |
| 用户给出 URL | `download --url <URL>` → `library export --ids <id>` | 先下载，再取得稳定的正文路径 |

按公众号搜索、历史抓取和订阅依赖微信私有后台，已经停用。用户没有提供文章 URL 时，应说明边界并请求链接，
不要尝试 `search`、`crawl`、`subscription`、`login` 或 `session`。

### `library export` 的清单格式

输出 stdout 纯 JSON 清单（**正文不内联**，给 `content.md` 绝对路径）：

```json
{ "ok": true, "count": 2,
  "articles": [
    { "id": "...", "title": "...", "account": "...", "author": "...",
      "publishTime": "...", "sourceUrl": "...",
      "dir": "/abs/article/dir", "contentPath": "/abs/article/dir/content.md" } ] }
```

选料器（可组合，交集语义）：`--ids a,b,c` / `--since YYYY-MM-DD`（按 `downloadTime`）/ `--account <公众号名>`（昵称包含匹配，注：无 fakeid）/ `--all`（无选料器时必须显式给，否则报 `NO_SELECTOR` 退出 1）。`--out <库根>` 指定文库目录（默认 `~/Documents/wx-kit`）。

### 两个影响「素材能不能用」的字段

每篇的 `meta.json` 里（`library list` 的输出同源）：

- **`itemShowType`** —— 消息类型：`0` 图文 / `5` 视频消息 / `8` 图片消息 / `10` 文字消息。
  **视频与文字消息没有长正文**，正文往往只是一段几十字的描述；当写作素材时价值与图文完全不同。
- **`warnings`** —— 解析告警（遇到没适配的新消息类型、正文疑似脚本等）。
  「下到了但可能不对」的唯一信号，读正文前值得扫一眼。

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

## 下游：发到个人站点（可选）

`site sync --ids <id> --slug <slug>` 把文库文章按 Astro 站点规范生成到 `content/posts/<日期>-<slug>/`（纯本地，不联网；需先配 `siteSyncPostsDir`）。
**compose 默认不做这一步**——发布是不可逆的对外动作，要用户明确要求。

## 设计边界（v0.4.0 既定）

wx-kit 只**供料**，不内置创作模块；选题/写作/审阅的编排活在这些外部 skill 里，人在环中。需求见 `docs/PRD-v0.4.0.md` §R3，设计见 `docs/superpowers/specs/2026-06-22-v0.4.0-agent-feed-and-storage-design.md`「M15」节。
