import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { selectArticles, buildManifest, exportFileName, writeMaterialExport, buildAgentPrompt } from '../../src/core/material-export'
import type { ArticleMeta } from '../../src/core/types'

const a = (over: Partial<ArticleMeta>): ArticleMeta => ({
  id: 'id', title: 'T', author: 'au', account: 'acc', publishTime: '2026-06-01',
  sourceUrl: 'https://x', digest: '', coverUrl: '', downloadTime: '2026-06-10T00:00:00.000Z',
  formats: ['md'], dir: '/lib/acc/id', ...over,
})

describe('selectArticles', () => {
  const all = [
    a({ id: '1', account: '猫笔刀', downloadTime: '2026-06-20T08:00:00.000Z' }),
    a({ id: '2', account: '刘备教授', downloadTime: '2026-06-21T08:00:00.000Z' }),
    a({ id: '3', account: '猫笔刀', downloadTime: '2026-06-22T08:00:00.000Z' }),
  ]
  it('all:true returns everything', () => {
    expect(selectArticles(all, { all: true }).map((x) => x.id)).toEqual(['1', '2', '3'])
  })
  it('filters by ids', () => {
    expect(selectArticles(all, { ids: ['1', '3'] }).map((x) => x.id)).toEqual(['1', '3'])
  })
  it('filters by account (case-insensitive contains)', () => {
    expect(selectArticles(all, { account: '猫笔刀' }).map((x) => x.id)).toEqual(['1', '3'])
  })
  it('filters by since (downloadTime >= that day 00:00)', () => {
    expect(selectArticles(all, { since: '2026-06-21' }).map((x) => x.id)).toEqual(['2', '3'])
  })
  it('combines selectors as intersection (account AND since)', () => {
    expect(selectArticles(all, { account: '猫笔刀', since: '2026-06-21' }).map((x) => x.id)).toEqual(['3'])
  })
})

describe('buildManifest', () => {
  it('maps articles to the fixed shape with contentPath = dir/content.md', () => {
    const m = buildManifest([a({ id: '1', dir: '/lib/acc/1' })])
    expect(m).toEqual({
      ok: true, count: 1,
      articles: [{
        id: '1', title: 'T', account: 'acc', author: 'au',
        publishTime: '2026-06-01', sourceUrl: 'https://x',
        dir: '/lib/acc/1', contentPath: join('/lib/acc/1', 'content.md'),
      }],
    })
  })
})

describe('exportFileName', () => {
  it('formats local YYYYMMDD-HHMMSS.json', () => {
    expect(exportFileName(new Date(2026, 5, 22, 9, 7, 3))).toBe('20260622-090703.json')
  })
})

describe('writeMaterialExport', () => {
  it('writes the manifest under exports/ and returns its absolute path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-matexp-'))
    const manifest = buildManifest([a({ id: '1', dir: join(root, 'acc', '1') })])
    const p = await writeMaterialExport(root, manifest, new Date(2026, 5, 22, 9, 7, 3))
    expect(p).toBe(join(root, 'exports', '20260622-090703.json'))
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual(manifest)
  })
})

describe('buildAgentPrompt', () => {
  const p = buildAgentPrompt('/Users/a/Documents/wx-kit/exports/20260720-101010.json', 3)

  it('states the manifest path and article count', () => {
    expect(p).toContain('/Users/a/Documents/wx-kit/exports/20260720-101010.json')
    expect(p).toContain('3 篇')
  })
  it('tells the agent where the article bodies are', () => {
    expect(p).toContain('contentPath')
    expect(p).toContain('content.md')
  })
  it('asks the agent to confirm the angle before writing', () => {
    expect(p).toMatch(/先读|再.*确认/)
  })
  it('keeps paths with spaces and CJK intact', () => {
    const q = buildAgentPrompt('/Users/a/我的 文库/exports/x.json', 1)
    expect(q).toContain('/Users/a/我的 文库/exports/x.json')
    expect(q).toContain('1 篇')
  })
  it('is a single self-contained block ready to paste', () => {
    expect(p.startsWith('\n')).toBe(false)
    expect(p.trim()).toBe(p)
  })
})
