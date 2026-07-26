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
    expect(result.title).toBe('有效标题')

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
    expect(second.title).toBe('有效标题')
    expect(second.dir).toBe(first.dir)   // 跳过项也带 dir，供「在文件夹显示」
    expect(fetchCalled).toBe(false)
  })
})

describe('用列表主键判重(M36)', () => {
  it('有 hint 时用 mid_idx 作 id —— 短链也能算出稳定标识', async () => {
    const deps = makeDeps(mkdtempSync(join(tmpdir(), 'wxk-hint-')), VALID_HTML)
    const r = await downloadArticle('https://mp.weixin.qq.com/s/ShortCode123', ['meta'], deps,
      { appmsgid: 2247494971, itemidx: 1 })
    expect(r.id).toBe('2247494971_1')
    expect((await deps.library.get('2247494971_1'))?.id).toBe('2247494971_1')
  })

  it('库里是老格式(mid_idx_sn)时,短链重抓会跳过而不是重下', async () => {
    const deps = makeDeps(mkdtempSync(join(tmpdir(), 'wxk-hint2-')), VALID_HTML)
    // 模拟老版本用长链下过这篇
    await deps.library.add({
      id: '2247494971_1_6ce948b6802fa74b8e4fd21386e8e487', title: '旧记录', author: 'a', account: 'acc',
      publishTime: '2026-07-22 10:00', sourceUrl: 'http://mp.weixin.qq.com/s?mid=2247494971&idx=1&sn=6ce948b6802fa74b8e4fd21386e8e487',
      digest: '', coverUrl: '', downloadTime: '2026-07-22T00:00:00Z', formats: ['md'], dir: '/tmp/old',
    })
    let fetched = false
    const spy = { ...deps, fetchHtml: async (u: string) => { fetched = true; return deps.fetchHtml(u) } }
    const r = await downloadArticle('https://mp.weixin.qq.com/s/ShortCode123', ['meta'], spy,
      { appmsgid: 2247494971, itemidx: 1 })
    expect(r.skipped).toBe(true)
    expect(r.title).toBe('旧记录')
    expect(fetched).toBe(false)      // 判重必须发生在请求页面之前
  })

  it('解析告警汇集到结果的 warnings(未识别类型这类问题不能只躺在文件里)', async () => {
    // 页面带一个没适配的 item_show_type → parseArticle 产出告警 → 应浮到 DownloadItemResult
    const deps = makeDeps(mkdtempSync(join(tmpdir(), 'wxk-hint3-')),
      '<h1 id="activity-name">标题</h1><div id="js_content"><p>正文</p></div>' +
      "<script>item_show_type: '77' * 1,</script>")
    const r = await downloadArticle('https://mp.weixin.qq.com/s/X', ['meta'], deps)
    expect(r.warnings?.join()).toContain('未识别的消息类型 77')
  })
})
