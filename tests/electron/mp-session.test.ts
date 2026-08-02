import { describe, expect, it, vi } from 'vitest'
import { hasMpCookies, hydrateMpCookies, MP_ORIGIN } from '../../electron/services/mp-session'

const saved = { token: 'token', cookies: [{ name: 'a', value: 'old' }], timestamp: 1 }

describe('mp Chromium cookie jar', () => {
  it('hydrates a legacy/imported cookie snapshot only when the jar is empty', async () => {
    const ses = {
      cookies: {
        get: vi.fn(async () => []),
        set: vi.fn(async () => {}),
      },
    }
    await hydrateMpCookies(saved, ses as never)
    expect(ses.cookies.set).toHaveBeenCalledWith({ url: MP_ORIGIN, name: 'a', value: 'old', secure: true })
  })

  it('never overwrites cookies that Chromium has already evolved', async () => {
    const ses = {
      cookies: {
        get: vi.fn(async () => [{ name: 'a', value: 'fresh' }]),
        set: vi.fn(async () => {}),
      },
    }
    await hydrateMpCookies(saved, ses as never)
    expect(ses.cookies.set).not.toHaveBeenCalled()
    expect(await hasMpCookies(ses as never)).toBe(true)
  })
})
