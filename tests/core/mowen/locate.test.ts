// tests/core/mowen/locate.test.ts
// locateMocli 探测链测试：which → 常见安装位 → login shell 兜底。
// 背景：macOS GUI 启动的应用只拿系统最小 PATH，nvm/volta/homebrew 里的 mocli
// 在终端找得到、在 GUI 里找不到（v0.11.0 另一台机器实录）。
import { describe, it, expect } from 'vitest'
import { locateMocli, commonBinDirs } from '../../../src/core/mowen/locate'
import { injectPathDir } from '../../../src/core/mowen/runner'
import type { LocateDeps } from '../../../src/core/mowen/locate'
import type { WhichRunner } from '../../../src/core/mowen/detect'

const whichMissing: WhichRunner = async () => ({ code: 1, stdout: '' })
const whichFound: WhichRunner = async () => ({ code: 0, stdout: '/usr/bin/mocli\n' })

/** 组装可观察的 deps：exists/listDir 由一张表驱动，shellResolve/shellSpy 记录调用。 */
function makeDeps(over: {
  existsFiles?: string[]
  dirs?: Record<string, string[]>
  shellOut?: string
  shellThrow?: boolean
  platform?: NodeJS.Platform
  env?: { HOME?: string; SHELL?: string }
} = {}): { deps: LocateDeps; calls: { exists: string[]; listDir: string[]; shell: number } } {
  const files = new Set(over.existsFiles ?? [])
  const calls = { exists: [] as string[], listDir: [] as string[], shell: 0 }
  const deps: LocateDeps = {
    platform: over.platform ?? 'darwin',
    env: over.env ?? { HOME: '/Users/tom', SHELL: '/bin/zsh' },
    exists: async (p) => { calls.exists.push(p); return files.has(p) },
    listDir: async (d) => {
      calls.listDir.push(d)
      return over.dirs?.[d] ?? null
    },
    shellResolve: async () => {
      calls.shell++
      if (over.shellThrow) throw new Error('shell timeout')
      return { code: 0, stdout: over.shellOut ?? '' }
    },
  }
  return { deps, calls }
}

describe('locateMocli', () => {
  it('which 命中 → 直接返回，不做任何后续探测', async () => {
    const { deps, calls } = makeDeps()
    const p = await locateMocli(whichFound, deps)
    expect(p).toBe('/usr/bin/mocli')
    expect(calls.exists).toHaveLength(0)
    expect(calls.listDir).toHaveLength(0)
    expect(calls.shell).toBe(0)
  })

  it('which 落空 + /opt/homebrew/bin 有 → 返回固定位置', async () => {
    const { deps, calls } = makeDeps({ existsFiles: ['/opt/homebrew/bin/mocli'] })
    expect(await locateMocli(whichMissing, deps)).toBe('/opt/homebrew/bin/mocli')
    expect(calls.shell).toBe(0)
  })

  it('固定位置逐个探测：volta/asdf/npm-global 都在候选里', async () => {
    for (const p of ['/Users/tom/.volta/bin/mocli', '/Users/tom/.asdf/shims/mocli', '/Users/tom/.npm-global/bin/mocli']) {
      const { deps } = makeDeps({ existsFiles: [p] })
      expect(await locateMocli(whichMissing, deps)).toBe(p)
    }
  })

  it('nvm 多版本取最新 node 目录下的 bin/mocli', async () => {
    const { deps, calls } = makeDeps({
      dirs: { '/Users/tom/.nvm/versions/node': ['v20.11.0', 'v24.12.0', 'v22.1.0'] },
      existsFiles: ['/Users/tom/.nvm/versions/node/v24.12.0/bin/mocli'],
    })
    expect(await locateMocli(whichMissing, deps)).toBe('/Users/tom/.nvm/versions/node/v24.12.0/bin/mocli')
    expect(calls.listDir).toContain('/Users/tom/.nvm/versions/node')
  })

  it('nvm 目录名无 v 前缀（24.12.0）也认，且混入的非法目录名被忽略', async () => {
    const { deps } = makeDeps({
      dirs: { '/Users/tom/.nvm/versions/node': ['24.9.0', '24.12.0', 'io.js'] },
      existsFiles: ['/Users/tom/.nvm/versions/node/24.12.0/bin/mocli'],
    })
    expect(await locateMocli(whichMissing, deps)).toBe('/Users/tom/.nvm/versions/node/24.12.0/bin/mocli')
  })

  it('login shell 兜底：.zshrc 垃圾输出中取最后一个绝对路径行，且需 exists 认可', async () => {
    const { deps, calls } = makeDeps({
      shellOut: 'nvm loaded\n/Users/tom/.local/bin/mocli\n',
      existsFiles: ['/Users/tom/.local/bin/mocli'],
    })
    expect(await locateMocli(whichMissing, deps)).toBe('/Users/tom/.local/bin/mocli')
    expect(calls.shell).toBe(1)
  })

  it('login shell 输出的路径 exists 校验失败 → null（不认未验证的输出）', async () => {
    const { deps } = makeDeps({ shellOut: '/Users/tom/fake/mocli\n' })
    expect(await locateMocli(whichMissing, deps)).toBeNull()
  })

  it('login shell 超时/抛错 → 静默 null，不抛', async () => {
    const { deps } = makeDeps({ shellThrow: true })
    expect(await locateMocli(whichMissing, deps)).toBeNull()
  })

  it('win32：不探测 unix 固定位置、不列 nvm、不跑 login shell', async () => {
    const { deps, calls } = makeDeps({ platform: 'win32' })
    expect(await locateMocli(whichMissing, deps)).toBeNull()
    expect(calls.exists).toHaveLength(0)
    expect(calls.listDir).toHaveLength(0)
    expect(calls.shell).toBe(0)
  })

  it('HOME 缺失 → 跳过 HOME 相对候选不崩（固定绝对位置仍可用）', async () => {
    const { deps } = makeDeps({
      env: { HOME: undefined, SHELL: '/bin/zsh' },
      existsFiles: ['/usr/local/bin/mocli'],
    })
    expect(await locateMocli(whichMissing, deps)).toBe('/usr/local/bin/mocli')
  })

  it('全部落空 → null', async () => {
    const { deps } = makeDeps()
    expect(await locateMocli(whichMissing, deps)).toBeNull()
  })
})

describe('injectPathDir', () => {
  it('把目录 prepend 进 PATH；已含该目录时幂等；null 不动', () => {
    const saved = process.env.PATH
    try {
      process.env.PATH = '/usr/bin:/bin'
      injectPathDir('/Users/tom/.nvm/versions/node/v24.12.0/bin/mocli')
      expect(process.env.PATH).toBe('/Users/tom/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin')
      // 再次注入同一目录 → 不重复
      injectPathDir('/Users/tom/.nvm/versions/node/v24.12.0/bin/mocli')
      expect(process.env.PATH).toBe('/Users/tom/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin')
      // null → 原样
      injectPathDir(null)
      expect(process.env.PATH).toBe('/Users/tom/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin')
    } finally {
      process.env.PATH = saved
    }
  })
})

describe('commonBinDirs（启动期 PATH 预置候选）', () => {
  it('返回存在的常见工具链目录；nvm 取最新版本 bin；不存在的跳过', async () => {
    const { deps } = makeDeps({
      dirs: { '/Users/tom/.nvm/versions/node': ['v20.11.0', 'v24.12.0'] },
      existsFiles: ['/Users/tom/.volta/bin', '/Users/tom/.nvm/versions/node/v24.12.0/bin', '/opt/homebrew/bin'],
    })
    const dirs = await commonBinDirs(deps)
    expect(dirs).toContain('/Users/tom/.volta/bin')
    expect(dirs).toContain('/Users/tom/.nvm/versions/node/v24.12.0/bin')
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).not.toContain('/Users/tom/.asdf/shims')
    expect(dirs).not.toContain('/Users/tom/.nvm/versions/node/v20.11.0/bin')
  })
  it('纯 fs 探测：不跑 login shell、不要求 mocli 存在', async () => {
    const { deps, calls } = makeDeps({})
    await commonBinDirs(deps)
    expect(calls.shell).toBe(0)
  })
  it('HOME 缺失 → 只返回存在的绝对目录', async () => {
    const { deps } = makeDeps({ env: { HOME: undefined, SHELL: '/bin/zsh' }, existsFiles: ['/usr/local/bin'] })
    expect(await commonBinDirs(deps)).toEqual(['/usr/local/bin'])
  })
})
