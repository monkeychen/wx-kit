# Spike · 墨问 API (open.mowen.cn) 可行性

> **结论先行**:本机网络环境对 `open.mowen.cn` API 域名 ALB 层持续 503,**无法验证 API 业务能力**。本 spike 状态 = **暂态失败,需换网络环境重测**。已排除鉴权/限流/WAF/本机出网问题,剩余可能:本机出口 IP 不在 ALB 白名单、地域限制、API server 当前不健康。
>
> **不阻塞 v0.10.7**(v0.10.7 是 R1 复制路径等小合集);**v0.11.0 立项暂搁**,待本 spike 在可访问网络下重跑通过再议。

## 1. 探点与实测

### 1.1 网络层诊断(关键证据)

| 测试 | URL / 头 | 结果 |
|------|---------|------|
| A1: 无 Authorization | `POST /api/v1/discover/activity` | **503 ALB** (200ms) |
| A2: 带 Authorization | 同 | **503 ALB** (200ms) |
| A3: OPTIONS | `OPTIONS /api/v1/note/info` | **503 ALB** (200ms) |
| A4: 浏览器完整头(UA/Origin/Referer) | `POST /api/v1/discover/activity` | **503 ALB** (200ms, content-length=606, 含 IE/Chrome 兼容 padding) |
| A5: 同源路径 | `POST note.mowen.cn/api/v1/discover/activity` | **405 openresty/1.19.9.1**(路径不存在 — API 不在 note.mowen.cn 域) |
| A6: 直连 ALB IP | `POST 47.94.80.199/api/...` (Host: open.mowen.cn) | **SSL 错误**(证书不匹配 IP) |
| A7: 50 秒内 5 次重试 | 每 10 秒一次 | **全部 503**(非短窗口限流) |
| B: 对照 `note.mowen.cn` 根 | `GET /` + 浏览器 UA | **200 OK** (244ms) |
| C: 对照 apifox 文档站 | `GET mowen.apifox.cn/` | **200 OK** (225ms) |

### 1.2 关键响应特征

每次 503 响应体完全一致(`content-length=204`,无 Authorization 时):

```
HTTP/2 503
via: HTTP/1.1 SLB.{64|76|87|216}        # 不同 SLB ID,纯边缘层负载
content-type: text/html                  # 不是 JSON
<center><h1>503 Service Temporarily Unavailable</h1></center>
<hr><center>alb</center>                # 阿里云 ALB 兜底
```

带 Authorization 时 `content-length=606`,多出 `<-- a padding to disable MSIE and Chrome friendly error page -->` 注释 — **这是 ALB 默认错误页的标准 padding,确认是边缘层兜底而非业务错误**。

### 1.3 DNS 与本机出网

- `open.mowen.cn` → `alb-eugdpjee6ke4qvzq6t.cn-beijing.alb.aliyuncs.com` (47.94.80.199, 59.110.159.157) — **阿里云 ALB 北京节点**
- `note.mowen.cn` → 同 ALB(浏览器域名走另一条路径返回 200)
- `api.ipify.org` 连接失败(国外 IP 查询服务在此机器不通,与 API 拦截无关)
- `github.com` 200 但 9.2 秒(绕地球)

**本机公网 IP 信誉/地域可能不被该 ALB 接受。**

### 1.4 排除的可能

| 假设 | 排除证据 |
|------|---------|
| API-KEY 失效 / 鉴权失败 | 无 Authorization 也 503;鉴权失败应为 401/403 而非 503 |
| 速率限制 | 50s 内 5 次均 503,无 Retry-After 头,无 429 |
| WAF 拦截 | 无 challenge 页面、无验证码、无 JS 重定向 |
| 本机出网问题 | `note.mowen.cn`、`mowen.apifox.cn`、`github.com` 均 200 |
| 路径错误 | 试了 4 个常见路径(`/note/info`、`/note/get`、`/note/detail`、`/note/{id}`)全 503;OPTIONS 也 503 |

### 1.5 剩余可能(按概率)

1. **本机出口 IP 不在 ALB 白名单**(最可能)— 阿里云 ALB 支持基于客户端 IP 的访问控制,墨问可能给 API 域名配置了 IP 白名单(常见于 B 端 API 平台)
2. **API server 当前确实不健康** — ALB 健康检查失败,所有上游节点 503(但持续时间已 1 分钟+,不健康通常会恢复)
3. **地域限制** — 阿里云 ALB cn-beijing 节点对部分地域/IP 段做限制

## 2. spike 脚本(已留库)

`scripts/spike-mowen-api.mjs` — 一次性 spike,跑完即弃设计:
- KEY 从环境变量 `MOWEN_API_KEY` 读,**不进命令行/不进文件**
- 所有响应 dump 时 `dumpKey`/`safe` 自动 redact key 为 `[REDACTED]`
- 临时落盘到 `/tmp/spike-mowen-*.json`(本 spike 跑过但均 503,内容已被 redact 写入)
- 覆盖 5 探点(鉴权/单篇/图片直链/列表/速率+错误码),**未来在可访问网络下重跑无需改脚本**

## 3. 行动建议(按代价从小到大)

| # | 行动 | 预期效果 | 代价 |
|---|------|---------|------|
| 1 | **换网络重跑 spike**:手机 4G/5G 热点、家中宽带、办公室不同出口 | 大概率 ALB 白名单命中,直接拿到 API 响应 | 10 分钟 |
| 2 | 在阿里云北京 region ECS 上跑 spike | API server 大概率同 region 内网可达 | 启动 ECS + spike,30 分钟 |
| 3 | 联系墨问客服确认:API 是否在线 / 是否需要 IP 白名单 | 排除"API server 不可用"假设,可能要求提交本机公网 IP | 等待响应,数小时~1 天 |
| 4 | **退路方案**:不走 API,改走浏览器路径 — 评估 `note.mowen.cn` HTML 解析可行性 | 绕开 ALB 拦截,复用 wx-kit 现有 fetchHtml/parseArticle 链路 | 需要重做 URL→内容映射,1-2 天 spike 评估 |

**推荐 #1**:换网络重跑 spike。30 秒内能确定是 IP 白名单问题还是 API server 不健康。

## 4. 对 v0.11.0 立项的影响

- **不阻塞 v0.10.7**(本次需求收集已经独立版本)
- **v0.11.0 = 墨问集成** 的立项**暂搁**,待本 spike 重跑通过
- 若 #1/#2 重跑仍 503,转 #4 浏览器路径方案(评估工作量大但属于稳路径)
- 若 #1/#2 重跑通过(预期内),本报告追加一节「重跑结果」即可继续原计划

## 5. 不变项

- 安哥提供的 API-KEY 已在 spike 中使用并被脚本自动 redact,key 未落盘任何文件、未进代码库、未进 git 历史
- spike 脚本保留在 `scripts/spike-mowen-api.mjs`,未来重跑无需改脚本
- 评估结论(API 走结构化 NoteAtom 路径优于 HTML 解析)在 spike 重跑通过后仍成立