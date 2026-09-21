import { SETTINGS_CATEGORIES, type SettingsCategory } from '../settings-view'

export type SettingsCategoryStatus = 'ok' | 'off' | 'warning'

export default function SettingsCategoryNav({
  value,
  onChange,
  statuses,
}: {
  value: SettingsCategory
  onChange: (value: SettingsCategory) => void
  statuses: Record<SettingsCategory, SettingsCategoryStatus>
}) {
  return (
    <nav className="settings-category-nav surface" data-testid="settings-category-nav" aria-label="设置分类">
      <div className="settings-category-caption">设置分类</div>
      {SETTINGS_CATEGORIES.map(category => (
        <button key={category.id} type="button"
          className={`settings-category-button${value === category.id ? ' active' : ''}`}
          aria-current={value === category.id ? 'page' : undefined}
          data-testid={`settings-cat-${category.id}`}
          onClick={() => onChange(category.id)}>
          <span className="settings-category-icon" aria-hidden>{category.icon}</span>
          <span className="settings-category-copy">
            <strong>{category.label}</strong>
            <small>{category.description}</small>
          </span>
          <span className={`settings-category-status ${statuses[category.id]}`} aria-hidden />
        </button>
      ))}
    </nav>
  )
}
