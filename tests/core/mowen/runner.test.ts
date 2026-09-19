// tests/core/mowen/runner.test.ts
// createLocateDeps（真实工厂）的契约钉子。
// 回归背景（v0.11.2 后本机实录）：工厂漏传 env → locateMocli 里 deps.env?.HOME 为
// undefined → HOME 相对候选与 nvm 扫描整块被跳过，探测链在生产里永远落到 login shell
// 兜底；本机拿到的是 ~/bin/mocli（符号链接，所在目录无 node），PATH 注入后 mocli 的
// shebang `env node` 仍解析失败 → 空 stdout → BAD_OUTPUT。locate.test.ts 的用例都在
// 测试辅助里显式传了 env，唯独「真实工厂」这条缝没人盖——形状测试钉死。
import { describe, it, expect } from 'vitest'
import { createLocateDeps } from '../../../src/core/mowen/runner'

describe('createLocateDeps（真实工厂）', () => {
  it('必须把 process.env 的 HOME/SHELL 传给 locateMocli——漏传 env 会让第②步（HOME 相对候选 + nvm 扫描）在生产变成死代码', () => {
    const deps = createLocateDeps()
    expect(deps.env).toBeDefined()
    expect(deps.env?.HOME).toBe(process.env.HOME)
    expect(deps.env?.SHELL).toBe(process.env.SHELL)
  })
})
