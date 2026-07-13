# M21 · macOS 程序坞激活重建窗口（v0.5.3）

> 需求/验收见 `docs/PRD-v0.5.3.md`。分支 `feat/m21-dock-reactivate`。

## 根因回顾

`electron/main.ts` GUI 分支只注册了 `window-all-closed`（darwin 不退出），缺 `activate` handler。
关窗后主进程驻留但无任何重建窗口的代码路径 → 点程序坞图标无响应。

## 步骤

### 1. main.ts 抽 `createWindow()` + 注册 activate

`electron/main.ts` GUI 分支：

```ts
const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200, height: 800, title: 'wx-kit',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
}
createWindow()

// mac 惯例的另一半:关窗驻留后,点程序坞图标(reopen → activate)重建窗口
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

纯 Electron 生命周期接线、无可抽的纯逻辑 → 不加单测，验证走 e2e + 打包态真机（工作流约定第 3 条）。

### 2. e2e 末尾追加「关窗 → activate → 重建」步骤

`tests/e2e/gui.e2e.mjs` 最终截图断言之后：

1. `win.close()` 关闭主窗口（等价红点）。
2. `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)` 断言归零。
3. 先挂 `app.waitForEvent('window')`，再 `app.evaluate(({ app }) => app.emit('activate'))`。
4. 新窗口 `waitForSelector('[data-testid="app-shell"]')` 断言界面重建完整。
5. 窗口存在时再 emit 一次 activate，断言窗口数仍为 1（不重复开窗）。

### 3. 验证

`npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`、`npm run test:e2e`。

### 4. 发版（R2）

按发版规约：version bump → `docs/releases/v0.5.3.md` → 打包（国内镜像）→ **打包态 .app 真机验证**
（Playwright 指内层二进制启动 → `win.close()` → Bash `open -a /Applications/wx-kit.app` 发真实 reopen
Apple Event → 断言新窗口出现）→ README/ROADMAP/devlog 同步 → commit、合 main、tag、GitHub Release。
