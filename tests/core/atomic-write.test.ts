import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fsp from 'node:fs/promises'
import { atomicWriteFile } from '../../src/core/atomic-write'

const tmp = () => mkdtempSync(join(tmpdir(), 'wxk-atomic-'))

describe('atomicWriteFile', () => {
  it('writes content (round-trip) and leaves no temp file behind', async () => {
    const dir = tmp(); const f = join(dir, 'x.json')
    await atomicWriteFile(f, 'hello')
    expect(readFileSync(f, 'utf-8')).toBe('hello')
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('cleans up the temp file and leaves the original intact when rename fails', async () => {
    const dir = tmp(); const f = join(dir, 'x.json')
    await atomicWriteFile(f, 'v1')
    const failing = { writeFile: fsp.writeFile, rename: async () => { throw new Error('boom') } }
    await expect(atomicWriteFile(f, 'v2', failing)).rejects.toThrow('boom')
    expect(readFileSync(f, 'utf-8')).toBe('v1')
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
})
