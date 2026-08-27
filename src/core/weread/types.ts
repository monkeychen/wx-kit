// src/core/weread/types.ts
// 微信读书移动端（i.weread.qq.com）链路的核心类型。
// 接口形态依据 2026-08 现行公开实现（johamwon/wechrss、rachelos/we-mp-rss#442）。

/** 登录凭据（扫码 /login 换得；0600 落盘 weread-creds.json）。 */
export interface WereadCredentials {
  vid: string
  accessToken: string
  refreshToken: string
  /** 登录时生成的设备标识；refresh 续期必须用同一个，否则签名对不上。 */
  deviceId: string
  /** 显示名（登录响应 user.name）。 */
  name: string
  updatedAt: number
}

/** 扫码登录的第一步产物：渲染层据此画二维码，uuid 供轮询。 */
export interface WereadQrStart {
  uuid: string
  /** 微信确认页 URL；二维码内容即它。 */
  confirmUrl: string
}

/** 轮询扫码状态（wx_errcode 状态机）。 */
export type WereadQrPoll =
  | { state: 'waiting' }                      // 408：未扫
  | { state: 'scanned' }                      // 404：已扫待确认
  | { state: 'confirmed'; wxCode: string }    // 405：确认，拿 code 换凭据
  | { state: 'expired' }                      // 402：码过期，需重新生成
  | { state: 'declined' }                     // 403：手机上取消

/** /book/info 的最小口径（我们只关心公众号名与头像）。 */
export interface WereadBookInfo {
  bookId: string
  title: string
  author: string
  coverImg: string
}

/**
 * 列表条目解析产物。`readNum`/`likeNum` 是微信读书链路独有的新数据
 * （MP 后台时代拿不到别人号的阅读数）；接口没给就缺省。
 */
export interface WereadChapter {
  reviewId: string
  title: string
  createTime: number          // unix 秒
  /** mp.weixin 原文链接（列表直接给或由 originalId 拼出）。 */
  url: string
  digest: string
  coverUrl: string
  readNum?: number
  likeNum?: number
}
