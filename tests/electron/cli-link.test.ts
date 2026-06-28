import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { linkStatus, createLink, pathContains, ensureInProfile, profilePathFor } from '../../electron/services/cli-link'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-link-')) })

describe('linkStatus', () => {
  it('unlinked when missing', async () => {
    expect(await linkStatus(join(dir, 'wx-kit'), '/target')).toBe('unlinked')
  })
  it('linked when symlink points to target', async () => {
    const lp = join(dir, 'wx-kit'); symlinkSync('/target', lp)
    expect(await linkStatus(lp, '/target')).toBe('linked')
  })
  it('conflict when symlink points elsewhere', async () => {
    const lp = join(dir, 'wx-kit'); symlinkSync('/other', lp)
    expect(await linkStatus(lp, '/target')).toBe('conflict')
  })
  it('conflict when a regular file occupies the path', async () => {
    const lp = join(dir, 'wx-kit'); writeFileSync(lp, 'x')
    expect(await linkStatus(lp, '/target')).toBe('conflict')
  })
})

describe('createLink', () => {
  it('creates dir + symlink to target', async () => {
    const ld = join(dir, 'bin'); const lp = join(ld, 'wx-kit')
    await createLink(ld, lp, '/target')
    expect(await linkStatus(lp, '/target')).toBe('linked')
  })
  it('force overwrites a conflicting entry', async () => {
    const ld = join(dir, 'bin'); const lp = join(ld, 'wx-kit')
    await createLink(ld, lp, '/old')
    await createLink(ld, lp, '/target', true)
    expect(await linkStatus(lp, '/target')).toBe('linked')
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
