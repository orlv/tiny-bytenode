import type { Compiler } from 'webpack'

export default class TinyBytenodeWebpackPlugin {
  constructor(options?: {
    compileAsModule?: boolean
    compileForElectron?: boolean
    compileForElectronMain?: boolean
    electronPath?: string
    keepSource?: boolean
    preventSourceMaps?: boolean
    transformArrowFunctions?: boolean
    transformClasses?: boolean
    generateLoader?: boolean
    excludeFromHTMLPlugin?: boolean
  })
  apply(compiler: Compiler): void
}
