// tests/electron/protocol-resolve.test.ts
import { describe, it, expect } from 'vitest'
import { resolveWxfilePath, withBaseTarget } from '../../electron/protocol'

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
  it('rejects percent-encoded dotdot traversal', () => {
    expect(resolveWxfilePath('wxfile://local/%2E%2E/%2E%2E/etc/passwd', ROOT)).toBeNull()
  })
})

// M56 后补：HTML 视图 iframe 内点外链会在 iframe 里导航，被微信的嵌入限制响应头阻断
// （ERR_BLOCKED_BY_RESPONSE）。协议层给 html 统一注入 <base target="_blank">，
// 配合 iframe allow-popups + 主窗口 setWindowOpenHandler 把外链交给系统浏览器。
describe('withBaseTarget', () => {
  it('injects base after <head>', () => {
    const out = withBaseTarget('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
    expect(out).toContain('<head><base target="_blank">')
  })
  it('injects at start when head is missing', () => {
    const out = withBaseTarget('<html><body><a href="https://mp.weixin.qq.com/s/x">原文</a></body></html>')
    expect(out.startsWith('<base target="_blank">')).toBe(true)
  })
  it('does not inject twice when a base tag already exists', () => {
    const html = '<html><head><base href="wxfile://local/A/"></head><body></body></html>'
    expect(withBaseTarget(html)).toBe(html)
  })
})
