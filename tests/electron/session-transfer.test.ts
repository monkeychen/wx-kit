import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSessionShape, exportSession, importSession } from '../../electron/services/session-transfer'

const GOOD = { token: '123456', cookies: [{ name: 'a', value: 'b' }], timestamp: 1 }

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-sess-')) })

describe('validateSessionShape', () => {
  it('accepts a well-formed session', () => {
    const r = validateSessionShape(GOOD)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session.token).toBe('123456')
  })
  it.each([
    ['not an object', 'x'],
    ['missing token', { cookies: [] }],
    ['non-string token', { token: 42, cookies: [] }],
    ['empty token', { token: '', cookies: [] }],
    ['cookies not array', { token: 't', cookies: {} }],
    ['cookie item missing name', { token: 't', cookies: [{ value: 'v' }] }],
    ['cookie item non-string value', { token: 't', cookies: [{ name: 'n', value: 7 }] }],
  ])('rejects %s', (_label, raw) => {
    expect(validateSessionShape(raw).ok).toBe(false)
  })
})

describe('exportSession', () => {
  it('copies the session file with 0600 mode', async () => {
    const src = join(dir, 'mp-session.json'); writeFileSync(src, JSON.stringify(GOOD))
    const out = join(dir, 'exported.json')
    await exportSession(src, out)
    expect(JSON.parse(readFileSync(out, 'utf-8'))).toEqual(GOOD)
    expect(statSync(out).mode & 0o777).toBe(0o600)
  })
  it('throws when no session exists', async () => {
    await expect(exportSession(join(dir, 'absent.json'), join(dir, 'out.json'))).rejects.toThrow()
  })
})

describe('importSession', () => {
  it('validates then writes to the session path with 0600 mode', async () => {
    const f = join(dir, 'incoming.json'); writeFileSync(f, JSON.stringify(GOOD))
    const dest = join(dir, 'mp-session.json')
    const s = await importSession(f, dest)
    expect(s.token).toBe('123456')
    expect(JSON.parse(readFileSync(dest, 'utf-8')).token).toBe('123456')
    expect(statSync(dest).mode & 0o777).toBe(0o600)
  })
  it('rejects invalid shape and leaves the existing session untouched', async () => {
    const dest = join(dir, 'mp-session.json'); writeFileSync(dest, JSON.stringify(GOOD))
    const bad = join(dir, 'bad.json'); writeFileSync(bad, JSON.stringify({ nope: 1 }))
    await expect(importSession(bad, dest)).rejects.toThrow()
    expect(JSON.parse(readFileSync(dest, 'utf-8'))).toEqual(GOOD)   // 未被破坏
  })
  it('rejects non-JSON input without creating the session file', async () => {
    const bad = join(dir, 'bad.txt'); writeFileSync(bad, 'not json')
    const dest = join(dir, 'mp-session.json')
    await expect(importSession(bad, dest)).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
  })
})
