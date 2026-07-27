import { useEffect, useState } from 'react'
import { Popconfirm } from 'antd'
import type { ArticleMeta } from '../../core/types'
import { api } from '../api'
import { toWxfileBase, wxfileJoin } from '../wxfile'
import { relativeTime } from '../time'
import { kindTag } from '../../core/message-kind'

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
// 类型文案在 core/message-kind（M40 上提）：订阅页的待处理列表也要用同一份，两处各写一份必然漂。

export default function ArticleCard({ meta, libraryRoot, index, selected, onToggleSelect, onRead, onReveal, onDelete }: Props) {
  const [cover, setCover] = useState<string | null>(null)
  const readable = meta.formats.includes('md') || meta.formats.includes('html')
  const tag = kindTag(meta.itemShowType)

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
          {/* 含视频的文章值得一眼看出来（视频是最占空间也最容易被忽略的部分） */}
          {meta.videos?.length ? <span data-testid="card-has-video" title={`含 ${meta.videos.length} 个视频`}>📹 </span> : null}
          {/* 非普通图文标出类型：同一个文库里混着文字消息/视频消息，形态差别很大 */}
          {tag && (
            <span data-testid="card-kind" className={`kind-tag${tag.warn ? ' warn' : ''}`}
              title={tag.warn ? `未识别的消息类型 ${meta.itemShowType}，正文是兜底提取的，建议核对` : undefined}>{tag.text} </span>
          )}
          {/* 「下到了但可能不对」的唯一信号：不显眼，但必须找得到（M40 起写进 meta.json） */}
          {meta.warnings?.length ? (
            <span data-testid="card-warnings" className="kind-tag warn" title={meta.warnings.join('\n')}>⚠ </span>
          ) : null}
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
