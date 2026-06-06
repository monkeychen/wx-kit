// src/core/exporter/export-cover.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
}

/** 给定封面二进制与内容类型，落盘 cover.<ext>，返回文件名 */
export async function writeCover(dir: string, data: Buffer, contentType: string): Promise<string> {
  const ext = EXT_BY_TYPE[contentType.split(';')[0].trim().toLowerCase()] ?? 'jpg'
  const name = `cover.${ext}`
  await writeFile(join(dir, name), data)
  return name
}
