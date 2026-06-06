// tests/core/image-localizer.test.ts
import { describe, it, expect } from 'vitest'
import { buildImageMap, rewriteImageRefs } from '../../src/core/image-localizer'

describe('buildImageMap', () => {
  it('maps each url to images/img-N.<ext> by content type', () => {
    const map = buildImageMap(
      ['https://x/a', 'https://x/b'],
      url => (url.endsWith('a') ? 'image/jpeg' : 'image/png'),
    )
    expect(map.get('https://x/a')).toBe('images/img-1.jpg')
    expect(map.get('https://x/b')).toBe('images/img-2.png')
  })
})

describe('rewriteImageRefs', () => {
  it('rewrites data-src and src to local relative paths', () => {
    const map = new Map([['https://x/a', 'images/img-1.jpg']])
    const html = '<p><img data-src="https://x/a" src="placeholder.gif" /></p>'
    const out = rewriteImageRefs(html, map)
    expect(out).toContain('src="images/img-1.jpg"')
    expect(out).not.toContain('https://x/a')
    expect(out).not.toContain('placeholder.gif')
  })
})
