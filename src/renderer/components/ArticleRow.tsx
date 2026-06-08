import { Popconfirm } from 'antd'
import type { ArticleMeta } from '../../core/types'
import { accountName } from '../library-view'

interface Props {
  meta: ArticleMeta
  selected: boolean
  showAccount: boolean         // 分组时组内不重复显示公众号列
  onToggleSelect: () => void   // 单击行：切换选中
  onRead: () => void           // 双击行 / 行尾「阅读」：进入阅读
  onReveal: () => void
  onDelete: () => void
}

// 访达式列表的一行：缩略图·标题(衬线)·公众号·发布·下载·行尾常驻操作。
// 单击=选中，双击=阅读。列宽与 .lhead 对齐（见 index.css 的 grid-template-columns）。
export default function ArticleRow({ meta, selected, showAccount, onToggleSelect, onRead, onReveal, onDelete }: Props) {
  const readable = meta.formats.includes('md') || meta.formats.includes('html')
  return (
    <div className={`lrow${selected ? ' sel' : ''}`} data-testid="article-row"
      onClick={onToggleSelect} onDoubleClick={() => readable && onRead()}>
      <span className="lthumb">{(meta.title || '文').slice(0, 1)}</span>
      <span className="ltitle" title={meta.title}>{meta.title || '(无标题)'}</span>
      {showAccount && <span className="lcell">{accountName(meta)}</span>}
      <span className="lcell">{meta.publishTime || '—'}</span>
      <span className="lcell">{meta.downloadTime ? meta.downloadTime.slice(0, 10) : '—'}</span>
      <span className="lacts" onClick={(e) => e.stopPropagation()}>
        <button disabled={!readable} style={!readable ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          onClick={() => readable && onRead()}>阅读</button>
        <button onClick={onReveal}>文件夹</button>
        <Popconfirm title="删除该文章？" description="磁盘文件将一并删除" okText="删除" cancelText="取消"
          okButtonProps={{ danger: true }} onConfirm={onDelete}>
          <button className="danger">删除</button>
        </Popconfirm>
      </span>
    </div>
  )
}
