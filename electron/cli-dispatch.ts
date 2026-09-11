// 纯函数: 决定一组用户参数应进 CLI 还是 GUI。无 electron 依赖，可单测。
export const CLI_COMMANDS = new Set([
  'download', 'crawl', 'search', 'login', 'auth-status',
  'library', 'subscription', 'settings', 'session', 'site', 'update', 'protection', 'mowen', 'help', 'version',
])
const CLI_FLAGS = new Set(['-h', '--help', '-v', '--version'])

/**
 * Electron/Chromium 自己消费的启动参数不应继续交给 Commander。
 * `--user-data-dir=` 主要用于打包态隔离验收，也允许用户启动完全独立的本地配置。
 */
export function normalizeUserArgs(argv: string[]): string[] {
  return argv.filter((arg) => arg !== '.' && !arg.startsWith('--user-data-dir='))
}

/** argv[0] 是已知子命令，或 argv 任意位置含 help/version flag → CLI；空参 → GUI。 */
export function isCliInvocation(argv: string[]): boolean {
  if (argv.length === 0) return false
  if (CLI_COMMANDS.has(argv[0])) return true
  return argv.some((a) => CLI_FLAGS.has(a))
}
