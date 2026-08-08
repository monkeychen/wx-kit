import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activeRequestState, beginRequest, completeRequest, planRequest, resumeRequests } from '../../src/core/mp-request-governor'
import { FileMpRequestStateStore } from '../../electron/services/mp-request-state'

describe('FileMpRequestStateStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-mp-state-')) })

  it('starts active so an explicit URL download is not locked behind a retired UI', async () => {
    const state = await new FileMpRequestStateStore(dir).read()
    expect(state.mode).toBe('active')
  })

  it('persists an explicit resume', async () => {
    const store = new FileMpRequestStateStore(dir)
    await store.update((state) => ({ state: resumeRequests(state, 123), value: undefined }))
    const loaded = await new FileMpRequestStateStore(dir).read()
    expect(loaded.mode).toBe('active')
    expect(loaded.updatedAt).toBe(123)
  })

  it('recovers a corrupt state to active and leaves a diagnostic reason', async () => {
    writeFileSync(join(dir, 'mp-request-state.json'), '{broken')
    const state = await new FileMpRequestStateStore(dir).read()
    expect(state.mode).toBe('active')
    expect(state.pausedReason).toContain('损坏')
  })

  it('serializes updates made by separate store instances', async () => {
    const path = join(dir, 'mp-request-state.json')
    writeFileSync(path, JSON.stringify(activeRequestState(0)))
    const a = new FileMpRequestStateStore(dir)
    const b = new FileMpRequestStateStore(dir)
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    await Promise.all([
      a.update(async (state) => {
        await wait(30)
        return { state: { ...state, nextAllowedAt: state.nextAllowedAt + 1 }, value: undefined }
      }),
      b.update(async (state) => ({
        state: { ...state, nextAllowedAt: state.nextAllowedAt + 1 }, value: undefined,
      })),
    ])

    expect((await a.read()).nextAllowedAt).toBe(2)
    expect(JSON.parse(await readFile(path, 'utf-8')).nextAllowedAt).toBe(2)
  })

  it('makes an in-flight reservation visible across store instances', async () => {
    const path = join(dir, 'mp-request-state.json')
    writeFileSync(path, JSON.stringify(activeRequestState(0)))
    const a = new FileMpRequestStateStore(dir)
    const b = new FileMpRequestStateStore(dir)

    await a.update((state) => ({ state: beginRequest(state, 'owner-a', 'article-list', 100, 5_000), value: undefined }))
    const decision = await b.update((state) => ({ state, value: planRequest(state, 200) }))
    expect(decision).toEqual({ action: 'wait', waitMs: 4_900, until: 5_100 })

    await a.update((state) => ({ state: completeRequest(state, 'owner-a', 300), value: undefined }))
    expect(planRequest(await b.read(), 300)).toEqual({ action: 'allow' })
  })
})
