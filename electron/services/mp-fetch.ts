// electron/services/mp-fetch.ts
import type { MpFetch } from '../../src/core/mp-types'
import type { MpRequestGateway } from './mp-request-gateway'

/** 后台 API 统一走 gateway，业务层不再自行构造请求身份与传输层。 */
export function makeMpFetch(gateway: MpRequestGateway): MpFetch {
  return async (endpoint, params) => gateway.requestJson(
    endpoint.includes('/searchbiz') ? 'account-search' : 'article-list',
    endpoint,
    params,
  )
}
