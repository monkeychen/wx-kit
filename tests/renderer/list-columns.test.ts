import { describe, it, expect } from 'vitest'
import { buildListColumns, clampColWidth, nextSort, DEFAULT_LIST_WIDTHS, MIN_COL } from '../../src/renderer/list-columns'

describe('buildListColumns', () => {
  it('non-grouped: thumb | title-1fr | account | publish | download | actions', () => {
    expect(buildListColumns({ account: 132, publish: 150, download: 110 }, false))
      .toBe('44px minmax(0, 1fr) 132px 150px 110px 172px')
  })
  it('grouped: drops the account column', () => {
    expect(buildListColumns({ account: 132, publish: 150, download: 110 }, true))
      .toBe('44px minmax(0, 1fr) 150px 110px 172px')
  })
})

describe('clampColWidth', () => {
  it('floors at MIN_COL and rounds', () => {
    expect(clampColWidth(10)).toBe(MIN_COL)
    expect(clampColWidth(150.7)).toBe(151)
  })
})

describe('nextSort', () => {
  it('clicking a new key uses its default direction', () => {
    expect(nextSort({ key: 'download', dir: 'desc' }, 'title')).toEqual({ key: 'title', dir: 'asc' })
    expect(nextSort({ key: 'title', dir: 'asc' }, 'publish')).toEqual({ key: 'publish', dir: 'desc' })
  })
  it('clicking the same key flips direction', () => {
    expect(nextSort({ key: 'publish', dir: 'desc' }, 'publish')).toEqual({ key: 'publish', dir: 'asc' })
    expect(nextSort({ key: 'publish', dir: 'asc' }, 'publish')).toEqual({ key: 'publish', dir: 'desc' })
  })
})

it('DEFAULT_LIST_WIDTHS matches settings default', () => {
  expect(DEFAULT_LIST_WIDTHS).toEqual({ account: 132, publish: 150, download: 110 })
})
