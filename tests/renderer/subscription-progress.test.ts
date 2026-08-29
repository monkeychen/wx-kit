import { describe, expect, it } from 'vitest'
import { updatePerAccountProgress } from '../../src/renderer/subscription-progress'

describe('updatePerAccountProgress', () => {
  it('removes a completed account even when done arrives after the check promise resolved', () => {
    const next = updatePerAccountProgress({}, {
      fakeid: 'MP_WXS_1', total: 1, done: 1, phase: 'done',
    })
    expect(next).toEqual({})
  })
})
