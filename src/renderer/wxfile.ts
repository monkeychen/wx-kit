// 把库内文章目录映射成 wxfile:// 基地址，供阅读器与书架封面读本地资源。
// dir 在 libraryRoot 之下时取相对子路径、逐段编码；否则（用户改过库根）回退原 dir，
// wxfile 协议会 403，对应资源不显示——这是预期的降级而非崩溃。
export function toWxfileBase(libraryRoot: string, dir: string): string {
  // 先归一化分隔符再比较：library.json 里的 dir 是 Node join() 产物，Windows 下是反斜杠，
  // 直接 startsWith('/.../') 恒失败 → 完整绝对路径被塞进协议路径（Windows 实录：
  // 图片全挂、ERR_FILE_NOT_FOUND，macOS 分隔符本就是 / 所以从未暴露）。
  const norm = (p: string) => p.replace(/\\/g, '/')
  const rootPrefix = norm(libraryRoot).replace(/[/\\]+$/, '') + '/'
  const d = norm(dir)
  // 库内 → 相对子路径逐段编码；库外 → 回退原 dir 逐段编码（协议层 403 降级，不崩）。
  // split 对开头 / 会产出空段，filter 掉：空段在 URL 里等于多余斜杠，不是「整段编码」。
  if (d.startsWith(rootPrefix)) {
    return 'wxfile://local/' + d.slice(rootPrefix.length).split('/').filter(Boolean).map(encodeURIComponent).join('/')
  }
  return 'wxfile://local/' + d.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

export function wxfileJoin(base: string, file: string): string {
  return `${base}/${file.split('/').map(encodeURIComponent).join('/')}`
}
