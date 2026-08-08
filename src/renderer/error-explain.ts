// src/renderer/error-explain.ts
// 纯展示逻辑：把错误归一为用户能看懂、能行动的文案。属 renderer 层——
// CLI 契约是 stdout 纯 JSON 给 agent 解析、不要人话，故无需放 core 共享（YAGNI）。
export interface ExplainedError {
  /** 面向用户的人话标题。 */
  title: string
  /** 下一步该怎么做。 */
  hint: string
  /** 原始报错文案，折叠备查，永不丢。 */
  raw: string
}

/**
 * 把原始错误归一为「人话标题 + 下一步建议」。
 * 同时按 error.code（已知异常类）与 message 关键字两路匹配：错误跨 IPC 序列化后常只剩 message，
 * 故关键字匹配是主路，code 匹配是同进程内的加成。
 */
export function explainError(err: unknown): ExplainedError {
  const raw = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string } | null)?.code
  const m = raw.toLowerCase()
  const has = (...ks: string[]): boolean => ks.some((k) => m.includes(k))

  if (code === 'MP_RATE_LIMITED' || code === 'RATE_LIMITED' || has('200013', '频率限制', '频控'))
    return { title: '微信请求已全局停止', hint: '系统不会自动重试。请等待风控恢复后，到设置页手动恢复请求许可。', raw }
  if (code === 'MP_GOVERNOR_PAUSED' || has('请求保护首次启用', '微信请求已暂停'))
    return { title: '微信请求处于暂停状态', hint: '如需继续，请到设置页查看原因并手动恢复请求许可。', raw }
  if (code === 'MP_REQUEST_CANCELLED')
    return { title: '请求已取消', hint: '排队中的请求没有发送到微信。', raw }
  if (code === 'AUTH_REQUIRED' || has('auth_required', '200040', '登录态'))
    return { title: '登录已过期', hint: '请重新登录公众号后台后再试。', raw }
  if (has('timeout'))
    return { title: '网络超时', hint: '请检查网络（含代理设置）后重试。', raw }
  if (has('fetch failed', 'enotfound', 'econnrefused', 'econnreset', 'etimedout', 'network', 'getaddrinfo'))
    return { title: '网络异常', hint: '请检查网络连接后重试。', raw }
  if (has('no title parsed', 'invalid or unavailable article'))
    return { title: '文章无法访问', hint: '可能已被删除或设为私密，换一篇再试。', raw }
  if (code === 'MP_API_ERROR')
    return { title: '微信接口出错', hint: '请稍后重试。', raw }
  return { title: '下载失败', hint: '请重试；若反复失败可向我反馈。', raw }
}
