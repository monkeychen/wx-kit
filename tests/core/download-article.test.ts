// tests/core/download-article.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadArticle, type DownloadArticleDeps } from '../../src/core/download-article'
import { Library } from '../../src/core/library'

const VALID_HTML = `<!doctype html><html><head>
  <meta property="og:title" content="有效标题" />
  <meta property="og:description" content="摘要" />
</head><body>
  <h1 class="rich_media_title" id="activity-name">有效标题</h1>
  <span id="js_name">测试公众号</span>
  <em id="publish_time">2026-02-25 08:00</em>
  <div class="rich_media_content" id="js_content"><p>正文</p></div>
</body></html>`

const EMPTY_HTML = `<!doctype html><html><head></head><body><div>页面不存在</div></body></html>`

function makeDeps(root: string, html: string): DownloadArticleDeps {
  const library = new Library(root)
  return {
    fetchHtml: async () => html,
    fetchBinary: async () => ({ data: Buffer.from(''), contentType: 'image/jpeg' }),
    BrowserWindowCtor: undefined as any, // pdf not exercised
    now: () => '2026-06-06T00:00:00.000Z',
    library,
    libraryRoot: root,
  }
}

const TEST_URL = 'https://mp.weixin.qq.com/s/test-article-123'

describe('downloadArticle', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wxk-dl-'))
  })

  it('valid article downloads and is added to library', async () => {
    const deps = makeDeps(root, VALID_HTML)
    const result = await downloadArticle(TEST_URL, ['md', 'meta'], deps)

    expect(result.ok).toBe(true)
    expect(result.skipped).toBeFalsy()
    expect(result.id).toBeTruthy()
    expect(result.dir).toBeTruthy()
    expect(result.formats).toEqual(['md', 'meta'])

    expect(await deps.library.has(result.id!)).toBe(true)

    const metaPath = join(result.dir!, 'meta.json')
    expect(existsSync(metaPath)).toBe(true)
    const metaJson = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(metaJson.title).toBe('有效标题')
  })

  it('invalid (no title) article rejects', async () => {
    const deps = makeDeps(root, EMPTY_HTML)

    await expect(
      downloadArticle(TEST_URL, ['meta'], deps),
    ).rejects.toThrow(/invalid or unavailable article/)

    expect((await deps.library.list()).length).toBe(0)
    // nothing written under libraryRoot for the article
    const entries = require('node:fs').readdirSync(root)
    expect(entries.filter((e: string) => e !== 'library.json')).toHaveLength(0)
  })

  it('dedup returns skipped without refetching', async () => {
    // First download — succeeds with VALID_HTML
    const deps1 = makeDeps(root, VALID_HTML)
    const first = await downloadArticle(TEST_URL, ['md', 'meta'], deps1)
    expect(first.ok).toBe(true)
    expect(first.skipped).toBeFalsy()

    // Second download — fetchHtml must NOT be called
    let fetchCalled = false
    const library = (deps1 as any).library as Library
    const deps2: DownloadArticleDeps = {
      fetchHtml: async () => {
        fetchCalled = true
        throw new Error('fetchHtml should not be called on dedup')
      },
      fetchBinary: async () => ({ data: Buffer.from(''), contentType: 'image/jpeg' }),
      BrowserWindowCtor: undefined as any,
      now: () => '2026-06-06T00:00:00.000Z',
      library,
      libraryRoot: root,
    }

    const second = await downloadArticle(TEST_URL, ['md', 'meta'], deps2)
    expect(second.ok).toBe(true)
    expect(second.skipped).toBe(true)
    expect(fetchCalled).toBe(false)
  })
})
