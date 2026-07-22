// src/core/site-sync.ts
// 把文库文章按个人站(Astro)的发布规范生成为 content/posts/<YYYY-MM-DD>-<slug>/ 目录。
// 纯本地文件操作,零网络(图片在下载时已本地化,这里只复制)。
//
// 站点规范(取自 dreamble/site 的 AGENTS.md 与 src/content.config.ts,2026-07-22 核实):
//   - 目录 content/posts/YYYY-MM-DD-<slug>/index.md,图片与正文同目录、相对引用 ./img-N.ext
//   - 目录日期必须等于 frontmatter 的 date
//   - slug 只含小写字母/数字/连字符,不以连字符开头结尾,全局唯一(URL 去掉日期,靠 slug 区分)
//   - frontmatter schema 是 strict:未知字段会让站点构建失败,故只写 title/date/source
//
// 注意:转换逻辑与 site 的 scripts/lib/wechat.mjs 是**两份实现**(安哥选的路径 A:wx-kit 自包含,
// 不依赖 site 项目在不在、脚本能不能跑)。site 若改 schema 或转换规则,这里要跟。
import { readFile, readdir, mkdtemp, mkdir, writeFile, copyFile, rename, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleMeta } from './types'

export type SlugCheck = { ok: true } | { ok: false; error: string }

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 校验 slug:格式合法 + 不与 taken(批量内已用 + 站点已有)冲突。 */
export function validateSlug(slug: string, taken: Set<string>): SlugCheck {
  if (!slug) return { ok: false, error: 'slug 不能为空' }
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: `slug「${slug}」非法:只能用小写字母、数字和单个连字符,且不能以连字符开头或结尾` }
  }
  if (taken.has(slug)) return { ok: false, error: `slug「${slug}」已存在(站点已有同名文章或本批次重复)` }
  return { ok: true }
}

export type BuildResult = { ok: true; dirName: string; indexMd: string } | { ok: false; error: string }

/** 站点 frontmatter 的字符串转义(与 site 的 buildIndexMd 一致,用 JSON 字符串字面量)。 */
const q = (s: string): string => JSON.stringify(s)

/**
 * 由 wx-kit 的 meta + content.md 生成站点的 index.md 与目录名。
 * 正文处理:去 frontmatter → 去与标题重复的首个 H1 → 图片引用 images/ 改为同目录 ./
 */
export function buildSitePost(meta: ArticleMeta, contentMd: string, slug: string): BuildResult {
  const date = (meta.publishTime ?? '').slice(0, 10)
  // 目录日期必须等于发布日期;缺发布时间就没法定目录名,不能拿今天糊弄(会与 frontmatter date 不一致、站点校验失败)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: `缺少可用的发布时间(publishTime=「${meta.publishTime ?? ''}」),无法确定站点目录日期` }
  }

  let body = contentMd
  const fmEnd = body.startsWith('---\n') ? body.indexOf('\n---\n', 4) : -1
  if (fmEnd !== -1) body = body.slice(fmEnd + 5)
  body = body.replace(/^\s*#\s.*\n+/, '')          // 首个 H1 与 frontmatter.title 重复,站点标题另有其位
  body = body.replace(/\]\(images\//g, '](./')      // wx-kit 存 images/ 子目录,站点要求同目录相对引用

  const indexMd = `---\ntitle: ${q(meta.title)}\ndate: ${date}\nsource: wechat\n---\n\n${body.trim()}\n`
  return { ok: true, dirName: `${date}-${slug}`, indexMd }
}

export interface SyncItem { meta: ArticleMeta; slug: string }
export interface SyncItemResult { id: string; title: string; slug: string; ok: boolean; dir?: string; error?: string }
export interface SyncSummary { postsRoot: string; succeeded: number; failed: number; results: SyncItemResult[] }

/** 站点已占用的 slug:目录名形如 YYYY-MM-DD-<slug>,取日期之后的部分。 */
async function takenSlugs(postsRoot: string): Promise<Set<string>> {
  const names = await readdir(postsRoot).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return [] as string[]
    throw e
  })
  const out = new Set<string>()
  for (const n of names) {
    const m = /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(n)
    if (m) out.add(m[1])
  }
  return out
}

const exists = async (p: string): Promise<boolean> => access(p).then(() => true, () => false)

/**
 * 目录级原子写入:先在 postsRoot 内的暂存目录写全(同一文件系统才能 rename),
 * 完整后整目录 rename 到正式位置;任何一步失败都删掉暂存,不留会被误判为「已发布」的半成品。
 * (与站点 scripts/lib/import-storage.mjs 的 commitPostImport 同构。)
 */
export async function commitSitePost(
  postsRoot: string,
  dirName: string,
  indexMd: string,
  imagesDir: string,
): Promise<{ ok: true; dir: string } | { ok: false; error: string }> {
  const target = join(postsRoot, dirName)
  if (await exists(target)) return { ok: false, error: `目标目录已存在:${dirName}(不覆盖,请换 slug 或先人工处理)` }

  await mkdir(postsRoot, { recursive: true })
  const staging = await mkdtemp(join(postsRoot, '.staging-'))
  let committed = false
  try {
    await writeFile(join(staging, 'index.md'), indexMd, 'utf-8')
    // 图片与正文同目录(站点约定),wx-kit 的 images/ 子目录在此摊平
    const files = await readdir(imagesDir).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return [] as string[]   // 没图片的文章是正常的
      throw e
    })
    for (const f of files) await copyFile(join(imagesDir, f), join(staging, f))
    await rename(staging, target)
    committed = true
    return { ok: true, dir: target }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    if (!committed) await rm(staging, { recursive: true, force: true })
  }
}

/**
 * 批量同步(GUI 与 CLI 共用)。串行逐篇,单篇失败不阻断其他篇。
 * slug 冲突以「站点已有 + 本批次已用」为准,先到先得;不覆盖任何已存在的目录。
 */
export async function syncToSite(items: SyncItem[], postsRoot: string): Promise<SyncSummary> {
  const taken = await takenSlugs(postsRoot)
  const results: SyncItemResult[] = []

  for (const { meta, slug } of items) {
    const base = { id: meta.id, title: meta.title, slug }
    const check = validateSlug(slug, taken)
    if (!check.ok) { results.push({ ...base, ok: false, error: check.error }); continue }

    let contentMd: string
    try {
      contentMd = await readFile(join(meta.dir, 'content.md'), 'utf-8')
    } catch (e) {
      results.push({ ...base, ok: false, error: `读取 content.md 失败:${(e as Error).message}(该文章可能未下载 md 格式)` })
      continue
    }

    const built = buildSitePost(meta, contentMd, slug)
    if (!built.ok) { results.push({ ...base, ok: false, error: built.error }); continue }

    const done = await commitSitePost(postsRoot, built.dirName, built.indexMd, join(meta.dir, 'images'))
    if (!done.ok) { results.push({ ...base, ok: false, error: done.error }); continue }

    taken.add(slug)   // 本批次内后续篇不得再用
    results.push({ ...base, ok: true, dir: done.dir })
  }

  return {
    postsRoot,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }
}
