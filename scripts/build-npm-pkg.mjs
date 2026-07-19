// 组装 npm 发布包到 dist-npm/:构建产物 + bin 启动脚本 + 生成的 package.json。
// 独立 staging 的原因:主 package.json 是 private 且 electron 必须留在 devDependencies
// (electron-builder 的硬约束),而 npm 全局安装又要求 electron 是 dependencies——两者只能分离。
// 用法:node scripts/build-npm-pkg.mjs   (先 npm run build 出 dist/ dist-electron/)
import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-npm')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))

for (const d of ['dist', 'dist-electron']) {
  if (!existsSync(join(root, d))) { console.error(`missing ${d}/ — run: npm run build`); process.exit(1) }
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out)
cpSync(join(root, 'dist'), join(out, 'dist'), { recursive: true })
cpSync(join(root, 'dist-electron'), join(out, 'dist-electron'), { recursive: true })
cpSync(join(root, 'bin'), join(out, 'bin'), { recursive: true })
cpSync(join(root, 'README.md'), join(out, 'README.md'))
cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'))

// 运行时依赖以 dist-electron/main.js 的真实 require 为准:
// electron(宿主)、undici(external+惰性,cheerio 链路)、@mixmark-io/domino(turndown 链路)
const deps = {
  electron: pkg.devDependencies.electron,
  undici: `^${JSON.parse(readFileSync(join(root, 'node_modules/undici/package.json'), 'utf-8')).version}`,
  '@mixmark-io/domino': `^${JSON.parse(readFileSync(join(root, 'node_modules/@mixmark-io/domino/package.json'), 'utf-8')).version}`,
}

writeFileSync(join(out, 'package.json'), JSON.stringify({
  name: 'wx-kit',
  version: pkg.version,
  description: '微信百宝箱 — 微信公众号文章下载器(GUI + agent 友好 CLI,同一二进制)',
  license: pkg.license,
  author: pkg.author,
  homepage: pkg.homepage,
  repository: { type: 'git', url: 'git+https://github.com/monkeychen/wx-kit.git' },
  keywords: ['wechat', 'weixin', 'mp', 'article', 'downloader', 'cli', 'agent'],
  main: 'dist-electron/main.js',
  type: 'commonjs',
  bin: { 'wx-kit': 'bin/wx-kit.js' },
  os: ['darwin', 'linux'],
  engines: { node: '>=20' },
  dependencies: deps,
}, null, 2) + '\n')

console.log(`dist-npm/ ready (wx-kit@${pkg.version}); publish: cd dist-npm && npm publish`)
