import { appendFile, chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MpRequestAuditEvent } from './mp-request-gateway'

/** 只写 gateway 已脱敏的 host+path；类型上没有 token/Cookie/query 字段。 */
export class MpRequestAudit {
  private readonly path: string
  constructor(private readonly storeDir: string) {
    this.path = join(storeDir, 'mp-request-audit.log')
  }

  async append(event: MpRequestAuditEvent): Promise<void> {
    await mkdir(this.storeDir, { recursive: true })
    await appendFile(this.path, JSON.stringify(event) + '\n', { encoding: 'utf-8', mode: 0o600 })
    await chmod(this.path, 0o600).catch(() => {})
  }
}
