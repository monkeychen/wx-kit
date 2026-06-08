import { useEffect, useState } from 'react'
import { Popconfirm } from 'antd'
import type { ArticleMeta } from '../../core/types'
import { api } from '../api'
import { toWxfileBase, wxfileJoin } from '../wxfile'
import { relativeTime } from '../time'

interface Props {
  meta: ArticleMeta
  libraryRoot: string
  index: number
  selected: boolean
  onToggleSelect: () => void   // 单击卡片：切换选中
  onRead: () => void           // 双击卡片 / hover「阅读」：进入阅读
  onReveal: () => void
  onDelete: () => void
}

// 书架上的一篇文章：封面缩略图（无则朱砂首字占位）+ 衬线标题 + 公众号/时间。
// 单击=选中（切换），双击=阅读；hover 浮出操作。内容人脑子里是「封面+标题」，不是表格行。
export default function ArticleCard({ meta, libraryRoot, index, selected, onToggleSelect, onRead, onReveal, onDelete }: Props) {
  const [cover, setCover] = useState<string | null>(null)
  const readable = meta.formats.includes('md') || meta.formats.includes('html')

  useEffect(() => {
    let alive = true
    if (meta.formats.includes('cover')) {
      api.coverName(meta.dir).then((name) => {
        if (alive && name) setCover(wxfileJoin(toWxfileBase(libraryRoot, meta.dir), name))
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [meta.dir, meta.formats, libraryRoot])

  return (
    <div className={`article-card${selected ? ' sel' : ''}`} data-testid="article-card"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      onClick={onToggleSelect} onDoubleClick={() => readable && onRead()}>
      <div className="card-chk">✓</div>
      {cover ? (
        <img className="article-cover" src={cover} alt="" loading="lazy" />
      ) : (
        <div className="cover-fallback">{(meta.title || '文').slice(0, 1)}</div>
      )}
      <div className="article-body">
        <div className="article-title" title={meta.title}>{meta.title || '(无标题)'}</div>
        <div className="article-meta">
          {meta.account || '未知公众号'}
          {meta.publishTime ? ` · ${relativeTime(meta.publishTime)}` : ''}
        </div>
      </div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="card-btn" data-testid="card-read" disabled={!readable}
          style={!readable ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          onClick={() => readable && onRead()}>阅读</button>
        <button className="card-btn" onClick={onReveal}>文件夹</button>
        <Popconfirm title="删除该文章？" description="磁盘文件将一并删除" okText="删除" cancelText="取消"
          okButtonProps={{ danger: true }} onConfirm={onDelete}>
          <button className="card-btn danger" data-testid="card-delete">删除</button>
        </Popconfirm>
      </div>
    </div>
  )
}
