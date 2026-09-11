// src/core/mowen/download-mowen-note.ts
// 墨问笔记下载闭环（M61）：note/show → 适配 → exporter 复用 → library 入库。
// 主键 mowen_<uuid>（确定性、可读，与微信 mid_idx / h_hash 主键空间天然隔离——不走 articleId，
// 它对 mowen URL 只能算出不可读哈希）。
// 合集：引用块无条件渲染（mowen-to-article）；递归下载是显式开关（expandRefs，深度上限 3，
// 付费子笔记 unavailable 如实进 refResults，不阻塞父级）。
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { DownloadFormat, DownloadItemResult } from '../types'
import type { DownloadArticleDeps } from '../download-article'
import { extractMowenNoteId, normalizeMowenUrl } from './url'
import { fetchNoteShow, type NoteShowResult, type NoteShowDeps } from './note-show'
import { MowenNoteUnavailable } from './errors'
import { noteShowToParsedArticle } from './mowen-to-article'
import { articleDirName, dedupeDirName, sanitizeName } from '../paths'

const REF_DEPTH_LIMIT = 3

export interface MowenDownloadDeps extends Omit<DownloadArticleDeps, 'fetchHtml'> {
  /** 注入点：缺省用真 fetchNoteShow（含限速由调用方决定是否包） */
  fetchNoteShow?: (uuid: string) => Promise<NoteShowResult>
  /** 递归展开引用子笔记（GUI 子勾选 / CLI --expand-refs） */
  expandRefs?: boolean
}

export interface RefDownloadRecord { uuid: string; ok: boolean; skipped?: boolean; unavailable?: boolean; title?: string }

export async function downloadMowenNote(
  input: string,
  formats: DownloadFormat[],
  deps: MowenDownloadDeps,
  depth = 0,
): Promise<DownloadItemResult & { refResults?: { total: number; unavailable: string[] } }> {
  const uuid = extractMowenNoteId(input)
  if (!uuid) throw new Error(`不是墨问笔记地址（note.mowen.cn/detail/<id> 或裸 noteId）: ${input}`)
  const url = normalizeMowenUrl(input)!
  const id = `mowen_${uuid}`

  if (await deps.library.has(id)) {
    const existing = await deps.library.get(id)
    return { url, ok: true, id, skipped: true, title: existing?.title, dir: existing?.dir }
  }

  deps.onProgress?.({ phase: 'fetch', message: '获取墨问笔记' })
  const show = deps.fetchNoteShow
    ? await deps.fetchNoteShow(uuid)
    : await fetchNoteShow(uuid, { fetchJson: defaultFetchJson })
  const parsed = noteShowToParsedArticle(show)

  if (!parsed.title.trim()) {
    throw new MowenNoteUnavailable(`未取到笔记标题（可能被风控或接口变更）: ${url}`)
  }

  const accountDir = join(deps.libraryRoot, sanitizeName(parsed.account || 'unknown'))
  const datePrefix = parsed.publishTime.slice(0, 10)
  const base = articleDirName(datePrefix, parsed.title)
  const dirName = dedupeDirName(base, (name) => existsSync(join(accountDir, name)))
  const dir = join(accountDir, dirName)

  deps.onProgress?.({ phase: 'export', message: '生成文件' })
  const meta = await exportParsed({ parsed, id, sourceUrl: url, dir, formats }, deps)
  await deps.library.add(meta)

  // —— 合集递归（显式开关）：子笔记走同一条下载路径，判重/限速/unavailable 天然复用 ——
  let refResults: { total: number; unavailable: string[] } | undefined
  if (deps.expandRefs && show.refNoteIds.length) {
    // REF_DEPTH_LIMIT = 最多展开的引用层数（本笔记为第 1 层）。
    // 本层 depth 已 >= 上限 → 不再展开下一层（l4 是第 4 层，l3 的 depth=2 时还能下它，
    // 但 l4 自己 depth=3 的展开会被拦住——链式第 4 层不入库）。
    if (depth + 1 >= REF_DEPTH_LIMIT) {
      deps.onWarning?.(`引用展开已达上限 ${REF_DEPTH_LIMIT} 层，更深层级未下载（uuid=${uuid}）`)
    } else {
      const unavailable: string[] = []
      let total = 0
      for (const childUuid of show.refNoteIds) {
        // 子笔记已在库（含「兄弟引用同一篇」）→ 判重跳过，不计入本轮下载量
        if (await deps.library.has(`mowen_${childUuid}`)) continue
        total++
        // 深度内递归；子笔记沿链继续展开（深度递增），unavailable 如实归集不阻塞兄弟
        try {
          await downloadMowenNote(childUuid, formats, deps, depth + 1)
        } catch (e) {
          if (e instanceof MowenNoteUnavailable) unavailable.push(childUuid)
          else throw e
        }
      }
      refResults = { total, unavailable }
      if (unavailable.length) {
        deps.onWarning?.(`${unavailable.length} 篇引用子笔记不可匿名获取（付费/私密），已如实跳过`)
      }
    }
  }

  return {
    url, ok: true, id, dir, formats: meta.formats, title: meta.title,
    ...(parsed.warnings.length ? { warnings: parsed.warnings } : {}),
    ...(refResults ? { refResults } : {}),
  }
}

// —— 内部：exportArticle 只需要 ExportDeps（fetchBinary/BrowserWindow/now），别把微信的
// fetchHtml 一并要求进来——mowen 分支根本不用它（Omit 掉后调用方也省一组依赖）——
async function exportParsed(
  input: { parsed: import('../types').ParsedArticle; id: string; sourceUrl: string; dir: string; formats: DownloadFormat[] },
  deps: MowenDownloadDeps,
) {
  const { exportArticle } = await import('../exporter')
  return exportArticle(input, deps)
}

/** note/show 的真实网络通道。Node 内建 fetch；不挂 mp gateway（独立平台，保护闸语义不适用）。 */
export const defaultFetchJson: NoteShowDeps['fetchJson'] = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  return { status: res.status, text: await res.text() }
}
