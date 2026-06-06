import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Segmented, Button, Spin, Empty } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ClassAttributes, ImgHTMLAttributes } from 'react'
import type { ExtraProps } from 'react-markdown'
import { api } from '../api'
import type { ArticleMeta } from '../../core/types'

type ImgProps = ClassAttributes<HTMLImageElement> & ImgHTMLAttributes<HTMLImageElement> & ExtraProps

function toWxfileBase(libraryRoot: string, dir: string): string {
  // dir 在 libraryRoot 之下；取相对子路径，按 / 编码每段
  const rootPrefix = libraryRoot.replace(/[/\\]+$/, '') + '/'
  let rel = dir.startsWith(rootPrefix) ? dir.slice(rootPrefix.length) : dir
  rel = rel.replace(/^[/\\]+/, '').split(/[/\\]/).map(encodeURIComponent).join('/')
  return `wxfile://local/${rel}`
}

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
      const m = list.find(a => a.id === decodeURIComponent(id ?? '')) ?? null
      setMeta(m)
      if (m) {
        const has = (k: 'md' | 'html') => m.formats.includes(k)
        setKind(has('md') ? 'md' : 'html')
      }
      setLoading(false)
    })()
  }, [id])

  const base = useMemo(() => (meta && root ? toWxfileBase(root, meta.dir) : ''), [meta, root])

  useEffect(() => {
    if (meta && kind === 'md') api.readContent(meta.dir, 'md').then(setMd).catch(() => setMd('*(内容读取失败)*'))
  }, [meta, kind])

  if (loading) return <div className="p-6"><Spin /></div>
  if (!meta) return <div className="p-6"><Empty description="未找到文章" /></div>

  return (
    <div className="p-6" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="mb-3" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button onClick={() => nav('/library')}>返回</Button>
        <b style={{ flex: 1 }}>{meta.title}</b>
        <Segmented value={kind} onChange={(v) => setKind(v as 'md' | 'html')}
          options={[
            { label: 'Markdown', value: 'md', disabled: !meta.formats.includes('md') },
            { label: 'HTML', value: 'html', disabled: !meta.formats.includes('html') },
          ]} />
      </div>

      {kind === 'html' ? (
        <iframe title="article" sandbox="allow-same-origin" style={{ flex: 1, border: '1px solid #eee' }}
          src={`${base}/index.html`} />
      ) : (
        <div style={{ flex: 1, overflow: 'auto', maxWidth: 760 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}
            components={{
              img: ({ src = '', ...rest }: ImgProps) => {
                const resolved = src.startsWith('images/') ? `${base}/${src.split('/').map(encodeURIComponent).join('/')}` : src
                return <img src={resolved} style={{ maxWidth: '100%' }} alt={rest.alt ?? ''} />
              },
            }}>
            {md}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}
