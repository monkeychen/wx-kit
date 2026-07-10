import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { linkStatus, createLink, wrapperScript, pathContains, ensureInProfile, profilePathFor } from '../../electron/services/cli-link'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-link-')) })

describe('wrapperScript', () => {
  it('execs the target forwarding all args', () => {
    const s = wrapperScript('/Applications/wx-kit.app/Contents/MacOS/wx-kit')
    expect(s.startsWith('#!/bin/sh\n')).toBe(true)
    expect(s).toContain('exec "/Applications/wx-kit.app/Contents/MacOS/wx-kit" "$@"')
  })
})

describe('linkStatus', () => {
  it('unlinked when missing', async () => {
    expect(await linkStatus(join(dir, 'wx-kit'), '/target')).toBe('unlinked')
  })
  it('linked when a wrapper script for target occupies the path', async () => {
    const lp = join(dir, 'wx-kit'); writeFileSync(lp, wrapperScript('/target'))
    expect(await linkStatus(lp, '/target')).toBe('linked')
  })
  // 旧版(≤v0.5.1)建的是 symlink——mac 上 Electron 经软链找不到 Helper app,功能是坏的,须识别并升级
  it('legacy when a symlink points to target (old broken form)', async () => {
    const lp = join(dir, 'wx-kit'); symlinkSync('/target', lp)
    expect(await linkStatus(lp, '/target')).toBe('legacy')
  })
  it('conflict when a symlink points elsewhere', async () => {
    const lp = join(dir, 'wx-kit'); symlinkSync('/other', lp)
    expect(await linkStatus(lp, '/target')).toBe('conflict')
  })
  it('conflict when a wrapper for another target occupies the path', async () => {
    const lp = join(dir, 'wx-kit'); writeFileSync(lp, wrapperScript('/other'))
    expect(await linkStatus(lp, '/target')).toBe('conflict')
  })
  it('conflict when an unrelated regular file occupies the path', async () => {
    const lp = join(dir, 'wx-kit'); writeFileSync(lp, 'x')
    expect(await linkStatus(lp, '/target')).toBe('conflict')
  })
})

describe('createLink', () => {
  it('creates dir + executable wrapper script for target', async () => {
    const ld = join(dir, 'bin'); const lp = join(ld, 'wx-kit')
    await createLink(ld, lp, '/target')
    expect(await linkStatus(lp, '/target')).toBe('linked')
    expect(readFileSync(lp, 'utf-8')).toBe(wrapperScript('/target'))
    expect(statSync(lp).mode & 0o111).not.toBe(0)   // 可执行位
  })
  it('throws without force when the path is occupied', async () => {
    const ld = join(dir, 'bin'); const lp = join(ld, 'wx-kit')
    await createLink(ld, lp, '/old')
    await expect(createLink(ld, lp, '/target')).rejects.toThrow()
  })
  it('force overwrites a conflicting wrapper', async () => {
    const ld = join(dir, 'bin'); const lp = join(ld, 'wx-kit')
    await createLink(ld, lp, '/old')
    await createLink(ld, lp, '/target', true)
    expect(await linkStatus(lp, '/target')).toBe('linked')
  })
  it('force upgrades a legacy symlink in place', async () => {
    const ld = join(dir, 'bin'); const lp = join(ld, 'wx-kit')
    mkdirSync(ld); symlinkSync('/target', lp)
    await createLink(ld, lp, '/target', true)
    expect(await linkStatus(lp, '/target')).toBe('linked')
    expect(readFileSync(lp, 'utf-8')).toBe(wrapperScript('/target'))
  })
})

describe('pathContains', () => {
  it('matches exact dir among PATH entries', () => {
    expect(pathContains('/home/u/bin', `/usr/bin:/home/u/bin:/bin`)).toBe(true)
    expect(pathContains('/home/u/bin', `/usr/bin:/bin`)).toBe(false)
    expect(pathContains('/home/u/bin', undefined)).toBe(false)
  })
})

describe('ensureInProfile', () => {
  it('adds the export line once, idempotent', async () => {
    const p = join(dir, '.zshrc')
    expect(await ensureInProfile(p)).toBe('added')
    expect(await ensureInProfile(p)).toBe('present')
    const lines = readFileSync(p, 'utf-8').split('\n').filter((l) => l.includes('export PATH'))
    expect(lines).toHaveLength(1)
  })
})

describe('profilePathFor', () => {
  it('maps shell to rc file', () => {
    expect(profilePathFor('/bin/zsh', '/h')).toBe(join('/h', '.zshrc'))
    expect(profilePathFor('/bin/bash', '/h')).toBe(join('/h', '.bashrc'))
    expect(profilePathFor(undefined, '/h')).toBe(join('/h', '.profile'))
  })
})
