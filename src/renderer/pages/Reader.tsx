import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Segmented, Button, Spin, Empty } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ClassAttributes, ImgHTMLAttributes } from 'react'
import type { ExtraProps } from 'react-markdown'
import { api } from '../api'
import { toWxfileBase, wxfileJoin } from '../wxfile'
import { relativeTime } from '../time'
import { stripLeadingTitle } from '../strip-leading-title'
import type { ArticleMeta } from '../../core/types'

type ImgProps = ClassAttributes<HTMLImageElement> & ImgHTMLAttributes<HTMLImageElement> & ExtraProps

export default function Reader() {
  const { id } = useParams()
  const nav = useNavigate()
  const [meta, setMeta] = useState<ArticleMeta | null>(null)
  const [root, setRoot] = useState('')
  const [kind, setKind] = useState<'md' | 'html'>('md')
  const [md, setMd] = useState('')
  const [loading, setLoading] = useState(true)

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
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/library')}>返回文库</Button>
        <span className="font-serif" style={{ flex: 1, fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.title}</span>
        <Segmented value={kind} onChange={(v) => setKind(v as 'md' | 'html')}
          options={[
            { label: 'Markdown', value: 'md', disabled: !meta.formats.includes('md') },
            { label: '网页', value: 'html', disabled: !meta.formats.includes('html') },
          ]} />
      </div>

      {kind === 'html' ? (
        <iframe title="article" className="reader-frame" sandbox="allow-same-origin"
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
