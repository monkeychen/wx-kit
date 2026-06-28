// 纯函数: 决定一组用户参数应进 CLI 还是 GUI。无 electron 依赖，可单测。
export const CLI_COMMANDS = new Set([
  'download', 'crawl', 'search', 'login', 'auth-status',
  'library', 'subscription', 'settings', 'help', 'version',
])
const CLI_FLAGS = new Set(['-h', '--help', '-v', '--version'])

/** argv[0] 是已知子命令，或 argv 任意位置含 help/version flag → CLI；空参 → GUI。 */
export function isCliInvocation(argv: string[]): boolean {
  if (argv.length === 0) return false
  if (CLI_COMMANDS.has(argv[0])) return true
  return argv.some((a) => CLI_FLAGS.has(a))
}
