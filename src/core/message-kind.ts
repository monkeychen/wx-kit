// src/core/message-kind.ts
// 消息类型:决定「正文该从哪里取」。
//
// 为什么要有这个模块:此前解析靠一串启发式猜测(#js_content 非空就当正文用),
// 对**没见过的类型永远不报错**——视频页的 #js_content 是个分享提示壳,于是
// 21.8 万字符的内联 JavaScript 被当正文写进 content.md,一路绿灯到用户手里(M35 修的就是它)。
// 类型是**开放集合**(付费/音频/直播等大概率另有编号),所以这里的原则是:
// 认识的按类型解析,不认识的走兜底 + **显式告警**,让新类型第一时间暴露。

/** 正文的取法,不是「文章长什么样」 */
export type MessageKind = 'article' | 'text' | 'picture' | 'video' | 'unknown'

/**
 * 实测到的 item_show_type:
 *   0  普通图文        → #js_content
 *   5  视频消息        → content_noencode
 *   8  图文消息/小绿书 → content_noencode + picture_page_info_list
 *   10 文字消息        → text_page_info.content
 *   11 未定性(样例是发布通告,有 #js_content,行为同普通图文)
 */
const KIND_BY_TYPE: Record<number, MessageKind> = {
  0: 'article',
  5: 'video',
  8: 'picture',
  10: 'text',
  11: 'article',
}

/**
 * 从页面脚本读 item_show_type。
 * 注意**不要用 `appmsg_type`**:它与 item_show_type 是正交的两个维度——
 * 实测存在 `appmsg_type=10002`(视频类)且 `item_show_type=10`(文字消息形态)的混合体,
 * 正文得按文字消息取,视频另行提取。把两者当同一个枚举判会判错(M35 的 isVideoMessage 就错在这)。
 */
export function readItemShowType(html: string): number | null {
  const m = html.match(/item_show_type:\s*'(\d+)'/)
  return m ? Number(m[1]) : null
}

export function kindOf(itemShowType: number | null): MessageKind {
  if (itemShowType == null) return 'unknown'
  return KIND_BY_TYPE[itemShowType] ?? 'unknown'
}

/** 兜底时给用户/agent 的话——说清「按什么处理了」，而不只是「有问题」 */
export function unknownKindWarning(itemShowType: number | null): string {
  return itemShowType == null
    ? '页面里没有读到消息类型,已按普通图文解析;若正文异常请反馈该链接。'
    : `未识别的消息类型 ${itemShowType},已按普通图文解析;若正文异常请反馈该链接。`
}

/**
 * 卡片/列表上的类型标识。**普通图文(0/11)与「读不到类型」一律不标**——
 * 文库里绝大多数是普通图文,全标一遍等于全不标;标识的价值在于**它出现时你就知道这篇不一样**。
 *
 * 两个容易踩的点:
 * - `8` 是**图片消息(小绿书)**,曾被标成「图文」——那正是不标标签的默认类型的名字,
 *   于是「标了图文的反而不是普通图文」,自相矛盾(M40 修)。
 * - `itemShowType` 缺失(M36 之前下的老文章)必须与「未知类型」区分:前者不标,
 *   后者标警示态。否则存量文库会一片 ⚠。
 */
export function kindTag(itemShowType?: number | null): { text: string; warn: boolean } | null {
  if (itemShowType == null) return null
  const kind = kindOf(itemShowType)
  if (kind === 'article') return null
  if (kind === 'unknown') return { text: '未知类型', warn: true }
  return { text: { video: '视频', text: '文字', picture: '图片' }[kind], warn: false }
}
