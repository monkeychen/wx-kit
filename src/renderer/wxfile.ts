// 把库内文章目录映射成 wxfile:// 基地址，供阅读器与书架封面读本地资源。
// dir 在 libraryRoot 之下时取相对子路径、逐段编码；否则（用户改过库根）回退原 dir，
// wxfile 协议会 403，对应资源不显示——这是预期的降级而非崩溃。
export function toWxfileBase(libraryRoot: string, dir: string): string {
  const rootPrefix = libraryRoot.replace(/[/\\]+$/, '') + '/'
  let rel = dir.startsWith(rootPrefix) ? dir.slice(rootPrefix.length) : dir
  rel = rel.replace(/^[/\\]+/, '').split(/[/\\]/).map(encodeURIComponent).join('/')
  return `wxfile://local/${rel}`
}

export function wxfileJoin(base: string, file: string): string {
  return `${base}/${file.split('/').map(encodeURIComponent).join('/')}`
}
