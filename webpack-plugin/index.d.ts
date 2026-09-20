import type { Compiler } from 'webpack'

export default class TinyBytenodeWebpackPlugin {
  constructor(options?: {
    compileAsModule?: boolean
    compileForElectron?: boolean
    compileForElectronMain?: boolean
    compileForElectronRenderer?: boolean
    electronPath?: string
    keepSource?: boolean
    sourcemap?: boolean
    transformArrowFunctions?: boolean
    transformClasses?: boolean
    generateLoader?: boolean
    excludeFromHTML?: boolean
  })
  apply(compiler: Compiler): void
}
