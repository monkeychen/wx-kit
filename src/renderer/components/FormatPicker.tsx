import type { DownloadFormat } from '../../core/types'
import { FORMAT_INFOS } from '../format-meta'

interface Props {
  value: DownloadFormat[]
  onChange: (next: DownloadFormat[]) => void
  disabled?: boolean
}

// 友好的格式多选：每项是带中文名 + 说明的可点卡片，选中朱砂描边。
// 取代裸露的 cover/md/html/pdf/meta 复选框 —— 用户无需先懂代号。
export default function FormatPicker({ value, onChange, disabled }: Props) {
  const toggle = (f: DownloadFormat) => {
    if (disabled) return
    onChange(value.includes(f) ? value.filter((v) => v !== f) : [...value, f])
  }
  return (
    <div className="format-grid">
      {FORMAT_INFOS.map((info) => {
        const on = value.includes(info.value)
        return (
          <div
            key={info.value}
            role="checkbox"
            aria-checked={on}
            data-testid={`format-${info.value}`}
            className={`format-pill${on ? ' on' : ''}`}
            style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            onClick={() => toggle(info.value)}
          >
            <span className="fp-name"><span className="fp-dot" />{info.name}</span>
            <span className="fp-desc">{info.desc}</span>
          </div>
        )
      })}
    </div>
  )
}
