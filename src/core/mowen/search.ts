// src/core/mowen/search.ts
// 全站笔记搜索（mocli notes search）。与 homepage/mine 同一响应形态，复用清单映射。
import type { MocliRunner, MowenNoteListItem } from './types'
import { parseMocliJson, mapNoteList } from './metadata'

export async function searchNotes(run: MocliRunner, keyword: string, count = 20): Promise<MowenNoteListItem[]> {
  const r = await run(['notes', 'search', '--keyword', keyword, '--count', String(count)])
  return mapNoteList(parseMocliJson(r.stdout, r.stderr).reply as Record<string, unknown>)
}
