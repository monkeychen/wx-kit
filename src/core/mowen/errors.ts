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
