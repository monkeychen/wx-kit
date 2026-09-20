import { createHash } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { readArticleContent } from '../read-article'
import type { ArticleMeta } from '../types'
import type {
  TopicContentGroup,
  TopicMaterialExclusion,
  TopicMaterialSnapshot,
  TopicParagraph,
  TopicSnapshotArticle,
  TopicWindow,
} from './types'

export const MAX_TOPIC_ARTICLES = 30
export const MAX_TOPIC_MODEL_CHARS = 120_000
export const MAX_TOPIC_PARAGRAPH_CHARS = 6_000

export type TopicInputLimitCode = 'TOO_MANY_ARTICLES' | 'TOO_MANY_CHARACTERS'

export class TopicInputLimitError extends Error {
  constructor(
    public code: TopicInputLimitCode,
    public actual: number,
    public limit: number,
  ) {
    super(code === 'TOO_MANY_ARTICLES'
      ? `可分析文章 ${actual} 篇，超过上限 ${limit} 篇，请缩小时间范围。`
      : `可分析正文 ${actual} 字符，超过上限 ${limit} 字符，请缩小时间范围。`)
    this.name = 'TopicInputLimitError'
  }
}

export interface TopicSnapshotDeps {
  libraryRoot: string
  readContent?: (dir: string) => Promise<string>
  now?: () => Date
}

export interface TopicSnapshotInput {
  runId: string
  window: TopicWindow
  articles: readonly ArticleMeta[]
}

const digest = (content: string): string => createHash('sha256').update(content).digest('hex')

function normalizeContent(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
}

function visibleText(content: string): string {
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/[`*_>#~()[\]-]/g, '')
    .replace(/\s/g, '')
}

function hasMissingBodyWarning(meta: ArticleMeta): boolean {
  return (meta.warnings ?? []).some(message =>
    message.includes('正文与图片均未取到') || message.includes('仅保存标题与元信息'))
}

function splitParagraphs(content: string, groupId: string): TopicParagraph[] {
  const blocks = content.split(/\n\s*\n+/).map(block => block.trim()).filter(Boolean)
  const paragraphs: TopicParagraph[] = []
  blocks.forEach((block, paragraphIndex) => {
    const baseId = `${groupId}:p${String(paragraphIndex + 1).padStart(3, '0')}`
    let offset = 0
    let chunkIndex = 1
    while (offset < block.length) {
      const text = block.slice(offset, offset + MAX_TOPIC_PARAGRAPH_CHARS)
      paragraphs.push({
        id: chunkIndex === 1 ? baseId : `${baseId}:c${String(chunkIndex).padStart(3, '0')}`,
        groupId,
        index: paragraphIndex + 1,
        chunkIndex,
        text,
      })
      offset += text.length
      chunkIndex++
    }
  })
  return paragraphs
}

function isInside(root: string, dir: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedDir = resolve(dir)
  return resolvedDir !== resolvedRoot && resolvedDir.startsWith(`${resolvedRoot}${sep}`)
}

function missingContent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === 'ENOENT' || /not found/i.test(message)
}

function exclusion(id: string, reason: TopicMaterialExclusion, detail?: string) {
  return { id, reason, ...(detail ? { detail } : {}) }
}

/** 构建一次分析的不可变输入快照；传入文章必须已经过 M67 的时间范围筛选。 */
export async function buildTopicSnapshot(deps: TopicSnapshotDeps, input: TopicSnapshotInput): Promise<TopicMaterialSnapshot> {
  const readContent = deps.readContent ?? ((dir: string) => readArticleContent(dir, 'md'))
  const accepted: Array<{ meta: ArticleMeta; content: string; hash: string }> = []
  const excluded: TopicMaterialSnapshot['excluded'] = []

  for (const meta of input.articles) {
    if (!isInside(deps.libraryRoot, meta.dir)) {
      excluded.push(exclusion(meta.id, 'path-outside-library'))
      continue
    }
    let raw: string
    try {
      raw = await readContent(meta.dir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      excluded.push(missingContent(error)
        ? exclusion(meta.id, 'content-missing')
        : exclusion(meta.id, 'content-unreadable', message))
      continue
    }
    const content = normalizeContent(raw)
    if (hasMissingBodyWarning(meta) || !visibleText(content)) {
      excluded.push(exclusion(meta.id, 'insufficient-text'))
      continue
    }
    accepted.push({ meta, content, hash: digest(content) })
  }

  if (accepted.length > MAX_TOPIC_ARTICLES) {
    throw new TopicInputLimitError('TOO_MANY_ARTICLES', accepted.length, MAX_TOPIC_ARTICLES)
  }

  const groups: TopicContentGroup[] = []
  const paragraphs: TopicParagraph[] = []
  const articles: TopicSnapshotArticle[] = []
  const groupByHash = new Map<string, TopicContentGroup>()

  for (const item of accepted) {
    let group = groupByHash.get(item.hash)
    if (!group) {
      const id = `g${String(groups.length + 1).padStart(3, '0')}`
      const groupParagraphs = splitParagraphs(item.content, id)
      group = {
        id,
        contentHash: item.hash,
        representativeArticleId: item.meta.id,
        memberArticleIds: [],
        paragraphIds: groupParagraphs.map(p => p.id),
      }
      groups.push(group)
      paragraphs.push(...groupParagraphs)
      groupByHash.set(item.hash, group)
    }
    group.memberArticleIds.push(item.meta.id)
    articles.push({
      id: item.meta.id,
      title: item.meta.title,
      author: item.meta.author,
      account: item.meta.account,
      ...(item.meta.accountId ? { accountId: item.meta.accountId } : {}),
      publishTime: item.meta.publishTime,
      sourceUrl: item.meta.sourceUrl,
      contentHash: item.hash,
      groupId: group.id,
      warnings: [...(item.meta.warnings ?? [])],
    })
  }

  const totalModelChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0)
  if (totalModelChars > MAX_TOPIC_MODEL_CHARS) {
    throw new TopicInputLimitError('TOO_MANY_CHARACTERS', totalModelChars, MAX_TOPIC_MODEL_CHARS)
  }

  const createdAt = (deps.now?.() ?? new Date()).toISOString()
  return {
    schemaVersion: 1,
    runId: input.runId,
    createdAt,
    window: input.window,
    articles,
    groups,
    paragraphs,
    excluded,
    totalModelChars,
  }
}
