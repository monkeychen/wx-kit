import { useState } from 'react'
import type { DownloadFormat } from '../../core/types'
import { FORMAT_INFOS } from '../format-meta'

interface Props {
  value: DownloadFormat[]
  onChange: (next: DownloadFormat[]) => void
  disabled?: boolean
}

// 等宽 chip 多选 + 联动说明条：5 个格式一行对齐，选中朱砂填充。
// 说明不再塞进每个卡片（那会撑大、撑成两行），而是常驻在下方一行——
// 鼠标划过即时显示该格式说明，移开回显已选汇总（渐进式展示）。
export default function FormatPicker({ value, onChange, disabled }: Props) {
  const [hover, setHover] = useState<string | null>(null)
  const toggle = (f: DownloadFormat) => {
    if (disabled) return
    onChange(value.includes(f) ? value.filter((v) => v !== f) : [...value, f])
  }
  const hint = hover ?? (value.length ? `已选 ${value.length} 种格式` : '请至少选择一种格式')
  return (
    <div className={`fmt-block${disabled ? ' is-disabled' : ''}`}>
      <div className="fmt-bar">
        {FORMAT_INFOS.map((info) => {
          const on = value.includes(info.value)
          return (
            <button
              key={info.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              data-testid={`format-${info.value}`}
              className={`fmt-chip${on ? ' on' : ''}`}
              disabled={disabled}
              onMouseEnter={() => setHover(info.desc)}
              onMouseLeave={() => setHover(null)}
              onClick={() => toggle(info.value)}
            >
              <span className="ind">
                <svg viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 6.5L5 9.5L10 3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {info.name}
            </button>
          )
        })}
      </div>
      <div className="fmt-hint">{hint}</div>
    </div>
  )
}
