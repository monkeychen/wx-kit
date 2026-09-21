import type { ReactNode } from 'react'

export function SettingsGroup({
  title,
  description,
  status,
  badgeTestId,
  testId,
  legacyTestId,
  children,
}: {
  title: ReactNode
  description: ReactNode
  status?: { text: string; tone: 'ok' | 'off' | 'warning' }
  /** 状态徽章的 data-testid（需要测试定位徽章文本时传） */
  badgeTestId?: string
  testId?: string
  legacyTestId?: string
  children: ReactNode
}) {
  return (
    <section className="settings-group" data-testid={testId ?? 'settings-group'}>
      <header className="settings-group-title">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {status && <span className={`settings-group-status ${status.tone}`} data-testid={badgeTestId}>{status.text}</span>}
      </header>
      <div data-testid={legacyTestId}>{children}</div>
    </section>
  )
}

export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}
