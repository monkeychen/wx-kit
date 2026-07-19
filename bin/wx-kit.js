#!/usr/bin/env node
// npm 全局安装的 CLI/GUI 入口:spawn electron 运行包根(main 指向 dist-electron/main.js),
// 透传参数与 stdio——无参开 GUI、带子命令进 CLI,与安装包行为一致(模式分流在 main.ts)。
const { spawn } = require('node:child_process')
const { join } = require('node:path')

let electron
try {
  electron = require('electron')   // 解析为 electron 可执行文件路径
} catch {
  process.stderr.write('[wx-kit] 找不到 electron 依赖。请重装:npm i -g @simiam/wx-kit\n'
    + '(国内网络可先设镜像:export ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/)\n')
  process.exit(1)
}

const appRoot = join(__dirname, '..')
const child = spawn(electron, [appRoot, ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
