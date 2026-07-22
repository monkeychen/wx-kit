import { describe, it, expect } from 'vitest'
import { isCliInvocation } from '../../electron/cli-dispatch'

describe('isCliInvocation', () => {
  it('subcommands are CLI', () => {
    for (const c of ['download', 'crawl', 'search', 'login', 'auth-status', 'library', 'subscription', 'settings', 'session', 'site', 'help', 'version'])
      expect(isCliInvocation([c])).toBe(true)
  })
  it('help/version flags are CLI even as first arg', () => {
    for (const f of ['-h', '--help', '-v', '--version']) expect(isCliInvocation([f])).toBe(true)
  })
  it('flags anywhere in argv are CLI', () => {
    expect(isCliInvocation(['download', '--help'])).toBe(true)
  })
  it('no args is GUI', () => { expect(isCliInvocation([])).toBe(false) })
  it('unknown leading token without flags is GUI', () => { expect(isCliInvocation(['frobnicate'])).toBe(false) })
})
