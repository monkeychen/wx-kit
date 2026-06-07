// electron/services/mp-fetch.ts
import axios from 'axios'
import type { MpFetch, MpSession, MpJson } from '../../src/core/mp-types'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** 把一次登录得到的 session 固化进闭包，返回带 cookie 的 mpFetch。 */
export function makeMpFetch(session: MpSession): MpFetch {
  const cookie = session.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  return async (endpoint, params) => {
    const res = await axios.get(endpoint, {
      params,
      timeout: 20000,
      headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/', Cookie: cookie },
    })
    return res.data as MpJson
  }
}
