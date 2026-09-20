import type { Plugin } from 'vite'

export default function TinyBytenodeVitePlugin(options?: {
  compileAsModule?: boolean
  compileForElectron?: boolean
  compileForElectronMain?: boolean
  compileForElectronRenderer?: boolean
  electronPath?: string
  keepSource?: boolean
  transformArrowFunctions?: boolean
  transformClasses?: boolean
  generateLoader?: boolean
  excludeFromHTML?: boolean
}): Plugin
