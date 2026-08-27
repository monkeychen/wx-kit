// tests/core/weread/client.test.ts
import { describe, it, expect } from 'vitest'
import { WereadClient, type WereadFetch } from '../../../src/core/weread/client'

const BOOK = 'MP_WXS_3634850725'

describe('WereadClient (Plan B Web API)', () => {
  it('bookInfo 返回基础信息', async () => {
    const f: WereadFetch = async () => ({
      name: '测试号',
      avatar: 'http://avatar',
    })
    const info = await new WereadClient(f).bookInfo(BOOK)
    expect(info.title).toBe('测试号')
    expect(info.coverImg).toBe('http://avatar')
    expect(info.bookId).toBe(BOOK)
  })

  it('getLatestArticle 返回最新一篇 Cover', async () => {
    const f: WereadFetch = async () => ({
      reviewId: `${BOOK}_TOKEN123`,
      title: '最新文章标题',
      pic: 'http://pic',
      name: '公众号名'
    })
    const cover = await new WereadClient(f).getLatestArticle('MzYzNDg1MDcyNQ==') // base64 fakeid
    expect(cover).not.toBeNull()
    expect(cover!.title).toBe('最新文章标题')
    expect(cover!.url).toBe('https://mp.weixin.qq.com/s/TOKEN123')
  })
})
