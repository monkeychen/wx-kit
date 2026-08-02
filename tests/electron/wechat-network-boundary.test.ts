import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '../..')
const read = (path: string) => readFileSync(join(root, path), 'utf-8')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name)
    if (statSync(join(root, rel)).isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}

describe('WeChat production network boundary', () => {
  it('no file combines Node axios with a WeChat endpoint', () => {
    const offenders = [...sourceFiles('src'), ...sourceFiles('electron')].filter((file) => {
      const body = read(file)
      return body.includes("from 'axios'") && /(weixin\.qq\.com|qpic\.cn)/.test(body)
    })
    expect(offenders).toEqual([])
  })

  it('backend adapter contains no static Cookie or forged User-Agent', () => {
    const body = read('electron/services/mp-fetch.ts')
    expect(body).not.toMatch(/axios|User-Agent|Cookie|Chrome\/124|Macintosh/)
    expect(body).toContain('gateway.requestJson')
  })

  it('CLI article paths no longer import the generic Node downloader', () => {
    expect(read('src/cli/index.ts')).not.toContain("from '../core/fetch-html'")
    expect(read('src/cli/index.ts')).toContain('mpArticleFetchers')
  })

  it('auth status and session import no longer hide a fixed Tencent search probe', () => {
    expect(read('electron/ipc.ts')).not.toContain("session.token, '腾讯'")
    expect(read('src/cli/index.ts')).not.toContain("session.token, '腾讯'")
  })

  it('fixture e2e cannot copy a real session or soft-skip a live crawl', () => {
    const body = read('tests/e2e/gui.e2e.mjs')
    expect(body).toContain("WX_KIT_BLOCK_WECHAT_NETWORK: '1'")
    expect(body).not.toMatch(/realSession|seeded real mp-session|real crawl|soft-skipped/)
  })
})
