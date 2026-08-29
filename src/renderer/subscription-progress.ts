import type { SubscriptionDownloadProgress } from './api'

export interface PerAccountDownloadState { total: number; done: number; phase: string }

/** `done` 是终态，不应留在状态表里继续把整页判为 busy。 */
export function updatePerAccountProgress(
  previous: Record<string, PerAccountDownloadState>,
  event: SubscriptionDownloadProgress,
): Record<string, PerAccountDownloadState> {
  if (event.phase === 'done') {
    const next = { ...previous }
    delete next[event.fakeid]
    return next
  }
  return { ...previous, [event.fakeid]: { total: event.total, done: event.done, phase: event.phase } }
}
