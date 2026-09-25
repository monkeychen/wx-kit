// tests/renderer/wxfile.test.ts
// M78 后 Windows 实录（安哥首跑 Windows dev）：图片/封面/HTML 视图全挂，net::ERR_FILE_NOT_FOUND。
// 根因：library.json 的 dir 是 Node join() 产物（Windows 反斜杠），toWxfileBase 的
// startsWith('/…/') 恒失败 → 完整绝对路径塞进协议路径 → resolveWxfilePath 把「C:」
// 段折叠回库根拼出不存在的嵌套路径（不越界、不 403，静默 404）。
import { describe, it, expect } from 'vitest'
import { toWxfileBase, wxfileJoin } from '../../src/renderer/wxfile'

describe('toWxfileBase', () => {
  it('posix: dir under root yields relative encoded base', () => {
    expect(toWxfileBase('/lib/root', '/lib/root/公众号/2026_a'))
      .toBe('wxfile://local/' + encodeURIComponent('公众号') + '/' + encodeURIComponent('2026_a'))
  })

  it('windows: backslash dir under backslash root yields relative base (not absolute)', () => {
    const out = toWxfileBase('C:\\Users\\u\\OneDrive\\文档\\wx-kit', 'C:\\Users\\u\\OneDrive\\文档\\wx-kit\\令仪小友\\2026_a')
    expect(out).toBe('wxfile://local/' + encodeURIComponent('令仪小友') + '/' + encodeURIComponent('2026_a'))
    expect(out).not.toContain('C%3A')
  })

  it('windows: dir already using forward slashes still matches normalized root', () => {
    const out = toWxfileBase('C:\\Users\\u\\wx-kit', 'C:/Users/u/wx-kit/a/b')
    expect(out).toBe('wxfile://local/a/b')
  })

  it('windows: root with trailing separator still strips', () => {
    expect(toWxfileBase('C:\\Users\\u\\wx-kit\\', 'C:\\Users\\u\\wx-kit\\a'))
      .toBe('wxfile://local/' + encodeURIComponent('a'))
  })

  it('dir outside root falls back to per-segment encoded dir (protocol 403s it — documented degrade)', () => {
    // 分层契约：回退分支照实编码原 dir（含盘符段），协议层 resolveWxfilePath 拒判盘符段
    // 返 403 → 资源不显示但 UI 不崩。协议侧的拒判在 protocol-resolve.test.ts 单独钉死。
    // 渲染层真正红线是上面几条：库内 dir 必须产出相对路径，不得混入盘符段。
    expect(toWxfileBase('C:\\Users\\u\\wx-kit', 'D:\\elsewhere\\a'))
      .toBe('wxfile://local/D%3A/elsewhere/a')
    expect(toWxfileBase('/lib/root', '/elsewhere/a'))
      .toBe('wxfile://local/elsewhere/a')
  })
})

describe('wxfileJoin', () => {
  it('encodes each segment of the file part', () => {
    expect(wxfileJoin('wxfile://local/a', 'images/img 1.webp'))
      .toBe('wxfile://local/a/images/' + encodeURIComponent('img 1.webp'))
  })
})
