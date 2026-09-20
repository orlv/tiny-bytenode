import type { Buffer } from 'node:buffer'

export default function compileElectronCode(
  code: string,
  options?: {
    electronPath?: string
    electronMain?: boolean
    electronRenderer?: boolean
    compress?: boolean
  }
): Promise<Buffer>
