// 临时诊断脚本(用完即删,不进产品)。
// 目的:微信对当前登录账号触发 200013 频控后,区分到底是
//   - 「端点级」:appmsgpublish 被单独限、appmsg?type=9 仍正常(→ 换回去能取数)
//   - 「账号级」:两个端点都 200013(→ 换接口无用,得等账号解封)
// 做法:同一 session + 同一 fakeid,串行各打一次,对比 ret 与返回结构。
// 代理:本机 8118 会让请求卡死,脚本内已清 env。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) delete process.env[k]

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const sessionPath = path.join(os.homedir(), 'Library/Application Support/wx-kit/mp-session.json')
const subsPath = path.join(os.homedir(), 'Documents/wx-kit/subscriptions.json')

const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
const token = session.token
const cookie = session.cookies.map((c) => `${c.name}=${c.value}`).join('; ')

const subs = JSON.parse(fs.readFileSync(subsPath, 'utf8'))
const arr = Array.isArray(subs) ? subs : subs.accounts || subs.subscriptions || []
const target = arr[0]
const fakeid = target.fakeid
console.log(`靶子账号: ${target.nickname} (${fakeid})  token: ${String(token).slice(0, 8)}…\n`)

const common = { lang: 'zh_CN', f: 'json', ajax: '1', token, fakeid }

const endpoints = [
  {
    name: 'appmsgpublish (现状)',
    url: 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish',
    params: { sub: 'list', sub_action: 'list_ex', begin: '0', count: '20', type: '101_1', free_publish_type: '1', search_field: 'null', query: '', ...common },
  },
  {
    name: 'appmsg?type=9 (M36 前旧接口)',
    url: 'https://mp.weixin.qq.com/cgi-bin/appmsg',
    params: { action: 'list_ex', begin: '0', count: '5', type: '9', query: '', ...common },
  },
]

const qs = (o) => new URLSearchParams(o).toString()

async function probe(ep) {
  const u = `${ep.url}?${qs(ep.params)}`
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/', Cookie: cookie } })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 返回的是 HTML(如登录页),非 JSON */ }
    const ret = json?.base_resp?.ret
    const errMsg = json?.base_resp?.err_msg
    let sample = '—'
    if (json) {
      const pp = typeof json.publish_page === 'string' ? JSON.parse(json.publish_page) : json.publish_page
      sample = `publish_list=${pp?.publish_list?.length ?? '—'} total=${pp?.total_count ?? '—'} | app_msg_list=${json.app_msg_list?.length ?? '—'}`
    }
    console.log(`【${ep.name}】`)
    console.log(`  HTTP ${res.status}  ret=${ret ?? '—(非 JSON)'}  ${errMsg ? 'err_msg=' + errMsg : ''}`)
    console.log(`  概要: ${sample}`)
    if (!json) console.log(`  原始(前 200 字): ${text.slice(0, 200)}`)
    console.log()
  } catch (e) {
    console.log(`【${ep.name}】请求异常: ${e.message}\n`)
  }
}

for (const ep of endpoints) {
  await probe(ep)
  await new Promise((r) => setTimeout(r, 2000)) // 串行 + 间隔,别并发激怒频控
}
