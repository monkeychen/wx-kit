// tests/core/export-orchestration.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { exportArticle, type ExportDeps, type ExportInput } from '../../src/core/exporter/index'
import type { ParsedArticle } from '../../src/core/types'

describe('exportArticle: failed-image data-src strip', () => {
  it('strips data-src attrs for failed images and keeps local path for succeeded images', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wxk-orch-'))

    const successUrl = 'https://img.example.com/success.jpg'
    const failUrl = 'https://img.example.com/fail.jpg'

    const parsed: ParsedArticle = {
      title: 'Test Article',
      author: 'Test Author',
      account: 'TestAccount',
      publishTime: '2026-06-06',
      digest: 'Test digest',
      coverUrl: '',
      contentHtml: `<p><img data-src="${successUrl}" /></p><p><img data-src="${failUrl}" /></p>`,
      imageUrls: [successUrl, failUrl],
    }

    const deps: ExportDeps = {
      fetchBinary: async (url: string) => {
        if (url === successUrl) {
          return { data: Buffer.from('fakeimgdata'), contentType: 'image/jpeg' }
        }
        throw new Error('network error for failed image')
      },
      BrowserWindowCtor: undefined as any, // pdf not selected, won't be called
      now: () => '2026-06-06T00:00:00.000Z',
    }

    const input: ExportInput = {
      parsed,
      id: 'test-id-1',
      sourceUrl: 'https://mp.weixin.qq.com/s/test',
      dir: join(tmpDir, 'article'),
      formats: ['html'],
    }

    await exportArticle(input, deps)

    const htmlContent = readFileSync(join(tmpDir, 'article', 'index.html'), 'utf-8')

    // Succeeded image should use local path
    expect(htmlContent).toContain('images/img-1.jpg')

    // No data-src attributes should remain (failed images stripped)
    expect(htmlContent).not.toContain('data-src=')

    // No remote URL from the failed image
    expect(htmlContent).not.toContain(failUrl)

    // Image file actually written to disk
    expect(existsSync(join(tmpDir, 'article', 'images', 'img-1.jpg'))).toBe(true)
  })
})
