import type { Buffer } from 'node:buffer'
import type { Script } from 'node:vm'

export default function generateScript(cachedData: Buffer, filename?: string): Script
