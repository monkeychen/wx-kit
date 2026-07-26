// tests/core/install-channel.test.ts
import { describe, it, expect } from 'vitest'
import { detectChannel, upgradeCommand, pickAsset, DMG_POST_INSTALL_HINT } from '../../src/core/install-channel'

const has = (...paths: string[]) => (p: string) => paths.includes(p)

describe('detectChannel', () => {
  it('mac + Caskroom 台账存在 → brew(两种前缀都认)', () => {
    expect(detectChannel({ platform: 'darwin', existsSync: has('/opt/homebrew/Caskroom/wx-kit') })).toBe('brew')
    expect(detectChannel({ platform: 'darwin', existsSync: has('/usr/local/Caskroom/wx-kit') })).toBe('brew')
  })
  it('mac 无 Caskroom → 手动装的 dmg', () => {
    expect(detectChannel({ platform: 'darwin', existsSync: () => false })).toBe('dmg')
  })
  it('windows → nsis', () => {
    expect(detectChannel({ platform: 'win32', existsSync: () => false })).toBe('nsis')
  })
  it('其它平台 → unknown(不瞎猜)', () => {
    expect(detectChannel({ platform: 'linux', existsSync: () => false })).toBe('unknown')
  })
})

describe('upgradeCommand', () => {
  it('brew 命令三段齐全 —— 少任何一段都会踩我们踩过的坑', () => {
    const cmd = upgradeCommand('brew')!
    expect(cmd).toContain('brew update')                    // tap 是本地 clone,不更新会读到旧 cask
    expect(cmd).toContain('brew upgrade --cask wx-kit')
    expect(cmd).toContain('xattr -cr')                      // 未签名 app 的 quarantine 连 CLI 都拦
  })
  it('非 brew 渠道没有命令(走下载资产的路径)', () => {
    expect(upgradeCommand('dmg')).toBeNull()
    expect(upgradeCommand('nsis')).toBeNull()
    expect(upgradeCommand('unknown')).toBeNull()
  })
  it('手动安装的收尾提示仍要给 xattr', () => {
    expect(DMG_POST_INSTALL_HINT).toContain('xattr -cr')
  })
})

describe('pickAsset', () => {
  // 真实资产名
  const assets = [
    { name: 'wx-kit-0.8.1-arm64.dmg' },
    { name: 'wx-kit-0.8.1.dmg' },
    { name: 'wx-kit.Setup.0.8.1.exe' },
  ]
  it('mac arm64 取 arm64 包,intel 取不带 arm64 的那个', () => {
    expect(pickAsset(assets, 'darwin', 'arm64')?.name).toBe('wx-kit-0.8.1-arm64.dmg')
    expect(pickAsset(assets, 'darwin', 'x64')?.name).toBe('wx-kit-0.8.1.dmg')
  })
  it('windows 取 exe', () => {
    expect(pickAsset(assets, 'win32', 'x64')?.name).toBe('wx-kit.Setup.0.8.1.exe')
  })
  it('只有一种 dmg 时两种架构都回落到它(总比不给好)', () => {
    const only = [{ name: 'wx-kit-0.8.1-arm64.dmg' }]
    expect(pickAsset(only, 'darwin', 'x64')?.name).toBe('wx-kit-0.8.1-arm64.dmg')
  })
  it('挑不到返回 null(调用方退回打开 releases 页)', () => {
    expect(pickAsset([], 'darwin', 'arm64')).toBeNull()
    expect(pickAsset(assets, 'linux', 'x64')).toBeNull()
  })
})
