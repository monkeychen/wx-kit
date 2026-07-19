# M28 · wx-kit 使用 skill（v0.6.0 R6）

> 需求/验收见 `docs/PRD-v0.6.0.md` R6。分支 `feat/m28-agent-skill`。纯文档交付(skill),无代码改动。

## 交付物

```
agent/wx-kit-skill/
├── SKILL.md               # 触发场景 / 环境检测→安装 / 登录态处理 / 能力速查 / 输出契约与频控
└── references/
    ├── commands.md        # 逐命令参数与 JSON 输出结构(从 -h 与真实输出蒸馏)
    └── recipes.md         # 组合任务范例(检测→装→登→下载;关键词爬取→导出素材;订阅巡检)
```

## 要点

- SKILL.md 遵循渐进式展示:主文件一屏级,细节全进 references。
- 安装命令即 M26 成果(brew / npm + 国内镜像);登录态分场景:GUI 机 login、headless 走 M27 session import。
- 所有样例命令**逐条实测**(mac 真机),不写想象中的用法。
- `agent/README.md` 增加本 skill 条目;wx-kit-compose 的前置检查段引用本 skill(不重复内容)。
- 维护约束写进 AGENTS.md 工作流:CLI 命令/参数变更时同步刷新 `agent/wx-kit-skill/`。

## 验证

- 样例命令全部真机跑通(auth 类在已登录态验证)。
- 端到端脚本化演练(等价「全新 agent」路径):隔离 prefix npm 装 tarball → session import → download → library list 确认——四步全 CLI、零人工。
