# agent/ — wx-kit 的 agent 集成

本目录放**消费 wx-kit 的能力说明书 Skill**，与应用代码物理隔离。Skill 只经 wx-kit 的 **CLI / 导出文件**取数据，绝不 import 应用代码——换任何 agent 都按同一契约接入。

## 内含

- `wx-kit-skill/` —— **wx-kit 能力说明书 Skill**：安装（brew/npm 自动检测）、按 URL 下载、公众号订阅（微信读书后端）、本地文库、素材导出、站点同步，以及 v0.12.0 当前 main 未发布的 BYOK 选题 GUI/CLI。agent 从零上手 wx-kit 看这个。
  **它是 CLI 契约的唯一真相**——参数、输出结构、错误码只在这里维护，随每次 CLI 变更同步。

## 安装

将 `wx-kit-skill/` 安装或链接到所用 agent 的 Skill 目录。使用目录中的 `SKILL.md` 作为入口；具体安装机制按对应 agent 的文档操作。

本目录不提供创作编排安装项，也不要求安装任何写作或研究 Skill。选题能力的研发状态见根目录 ROADMAP，不能从设计稿推断已有可用命令。

## 供料契约

素材有两个入口，对应“已经下过”与“用户已经给出 URL”：

| 入口 | 命令 | 什么时候用 |
|---|---|---|
| 已下载的文库 | `library export` / `library search` / `library list` | 素材已在本地 |
| 用户给出 URL | `download --url <URL>` → `library export --ids <id>` | 先下载，再取得稳定的正文路径 |

公众号订阅在 v0.10.0 已通过**微信读书后端**复活。用户没有提供文章 URL 时，可引导其先 `wx-kit login`，
再用 `search --url <该号任意一篇文章链接>` 识别公众号，然后 `subscription` 订阅/检查——不必强求单个文章 URL。
（按公众号批量下载 `crawl` 已停用：列表接口被服务端按账号封禁；要某号最新一篇用 `subscription check-now`。）
（微信读书无按名字搜索接口，识别入口是「该号任意一篇文章链接」，不是公众号名称。）

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
仅在用户要求同步到所配置站点目录时调用。此命令生成本地内容，不代替站点预览、远端部署或对外发布。

## 当前能力与产品化方向

已发布的 CLI 继续负责下载、文库、订阅、素材导出和本地站点内容同步。产品化方向增加“素材到可解释选题简报”，共享核心能力和验收规则；详细设计见 [选题决策器设计](../docs/superpowers/specs/2026-09-20-topic-decisions-design.md)。新入口实际可用以前，本 Skill 不承诺自动选题或写作。

历史上的创作编排参考实现已经退场，原有 PRD、发布说明与复盘保留。素材导出不依赖它，用户仍可把导出的正文交给自己选择的创作工具。
