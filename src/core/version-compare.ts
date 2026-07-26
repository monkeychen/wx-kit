// src/core/version-compare.ts
// 版本号比较。**刻意不引 semver 依赖**:需要的只是「哪个新」,自己写二十行即可,
// 而引一个包会为这点逻辑背上供应链与升级成本(v0.8.2 R3 非目标已定)。

/**
 * 剥掉 `v` 前缀与预发布/构建后缀,拆成数字段。
 * 缺段视为 0(`0.9` 与 `0.9.0` 相等),非数字段视为 0(脏数据不抛异常——
 * 启动时的静默检查绝不能因为一个畸形 tag 就炸掉)。
 */
function segments(v: string): number[] {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]          // 预发布/构建后缀只剥离,不参与排序(见下方说明)
    .split('.')
    .map((x) => {
      const n = Number.parseInt(x, 10)
      return Number.isFinite(n) ? n : 0
    })
}

/**
 * 比较两个版本:a > b 返回正数,a < b 返回负数,相等返回 0。
 *
 * **必须逐段按数字比**——字符串比较会把 `0.8.10` 判成小于 `0.8.9`,
 * 而这种 bug 要等真发到 0.8.10 才暴露,届时没人会想到是比较函数的问题。
 *
 * 已知简化:`0.9.0-beta.1` 与 `0.9.0` 视为相等(后缀只剥离不排序)。
 * 项目从未发过 pre-release;真要发时在此补 semver 的优先级规则。
 */
export function compareVersions(a: string, b: string): number {
  const x = segments(a)
  const y = segments(b)
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}
