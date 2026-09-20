import type { Plugin } from 'vite'

export default function TinyBytenodeVitePlugin(options?: {
  compileAsModule?: boolean
  compileForElectronMain?: boolean
  compileForElectronRenderer?: boolean
  compileForElectron?: boolean
  electronPath?: string
  keepSource?: boolean
  sourcemap?: boolean
  transformArrowFunctions?: boolean
  transformClasses?: boolean
  generateLoader?: boolean
  excludeFromHTML?: boolean
}): Plugin
