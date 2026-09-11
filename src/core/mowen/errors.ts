// src/core/mowen/errors.ts
// mocli 相关错误分类。失败必须保留失败类型（AGENTS.md 红线），不得降级为「成功但空」。

export class MocliNotFound extends Error {
  constructor(message?: string) {
    super(message ?? '未检测到 mocli，请先安装：npm install -g @mowenxd/cli（墨问官方 CLI），并运行 mocli auth init 完成认证')
    this.name = 'MocliNotFound'
  }
}

/** mocli 调用失败（鉴权/网络/参数/业务失败）。reason 透传 mocli 的 reason（VALIDATE/NOT_FOUND/...）。 */
export class MocliFailed extends Error {
  constructor(public readonly reason: string, msg: string) {
    super(`墨问请求失败（${reason}）：${msg}`)
    this.name = 'MocliFailed'
  }
}

/** note/show 判定的不可见笔记（付费墙 ASSET_NOT_FOUND / 私密 / 风控空标题）。
 *  失败保留失败类型（宪法红线）：调用方归 unavailable，不进 failed、不产出空文件。 */
export class MowenNoteUnavailable extends Error {
  constructor(message = '该笔记不可匿名获取（付费/私密），无法下载') { super(message); this.name = 'MowenNoteUnavailable' }
}

/** note/show 网络层失败（非 200 非 400 付费 / 非 JSON）。BrowserWindow 兜底只在这类失败时触发。 */
export class MowenShowFailed extends Error {
  constructor(public readonly status: number, bodySnippet: string) {
    super(`墨问正文接口请求失败（HTTP ${status}）：${bodySnippet.slice(0, 120)}`)
    this.name = 'MowenShowFailed'
  }
}
