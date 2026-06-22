// src/core/atomic-write.ts
// 原子写：写到同目录临时文件 → rename 替换（同一文件系统 rename 原子）。
// 进程中途被杀/断电只会留下未被 rename 的临时文件，目标文件要么是旧内容要么是新内容，不会半截。
// 普通写/改失败（磁盘满、权限错）时尽力删掉临时文件，避免在库根留下孤儿 .tmp-*。
import { writeFile as fsWriteFile, rename as fsRename, unlink as fsUnlink } from 'node:fs/promises'

export interface AtomicFs {
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

const nodeFs: AtomicFs = { writeFile: fsWriteFile, rename: fsRename }

export async function atomicWriteFile(filePath: string, data: string, fs: AtomicFs = nodeFs): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  try {
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fsUnlink(tmp).catch(() => {})   // best-effort 清理，删不掉也不掩盖原错误
    throw err
  }
}
