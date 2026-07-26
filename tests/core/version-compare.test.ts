// tests/core/version-compare.test.ts
import { describe, it, expect } from 'vitest'
import { compareVersions } from '../../src/core/version-compare'

describe('compareVersions', () => {
  it('0.8.10 > 0.8.9 —— 必须按数字比,字符串比会判反', () => {
    // 这个 bug 要等发到 0.8.10 才爆,那时没人会想到是比较函数的问题
    expect(compareVersions('0.8.10', '0.8.9')).toBeGreaterThan(0)
    expect(compareVersions('0.8.9', '0.8.10')).toBeLessThan(0)
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
  })

  it('两侧都可带 v 前缀', () => {
    expect(compareVersions('v0.9.0', '0.8.1')).toBeGreaterThan(0)
    expect(compareVersions('0.9.0', 'v0.9.0')).toBe(0)
    expect(compareVersions('v1.0.0', 'v1.0.0')).toBe(0)
  })

  it('位数不等时缺位视为 0', () => {
    expect(compareVersions('0.9', '0.9.0')).toBe(0)
    expect(compareVersions('1.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.9.1', '0.9')).toBeGreaterThan(0)
  })

  it('相等返回 0', () => {
    expect(compareVersions('0.8.1', '0.8.1')).toBe(0)
  })

  it('非法输入不抛异常(缺段按 0 处理)——启动时的静默检查不能因脏数据炸掉', () => {
    expect(() => compareVersions('', '0.8.1')).not.toThrow()
    expect(compareVersions('', '0.8.1')).toBeLessThan(0)
    expect(compareVersions('abc', 'def')).toBe(0)
  })

  it('预发布后缀只剥离、不排序(已知简化)', () => {
    // 项目从未发过 pre-release;真要发时再补 semver 的完整优先级规则
    expect(compareVersions('0.9.0-beta.1', '0.9.0')).toBe(0)
    expect(compareVersions('0.9.0-beta.1', '0.8.9')).toBeGreaterThan(0)
  })
})
