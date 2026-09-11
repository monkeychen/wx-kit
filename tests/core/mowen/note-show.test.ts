// tests/core/mowen/note-show.test.ts
// fixture 裁剪自 2026-09-11/12 真机 note/show 响应（带图笔记 Ni2ZIpWVBtm1qu8sAmihb /
// 付费笔记 -Bh35Ogyfr7OQTs-GGsCu / 合集引用 05-oJyNajKAzUBD42qYjt）。
import { describe, it, expect } from 'vitest'
import { fetchNoteShow, MowenNoteUnavailable, MowenShowFailed } from '../../../src/core/mowen/note-show'

const SHOW_URL = 'https://note.mowen.cn/api/note/wxa/v1/note/show'

const okBody = JSON.stringify({
  detail: {
    noteBase: {
      uuid: 'Ni2ZIpWVBtm1qu8sAmihb', title: '因为 Astra 过于优秀', digest: '摘要…',
      content: '<p>正文</p><img uuid="NGQaWuJHAcNMk5lcQx-hx"><img uuid="MISSING-UUID-123456789">',
      createdAt: '1789088785', publicAt: 1789088785, uid: 'vtv_PV1fEMBb-8_BPlmDu',
    },
    noteFlag: { isPublic: true, hasFee: false },
    noteFile: {
      images: {
        'NGQaWuJHAcNMk5lcQx-hx': { url: 'https://priv-sdn-001.mowen.cn/orig.png', scale: { w_1200: 'https://priv-sdn-001.mowen.cn/w1200.png' } },
      },
      audios: [{ url: 'https://audio.example/a.m4a' }],
    },
  },
  user: { base: { uid: 'vtv_PV1fEMBb-8_BPlmDu', name: '池建强' } },
})

const albumBody = JSON.stringify({
  detail: {
    noteBase: { uuid: '05-oJyNajKAzUBD42qYjt', title: 'CatBar 发布 0.7', digest: '', content: '<p>头部正文</p>', publicAt: 1789000000, uid: 'u1' },
    noteRef: ['6ipCTiFtt0yQRXNeSDA1w', 'uhMLoeBwwxLEglwJ6-DV7'],
    noteFile: null,
  },
  user: { base: { uid: 'u1', name: '池建强' } },
})

const paidBody = JSON.stringify({ code: 400, reason: 'ASSET_NOT_FOUND', message: 'asset not found', metadata: { skuId: '2056619449635758081' } })

type FetchJson = (url: string, init: { method: 'POST'; body: string; headers: Record<string, string> }) => Promise<{ status: number; text: string }>
const ok = (text: string, status = 200): FetchJson => async (url, init) => {
  expect(url).toBe(SHOW_URL)
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({ uuid: 'Ni2ZIpWVBtm1qu8sAmihb' })
  expect(init.headers['Content-Type']).toBe('application/json')
  return { status, text }
}

describe('fetchNoteShow', () => {
  it('成功：解析正文/作者/publicAt，图片映射取 w_1200，音频入列表', async () => {
    const r = await fetchNoteShow('Ni2ZIpWVBtm1qu8sAmihb', { fetchJson: ok(okBody) })
    expect(r.title).toBe('因为 Astra 过于优秀')
    expect(r.authorName).toBe('池建强')
    expect(r.publicAt).toBe(1789088785)
    expect(r.images.get('NGQaWuJHAcNMk5lcQx-hx')).toBe('https://priv-sdn-001.mowen.cn/w1200.png')
    expect(r.audios).toEqual(['https://audio.example/a.m4a'])
    // 正文里的 uuid 在映射缺失 → warning，不炸
    expect(r.warnings.some((w) => w.includes('MISSING-UUID-123456789'))).toBe(true)
  })

  it('publicAt 是字符串形态（真机实测 "1789088785"）也能解析', async () => {
    const stringTimeBody = okBody.replace('"publicAt":1789088785', '"publicAt":"1789088785"')
    const r = await fetchNoteShow('Ni2ZIpWVBtm1qu8sAmihb', { fetchJson: ok(stringTimeBody) })
    expect(r.publicAt).toBe(1789088785)
  })

  it('无图笔记 noteFile:null（真机边界）→ images 空、不炸', async () => {
    const r = await fetchNoteShow('05-oJyNajKAzUBD42qYjt', { fetchJson: async () => ({ status: 200, text: albumBody }) })
    expect(r.images.size).toBe(0)
    expect(r.refNoteIds).toEqual(['6ipCTiFtt0yQRXNeSDA1w', 'uhMLoeBwwxLEglwJ6-DV7'])
  })

  it('付费笔记（400 ASSET_NOT_FOUND）→ MowenNoteUnavailable', async () => {
    await expect(fetchNoteShow('-Bh35Ogyfr7OQTs-GGsCu', { fetchJson: async () => ({ status: 400, text: paidBody }) }))
      .rejects.toBeInstanceOf(MowenNoteUnavailable)
  })

  it('其他非 200 → MowenShowFailed 携带 status', async () => {
    await expect(fetchNoteShow('x', { fetchJson: async () => ({ status: 502, text: 'bad gateway' }) }))
      .rejects.toMatchObject({ name: 'MowenShowFailed', status: 502 })
  })

  it('200 但非 JSON → MowenShowFailed', async () => {
    await expect(fetchNoteShow('x', { fetchJson: async () => ({ status: 200, text: '<html>oops</html>' }) }))
      .rejects.toBeInstanceOf(MowenShowFailed)
  })
})
