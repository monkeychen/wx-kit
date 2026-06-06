// tests/electron/protocol-resolve.test.ts
import { describe, it, expect } from 'vitest'
import { resolveWxfilePath } from '../../electron/protocol'

const ROOT = '/lib/root'

describe('resolveWxfilePath', () => {
  it('resolves a normal in-root file', () => {
    expect(resolveWxfilePath('wxfile://local/A/2026_t/index.html', ROOT))
      .toBe('/lib/root/A/2026_t/index.html')
  })
  it('decodes percent-encoded segments (chinese/space)', () => {
    expect(resolveWxfilePath('wxfile://local/' + encodeURIComponent('公众号') + '/a.png', ROOT))
      .toBe('/lib/root/公众号/a.png')
  })
  it('rejects path traversal outside root', () => {
    expect(resolveWxfilePath('wxfile://local/../../etc/passwd', ROOT)).toBeNull()
  })
  it('keeps encoded slashes inside root (no escape)', () => {
    const out = resolveWxfilePath('wxfile://local/' + encodeURIComponent('/etc/passwd'), ROOT)
    expect(out).not.toBeNull()
    expect(out!.startsWith('/lib/root')).toBe(true)
  })
})
