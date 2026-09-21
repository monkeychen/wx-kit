// 选题 AI 的开发模式交互追踪。
// WXKIT_DEBUG=1 时把与大模型的完整请求/响应/校验明细打到终端 stderr——只进终端，
// 绝不进 main.log（诊断日志有零正文红线，见 devlog；本开关是用户主动要求的本地观察）。
// 请求体只打前 3000 字符（快照可到 12 万字符，全量是噪音）；响应全量——那才是要看的东西。
const PREVIEW_CHARS = 3000

export function topicDebugEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WXKIT_DEBUG === '1'
}

export function topicTrace(message: string, env?: Record<string, string | undefined>): void {
  if (!topicDebugEnabled(env)) return
  process.stderr.write(`[topics] ${message}\n`)
}

export const preview = (text: string): string =>
  text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n…（截断，共 ${text.length} 字符）` : text
