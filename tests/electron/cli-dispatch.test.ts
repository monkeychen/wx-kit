import { describe, it, expect } from 'vitest'
import { isCliInvocation, normalizeUserArgs } from '../../electron/cli-dispatch'

describe('normalizeUserArgs', () => {
  it('removes Electron-only user-data switch without touching CLI options', () => {
    expect(normalizeUserArgs([
      '.', '--user-data-dir=/tmp/wx-kit-test', 'download', '--url', 'https://example.com/article',
    ])).toEqual(['download', '--url', 'https://example.com/article'])
  })
})

describe('isCliInvocation', () => {
  it('subcommands are CLI', () => {
    for (const c of ['download', 'crawl', 'search', 'login', 'auth-status', 'library', 'subscription', 'settings', 'session', 'site', 'update', 'protection', 'help', 'version'])
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
