// tests/core/mowen/metadata.test.ts
// fixture 来自 2026-09-11 真机 mocli v0.5.4 实测（裁剪），字段形态不猜。
import { describe, it, expect } from 'vitest'
import { searchUsers, listUserNotes, authInfo, mapNoteList, mapReplyUsers, parseMocliJson } from '../../../src/core/mowen/metadata'
import type { MocliRunner } from '../../../src/core/mowen/types'

const USER_SEARCH_RAW = JSON.stringify({
  code: 0, status: 'OK',
  reply: {
    uids: ['vtv_PV1fEMBb-8_BPlmDu', '0C-bLHmOmxiYpzgIxJaVS'],
    users: {
      'vtv_PV1fEMBb-8_BPlmDu': { uid: 'vtv_PV1fEMBb-8_BPlmDu', name: '池建强', intro: '墨问西东和极客时间创始人。', home_url: 'https://note.mowen.cn/user/vtv_PV1fEMBb-8_BPlmDu?from=mocli' },
      '0C-bLHmOmxiYpzgIxJaVS': { uid: '0C-bLHmOmxiYpzgIxJaVS', name: '阿苟', intro: 'Java程序员。', home_url: 'https://note.mowen.cn/user/0C-bLHmOmxiYpzgIxJaVS?from=mocli' },
    },
  },
})

const HOMEPAGE_RAW = JSON.stringify({
  code: 0, status: 'OK',
  reply: {
    note_ids: ['Ni2ZIpWVBtm1qu8sAmihb', 'affxEvxYbe4VqbtDUjukD'],
    notes: {
      Ni2ZIpWVBtm1qu8sAmihb: {
        note_id: 'Ni2ZIpWVBtm1qu8sAmihb', uid: 'vtv_PV1fEMBb-8_BPlmDu',
        title: '因为 Astra 过于优秀（废Token），200 刀 的计', brief: '摘要…',
        url: 'https://note.mowen.cn/detail/Ni2ZIpWVBtm1qu8sAmihb?from=mocli',
        created_at: 1789088785, updated_at: 1789088974, public_at: 1789088785,
        flag: { with_text: true, with_image: true },
        content: { word_count: 401 },
        status: { public_status: 1, audit_status: 64 },
        stat: { view: 267, favor: 11, share: 3, comment: 2 },
        embed: {},
      },
      // 字段残缺的条目（付费笔记缺 content/stat 是真实形态之一）——缺省 null 不猜
      affxEvxYbe4VqbtDUjukD: {
        note_id: 'affxEvxYbe4VqbtDUjukD', uid: 'vtv_PV1fEMBb-8_BPlmDu',
        title: 'Astra 这么猛吗？都要断供了', brief: '',
        url: 'https://note.mowen.cn/detail/affxEvxYbe4VqbtDUjukD?from=mocli',
        flag: { with_text: true, with_fee: true },
      },
    },
    users: {},
  },
})

const AUTH_RAW = JSON.stringify({
  code: 0, status: 'OK',
  reply: { auth: { api_key: 'MQ4Qz4IBOWP**********ACE5q47opaE', mo_uid: '4L8RrxEaExmHJOf9xrGLo' }, profile: null },
})

// 全站搜索响应（2026-09-17 真机「AI 编程」实测形态，裁剪）：notes 条目带 uid，
// reply.users 按 uid 给完整作者映射——搜索结果跨作者，authorName 从这里拼（M65）。
const NOTE_SEARCH_RAW = JSON.stringify({
  code: 0, status: 'OK',
  reply: {
    note_ids: ['n1AI编程', 'n2AI编程'],
    notes: {
      n1AI编程: {
        note_id: 'n1AI编程', uid: 'u-chijq', title: 'Vibe Coding 实践', brief: '摘要甲',
        url: 'https://note.mowen.cn/detail/n1AI编程?from=mocli',
        public_at: 1789088785, flag: { with_text: true },
        content: { word_count: 300 }, stat: { view: 1200, favor: 33 },
      },
      n2AI编程: {
        note_id: 'n2AI编程', uid: 'u-agou', title: 'Astra 断供评', brief: '摘要乙',
        url: 'https://note.mowen.cn/detail/n2AI编程?from=mocli',
        public_at: 1789000000, flag: { with_text: true, with_fee: true },
      },
    },
    users: {
      'u-chijq': { uid: 'u-chijq', name: '池建强', intro: '墨问西东创始人。', home_url: 'https://note.mowen.cn/user/u-chijq' },
      'u-agou': { uid: 'u-agou', name: '阿苟', intro: 'Java程序员。', home_url: 'https://note.mowen.cn/user/u-agou' },
    },
  },
})

const VALIDATE_FAIL_RAW = JSON.stringify({ code: 2, status: 'FAIL', reason: 'VALIDATE', msg: 'query is required' })

function runner(stdout: string, code = 0): MocliRunner {
  return async () => ({ code, stdout, stderr: '' })
}

describe('parseMocliJson 失败通道', () => {
  it('stdout/stderr 都不是 JSON 且 stderr 有诊断信息 → BAD_OUTPUT 消息带 stderr 摘要（如 env: node 解析失败）', () => {
    expect(() => parseMocliJson('', 'env: node: No such file or directory\n'))
      .toThrow(/env: node: No such file or directory/)
  })
  it('stdout 非法但 stderr 是合法 JSON → 按 mocli 失败通道解析（透传 reason/msg）', () => {
    expect(() => parseMocliJson('', VALIDATE_FAIL_RAW)).toThrow('query is required')
  })
  it('stdout/stderr 都空 → 保持通用提示，不追加空的 stderr 摘要', () => {
    expect(() => parseMocliJson('', '')).toThrow('mocli 输出不是合法 JSON（可能是版本过旧或被外层工具污染）')
  })
})

describe('searchUsers', () => {
  it('按 uids 顺序映射 users，snake→camel', async () => {
    const users = await searchUsers(runner(USER_SEARCH_RAW), '池建强')
    expect(users.map((u) => u.uid)).toEqual(['vtv_PV1fEMBb-8_BPlmDu', '0C-bLHmOmxiYpzgIxJaVS'])
    expect(users[0]).toEqual({
      uid: 'vtv_PV1fEMBb-8_BPlmDu', name: '池建强', intro: '墨问西东和极客时间创始人。',
      homeUrl: 'https://note.mowen.cn/user/vtv_PV1fEMBb-8_BPlmDu?from=mocli',
    })
  })
  it('mocli 失败（VALIDATE）抛 MocliFailed 携带 reason/msg', async () => {
    await expect(searchUsers(runner(VALIDATE_FAIL_RAW, 2), '')).rejects.toMatchObject({
      name: 'MocliFailed', reason: 'VALIDATE', message: expect.stringContaining('query is required'),
    })
  })
  it('失败 JSON 在 stderr（真机实测 mocli 失败走 stderr）也能解析', async () => {
    const run: MocliRunner = async () => ({ code: 2, stdout: '', stderr: VALIDATE_FAIL_RAW })
    await expect(searchUsers(run, '')).rejects.toMatchObject({ name: 'MocliFailed', reason: 'VALIDATE' })
  })
})

describe('listUserNotes', () => {
  it('note_ids 顺序为准映射 notes；缺省字段落 null', async () => {
    const notes = await listUserNotes(runner(HOMEPAGE_RAW), 'vtv_PV1fEMBb-8_BPlmDu', { count: 2 })
    expect(notes.length).toBe(2)
    expect(notes[0]).toMatchObject({ noteId: 'Ni2ZIpWVBtm1qu8sAmihb', title: '因为 Astra 过于优秀（废Token），200 刀 的计', withFee: false, wordCount: 401, viewCount: 267 })
    expect(notes[1]).toMatchObject({ noteId: 'affxEvxYbe4VqbtDUjukD', withFee: true, wordCount: null, viewCount: null, publicAt: null })
  })
  it('flags 透传 --filter/--recent/--count', async () => {
    const seen: string[][] = []
    const run: MocliRunner = async (args) => { seen.push(args); return { code: 0, stdout: HOMEPAGE_RAW, stderr: '' } }
    await listUserNotes(run, 'u1', { filter: 'fee', recent: '3d', count: 5 })
    expect(seen[0]).toEqual(['notes', 'homepage', '--uid', 'u1', '--filter', 'fee', '--recent', '3d', '--count', '5'])
  })
  it('code!==0 且退出码 0 也按失败处理（以 JSON code 为准）', async () => {
    await expect(listUserNotes(runner(VALIDATE_FAIL_RAW), 'u1')).rejects.toMatchObject({ name: 'MocliFailed', reason: 'VALIDATE' })
  })
})

describe('authInfo', () => {
  it('取 reply.auth.mo_uid', async () => {
    expect(await authInfo(runner(AUTH_RAW))).toEqual({ moUid: '4L8RrxEaExmHJOf9xrGLo' })
  })
})

describe('mapNoteList / mapReplyUsers（M65：搜索结果的作者拼接）', () => {
  it('搜索响应：条目 authorName 按 reply.users[uid].name 拼接（跨作者）', () => {
    const reply = JSON.parse(NOTE_SEARCH_RAW).reply
    const notes = mapNoteList(reply)
    expect(notes[0]).toMatchObject({ noteId: 'n1AI编程', authorName: '池建强' })
    expect(notes[1]).toMatchObject({ noteId: 'n2AI编程', authorName: '阿苟' })
  })

  it('homepage 形态（users 为空对象/无键）：authorName 不设，零行为变更', () => {
    const reply = JSON.parse(HOMEPAGE_RAW).reply
    const notes = mapNoteList(reply)
    expect(notes.every((n) => n.authorName === undefined)).toBe(true)
    const noUsers = mapNoteList({ note_ids: ['x'], notes: {} })
    expect(noUsers[0]?.authorName).toBeUndefined()
  })

  it('users 缺某条目 uid 的映射：该条 authorName undefined，其余正常（不崩）', () => {
    const reply = JSON.parse(NOTE_SEARCH_RAW).reply
    delete reply.users['u-agou']
    const notes = mapNoteList(reply)
    expect(notes[0]?.authorName).toBe('池建强')
    expect(notes[1]?.authorName).toBeUndefined()
  })

  it('mapReplyUsers：返回完整 MowenUser[]（含 intro/homeUrl，供 GUI 作者联动）', () => {
    const reply = JSON.parse(NOTE_SEARCH_RAW).reply
    const authors = mapReplyUsers(reply)
    expect(authors).toHaveLength(2)
    expect(authors[0]).toEqual({
      uid: 'u-chijq', name: '池建强', intro: '墨问西东创始人。', homeUrl: 'https://note.mowen.cn/user/u-chijq',
    })
    expect(mapReplyUsers({})).toEqual([])
  })
})
