// src/core/mowen/types.ts
// mocli（墨问官方 CLI，mowenxd/cli）的运行结果与领域类型。
// 契约 2026-09-11 真机钉死（mocli v0.5.4）：stdout 恒为单行 JSON
// {code, status, reply?|reason?|msg?}；失败退出码非零（VALIDATE=2、NOT_FOUND=7）。

export interface MocliRunResult { code: number; stdout: string; stderr: string }

/** 发起一次 mocli 调用。具体 child_process 实现在 runner.ts，测试注入 mock。 */
export type MocliRunner = (args: string[], timeoutMs?: number) => Promise<MocliRunResult>

export interface MowenUser {
  uid: string
  name: string
  intro: string
  homeUrl: string
}

/** 用户主页笔记清单条目（notes homepage / notes mine 的 notes map 逐项映射）。 */
export interface MowenNoteListItem {
  noteId: string
  uid: string
  title: string
  brief: string
  url: string
  publicAt: number | null      // unix 秒
  withFee: boolean
  withImage: boolean
  withText: boolean
  wordCount: number | null
  viewCount: number | null
  favorCount: number | null
}
