import { useEffect, useMemo, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Segmented, Button, Spin, Empty } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
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
