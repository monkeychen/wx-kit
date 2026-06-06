// tests/core/read-article.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readArticleContent } from '../../src/core/read-article'

describe('readArticleContent', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wxk-read-'))
    writeFileSync(join(dir, 'content.md'), '---\ntitle: "T"\nsource: "u"\n---\n# T\n\n正文段落\n')
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>hi</body></html>')
  })

  it('reads md with frontmatter stripped', async () => {
    const out = await readArticleContent(dir, 'md')
    expect(out.startsWith('---')).toBe(false)
    expect(out).toContain('# T')
    expect(out).toContain('正文段落')
  })
  it('reads html raw', async () => {
    const out = await readArticleContent(dir, 'html')
    expect(out).toContain('<!doctype html>')
  })
  it('throws clear error when requested format file missing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'wxk-empty-'))
    await expect(readArticleContent(empty, 'md')).rejects.toThrow(/not found/i)
  })
})
