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

// 图集样本：裁剪自 2026-09-13 真机 6ipCTiFtt0yQRXNeSDA1w（池建强 CatBar 笔记）——
// 多图笔记的图片是 <gallery uuid> 占位 + noteGallery.gallerys[G].fileUuids 有序引用；
// 真机实测 fileUuids 声明 3 张、images 池只回 2 张（cL57P… 缺失），缺图是现实场景。
const galleryBody = JSON.stringify({
  detail: {
    noteBase: {
      uuid: '6ipCTiFtt0yQRXNeSDA1w', title: '发布第一款 Mac App：CatBar', digest: '',
      content: '<p>产品图：</p><gallery uuid="T07Gx8UIZ_LYpekTbip_s"></gallery><p>尾部</p>',
      publicAt: 1789088785, uid: 'u1',
    },
    noteFile: {
      images: {
        'c2ifY_y93bc3gqtA6stE-': { url: 'https://x/orig-1.png', scale: { w_1200: 'https://x/w1200-1.png' } },
        'X0VmI0uXnqncojo0aJUy4': { url: 'https://x/orig-2.png', scale: { w_1200: 'https://x/w1200-2.png' } },
      },
      audios: {},
    },
    noteGallery: {
      gids: ['T07Gx8UIZ_LYpekTbip_s'],
      gallerys: {
        T07Gx8UIZ_LYpekTbip_s: {
          gid: 'T07Gx8UIZ_LYpekTbip_s',
          fileUuids: ['c2ifY_y93bc3gqtA6stE-', 'X0VmI0uXnqncojo0aJUy4', 'cL57P7QSnYHwKtNAh4_sn'],
        },
      },
    },
  },
  user: { base: { uid: 'u1', name: '池建强' } },
})

const paidBody = JSON.stringify({ code: 400, reason: 'ASSET_NOT_FOUND', message: 'asset not found', metadata: { skuId: '2056619449635758081' } })

const GALLERY_INFOS_URL = 'https://note.mowen.cn/api/note/wxa/v1/gallery/infos'
// 真机 2026-09-17 钉死：note/show 的 noteFile.images 池对图集**不保证完整**（本样本
// 3 声明 2 给出），墨问网页端靠第二个匿名接口 gallery/infos（{noteUuid, gids}）补齐。
const galleryInfosBody = JSON.stringify({
  gids: ['T07Gx8UIZ_LYpekTbip_s'],
  gallerys: { T07Gx8UIZ_LYpekTbip_s: { gid: 'T07Gx8UIZ_LYpekTbip_s', fileUuids: ['c2ifY_y93bc3gqtA6stE-', 'X0VmI0uXnqncojo0aJUy4', 'cL57P7QSnYHwKtNAh4_sn'] } },
  images: {
    'c2ifY_y93bc3gqtA6stE-': { url: 'https://x/orig-1.png', scale: { w_1200: 'https://x/w1200-1.png' } },
    'X0VmI0uXnqncojo0aJUy4': { url: 'https://x/orig-2.png', scale: { w_1200: 'https://x/w1200-2.png' } },
    'cL57P7QSnYHwKtNAh4_sn': { url: 'https://x/orig-3.png', scale: { w_1200: 'https://x/w1200-3.png' } },
  },
})

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

  it('图集：<gallery uuid> 按noteGallery.fileUuids 顺序展开为 img uuid 序列；池齐全时不额外请求', async () => {
    const calls: string[] = []
    const complete = JSON.parse(galleryBody)
    complete.detail.noteFile.images['cL57P7QSnYHwKtNAh4_sn'] = { url: 'https://x/orig-3.png', scale: { w_1200: 'https://x/w1200-3.png' } }
    const r = await fetchNoteShow('6ipCTiFtt0yQRXNeSDA1w', {
      fetchJson: async (url) => { calls.push(url); return { status: 200, text: JSON.stringify(complete) } },
    })
    // gallery 占位标签被展开，不再残留
    expect(r.contentHtml).not.toContain('<gallery')
    // 展开顺序与 fileUuids 一致（真机顺序：c2ifY → X0VmI → cL57P）
    expect(r.contentHtml).toContain('<img uuid="c2ifY_y93bc3gqtA6stE-"><img uuid="X0VmI0uXnqncojo0aJUy4"><img uuid="cL57P7QSnYHwKtNAh4_sn">')
    // 池齐全 → 无缺图告警，也无需补拉
    expect(r.warnings.some((w) => w.includes('cL57P7QSnYHwKtNAh4_sn'))).toBe(false)
    expect(calls).toEqual([SHOW_URL])
  })

  it('图集缺图：note/show 池不全 → 补调 gallery/infos({noteUuid,gids}) 合并缺失映射（真机 2026-09-17 钉死）', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const r = await fetchNoteShow('6ipCTiFtt0yQRXNeSDA1w', {
      fetchJson: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) })
        if (url === GALLERY_INFOS_URL) return { status: 200, text: galleryInfosBody }
        return { status: 200, text: galleryBody }
      },
    })
    // 第二次请求按墨问网页端同款协议补拉
    expect(calls[1]?.url).toBe(GALLERY_INFOS_URL)
    expect(calls[1]?.body).toEqual({ noteUuid: '6ipCTiFtt0yQRXNeSDA1w', gids: ['T07Gx8UIZ_LYpekTbip_s'] })
    // 三张图都有映射（第三张来自 gallery/infos），不再有缺图告警
    expect(r.images.size).toBe(3)
    expect(r.images.get('cL57P7QSnYHwKtNAh4_sn')).toBe('https://x/w1200-3.png')
    expect(r.warnings.some((w) => w.includes('图片映射缺失'))).toBe(false)
  })

  it('图集缺图但 gallery/infos 失败：图片照旧进缺图告警，笔记不失败', async () => {
    const r = await fetchNoteShow('6ipCTiFtt0yQRXNeSDA1w', {
      fetchJson: async (url) => (url === GALLERY_INFOS_URL ? { status: 500, text: 'boom' } : { status: 200, text: galleryBody }),
    })
    expect(r.images.size).toBe(2)
    expect(r.warnings.some((w) => w.includes('cL57P7QSnYHwKtNAh4_sn'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('图集图片补拉失败'))).toBe(true)
  })

  it('图集 gid 无定义（被删/接口异常）→ warning + 原标签保留，不炸；无 gid 也不触发补拉', async () => {
    const galleryObj = JSON.parse(galleryBody)
    galleryObj.detail.noteGallery = { gids: [], gallerys: {} }
    const broken = JSON.stringify(galleryObj)
    const calls: string[] = []
    const r = await fetchNoteShow('6ipCTiFtt0yQRXNeSDA1w', {
      fetchJson: async (url) => { calls.push(url); return { status: 200, text: broken } },
    })
    expect(r.contentHtml).toContain('<gallery uuid="T07Gx8UIZ_LYpekTbip_s">')
    expect(r.warnings.some((w) => w.includes('图集定义缺失') && w.includes('T07Gx8UIZ_LYpekTbip_s'))).toBe(true)
    expect(calls).toEqual([SHOW_URL])   // 没有图集定义就没有补拉
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

  it('noteFlag.hasVideo 读出（v0.12.2 R1：视频标记，缺省 false）', async () => {
    const withVideo = JSON.stringify({
      detail: {
        noteBase: { uuid: 'n1', title: 't', digest: '', content: '<p>x</p>', publicAt: 1, uid: 'u' },
        noteFlag: { isPublic: true, hasFee: false, hasVideo: true },
        noteFile: null,
      },
      user: { base: { uid: 'u', name: 'n' } },
    })
    const r = await fetchNoteShow('Ni2ZIpWVBtm1qu8sAmihb', { fetchJson: ok(withVideo) })
    expect(r.hasVideo).toBe(true)
    // okBody 的 noteFlag 无 hasVideo 字段 → false
    const plain = await fetchNoteShow('Ni2ZIpWVBtm1qu8sAmihb', { fetchJson: ok(okBody) })
    expect(plain.hasVideo).toBe(false)
  })
})
