import type { Buffer } from 'node:buffer'

export default function compileElectronCode(
  code: string,
  options?: {
    electronPath?: string
    electronMain?: boolean
    compress?: boolean
  }
): Promise<Buffer>
