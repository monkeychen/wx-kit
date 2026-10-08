import { useEffect, useMemo, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Segmented, Button, Spin, Empty } from 'antd'
import { ArrowLeftOutlined, PlayCircleOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AnchorHTMLAttributes, ClassAttributes, ImgHTMLAttributes } from 'react'
import type { ExtraProps } from 'react-markdown'
import { api } from '../api'
import { toWxfileBase, wxfileJoin } from '../wxfile'
import { relativeTime } from '../time'
import { stripLeadingTitle } from '../strip-leading-title'
import type { ArticleMeta } from '../../core/types'

type ImgProps = ClassAttributes<HTMLImageElement> & ImgHTMLAttributes<HTMLImageElement> & ExtraProps
type AnchorProps = ClassAttributes<HTMLAnchorElement> & AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps
type MetaVideo = NonNullable<ArticleMeta['videos']>[number]

/** 视频入口（v0.12.2 R1，B1 降级）：有当次直链先给在线播放器（时效如实标注），
 *  播放失败**自动**降级为「在微信里打开」——不让用户自己判断直链是不是过期了。
 *  无直链（墨问视频号嵌入）直接给跳转按钮，不渲染必然播不出的空播放器。 */
function VideoEntryBlock({ entry }: { entry: MetaVideo }) {
  const [failed, setFailed] = useState(false)
  const open = () => { if (entry.fallbackUrl) void api.openExternal(entry.fallbackUrl) }
  if (!entry.streamUrl || failed) {
    return (
      <p className="video-entry">
        <Button icon={<PlayCircleOutlined />} onClick={open}>在微信里打开</Button>
        <span className="video-entry-hint">{failed ? '在线播放已失效（直链有时效），点击前往微信观看' : '视频直链不可用，点击前往微信观看'}</span>
      </p>
    )
  }
  return (
    <figure className="video-entry">
      <video controls preload="metadata" style={{ width: '100%' }} src={entry.streamUrl} onError={() => setFailed(true)} />
      <figcaption className="video-entry-hint">在线播放的直链有时效，可能已过期；也可在微信里打开</figcaption>
    </figure>
  )
}

export default function Reader() {
  const { id } = useParams()
  const nav = useNavigate()
  const [meta, setMeta] = useState<ArticleMeta | null>(null)
  const [root, setRoot] = useState('')
  const [kind, setKind] = useState<'md' | 'html'>('md')
  const [md, setMd] = useState('')
  const [loading, setLoading] = useState(true)
  // 返回目标三档：选稿弹层（sessionStorage 标记，返回时恢复弹层现场）>
  // 跳转来源（入口 nav 时的 state.from，如订阅/下载页）> 兜底文库。
  const location = useLocation()
  const fromState = (location.state as { from?: string } | null)?.from
  const fromTopicsPick = sessionStorage.getItem('wxk-topics-pick-return') !== null
  const backLabel = fromTopicsPick ? '返回选稿'
    : fromState === '/subscriptions' ? '返回订阅'
    : fromState === '/' ? '返回下载'
    : '返回文库'
  const goBack = () => {
    if (fromTopicsPick) {
      // 不在这里删标记：选稿页挂载时才消费它。写成 'return' 表示「经返回按钮回去」，
      // 若用户绕路（侧边导航）回选稿，标记停在 '1'，弹层不会误开。
      sessionStorage.setItem('wxk-topics-pick-return', 'return')
      nav('/topics')
      return
    }
    nav(typeof fromState === 'string' ? fromState : '/library')
  }

  useEffect(() => {
    (async () => {
      const [list, s] = await Promise.all([api.libraryList(), api.getSettings()])
      setRoot(s.libraryRoot)
      const m = list.find((a) => a.id === decodeURIComponent(id ?? '')) ?? null
      setMeta(m)
      if (m) setKind(m.formats.includes('md') ? 'md' : 'html')
      setLoading(false)
    })()
  }, [id])

  const base = useMemo(() => (meta && root ? toWxfileBase(root, meta.dir) : ''), [meta, root])

  useEffect(() => {
    if (meta && kind === 'md') {
      api.readContent(meta.dir, 'md').then(setMd).catch(() => setMd('*(内容读取失败)*'))
    }
  }, [meta, kind])

  if (loading) return <div className="page" style={{ textAlign: 'center', paddingTop: 80 }}><Spin /></div>
  if (!meta) return <div className="page"><Empty description="未找到文章" /></div>

  return (
    <>
      <div className="reader-bar">
        <Button icon={<ArrowLeftOutlined />} data-testid="reader-back" onClick={goBack}>{backLabel}</Button>
        <span className="font-serif" style={{ flex: 1, fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.title}</span>
        <Segmented value={kind} onChange={(v) => setKind(v as 'md' | 'html')}
          options={[
            { label: 'Markdown', value: 'md', disabled: !meta.formats.includes('md') },
            { label: '网页', value: 'html', disabled: !meta.formats.includes('html') },
          ]} />
      </div>

      {kind === 'html' ? (
        <iframe title="article" className="reader-frame" sandbox="allow-same-origin allow-popups"
          src={wxfileJoin(base, 'index.html')} />
      ) : (
        <div className="reader-scroll">
          <article className="reader-doc">
            <div className="reader-kicker">{meta.account || '未知公众号'}</div>
            <h1 className="reader-title">{meta.title}</h1>
            <div className="reader-byline">
              {meta.author && <span>{meta.author} · </span>}
              {meta.publishTime ? relativeTime(meta.publishTime) : ''}
            </div>
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ src = '', ...rest }: ImgProps) => {
                    const resolved = src.startsWith('images/') ? wxfileJoin(base, src) : src
                    return <img src={resolved} alt={rest.alt ?? ''} />
                  },
                  // 指向库内视频的链接直接渲染成播放器——与 img 同构（md 里的 ![](images/…) 也是渲染成 <img>）。
                  // 否则它是个普通相对链接，点下去会把 hash 路由带偏、被路由兜底扔回下载页。
                  a: ({ href = '', children, ...rest }: AnchorProps) => {
                    if (href.startsWith('videos/')) {
                      return <video controls preload="metadata" style={{ width: '100%' }} src={wxfileJoin(base, href)} />
                    }
                    // 视频永久入口（v0.12.2 R1）：按 meta.videos 精确匹配 href——不能按
                    // URL 特征猜（正文原生外链可能也是 mp.weixin.qq.com），启发式会误伤。
                    const videoEntry = meta?.videos?.find((v) => v.fallbackUrl === href)
                    if (videoEntry) return <VideoEntryBlock entry={videoEntry} />
                    // 站外链接交给系统浏览器：应用内导航过去就出不来了
                    if (/^https?:/.test(href)) {
                      return <a href={href} onClick={(e) => { e.preventDefault(); api.openExternal(href) }} {...rest}>{children}</a>
                    }
                    return <a href={href} {...rest}>{children}</a>
                  },
                }}>
                {stripLeadingTitle(md, meta.title)}
              </ReactMarkdown>
            </div>
          </article>
        </div>
      )}
    </>
  )
}
