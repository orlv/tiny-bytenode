const path = require('node:path')
const webpack = require('webpack')
const fs = require('node:fs')
const compileFile = require('../src/compile-file.js')

const TMP_LOADER_NAME = '-jsc-loader'

module.exports = class TinyBytenodeWebpackPlugin {
  name = 'TinyBytenodeWebpackPlugin'

  /**
   * @param {object} [params]
   * @param {boolean} [params.compileAsModule]
   * @param {boolean} [params.compileForElectron]
   * @param {boolean} [params.keepSource]
   * @param {boolean} [params.preventSourceMaps]
   * @param {boolean} [params.transformArrowFunctions]
   * @param {boolean} [params.transformClasses] - Transform classes. Actual for VueJS.
   * @param {boolean} [params.generateLoader]
   */
  constructor({
    compileAsModule = true,
    compileForElectron,
    keepSource = false,
    preventSourceMaps = true,
    transformArrowFunctions = true,
    transformClasses = false,
    generateLoader = true
  } = {}) {
    this.compileAsModule = compileAsModule
    this.compileForElectron = compileForElectron
    this.keepSource = keepSource
    this.preventSourceMaps = preventSourceMaps
    this.generateLoader = generateLoader

    this.babelPlugins = []

    if (transformArrowFunctions) {
      this.babelPlugins.push('@babel/plugin-transform-arrow-functions')
    }

    if (transformClasses) {
      this.babelPlugins.push('@babel/plugin-transform-classes')
    }
  }

  apply(compiler) {
    if (this.preventSourceMaps) {
      compiler.options.devtool = false
    }

    const entryMap = {}

    // Convert externals to array
    if (!Array.isArray(compiler.options.externals)) {
      if (!compiler.options.externals) {
        compiler.options.externals = []
      } else if (typeof compiler.options.externals === 'string') {
        compiler.options.externals = [{ [compiler.options.externals]: compiler.options.externals }]
      } else if (['object', 'function'].includes(typeof compiler.options.externals)) {
        compiler.options.externals = [compiler.options.externals]
      }
    }

    compiler.options.externals.push(({ context, request }, callback) => {
      if (/\.jsc/.test(request)) {
        return callback(null, `commonjs ${request}`)
      }

      callback()
    })

    if (this.generateLoader) {
      compiler.hooks.entryOption.tap(this.name, (context, entry) => {
        const entries = Object.keys(entry)

        for (const entryName of entries) {
          const jscFileName = `./${entryName}.jsc`
          const loaderEntryName = `${entryName}${TMP_LOADER_NAME}`
          const loaderFileName = `${loaderEntryName}.js` // rename file later

          const loaderFilePath = path.resolve(compiler.outputPath, loaderFileName)
          new webpack.EntryPlugin(context, loaderFilePath, loaderEntryName).apply(compiler)

          const code = [
            `const fs = require('node:fs')`,
            `const path = require('node:path')`,
            `require('@orlv/tiny-bytenode/src/loader.js')`,
            `require('${jscFileName}')`,
            ''
          ].join('\n')

          const entryInfo = (entryMap[entryName] = {
            jscFileName,
            loaderFileName,
            loaderFilePath,
            loader: false,
            loaderOutPath: '',
            assetOutPath: '',
            compiled: false
          })
          entryMap[loaderEntryName] = { loader: true, entryInfo }

          fs.mkdirSync(path.dirname(loaderFilePath), { recursive: true })
          fs.writeFileSync(loaderFilePath, code, 'utf8')
        }
      })
    }

    if (this.babelPlugins.length) {
      const babel = require('@babel/core')

      compiler.hooks.compilation.tap(this.name, (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: this.name,
            stage: webpack.Compilation.PROCESS_ASSETS_STAGE_DERIVED
          },
          (assets) => {
            for (const [pathname, source] of Object.entries(assets)) {
              const before = source.buffer().toString()
              const { code } = babel.transform(before, { plugins: this.babelPlugins })
              const after = new webpack.sources.RawSource(code || '')

              compilation.updateAsset(pathname, after)
            }
          }
        )
      })
    }

    compiler.hooks.afterEmit.tapPromise(this.name, async (compilation) => {
      const output = compiler.options.output.path

      const electron =
        this.compileForElectron ||
        (typeof this.compileForElectron !== 'boolean' && compiler.options.target.includes('electron'))

      const fileToEntry = {}

      for (const [entryName, entrypoint] of compilation.entrypoints.entries()) {
        const entry = entryMap[entryName]

        if (!entry) {
          continue
        }

        for (const chunk of entrypoint.chunks) {
          for (const filename of chunk.files) {
            if (/\.[mc]?js$/.test(filename)) {
              fileToEntry[filename] = entry
            }
          }
        }
      }

      const files = Object.keys(compilation.assets).filter((filename) => /\.[mc]?js$/.test(filename))

      for (const filename of files) {
        const entry = fileToEntry[filename]

        if (!entry) {
          throw new Error(`Unknown file '${filename}'`)
        }

        const assetOutPath = path.resolve(output, filename)

        if (entry.loader) {
          entry.entryInfo.loaderOutPath = assetOutPath

          // Rename loader
          if (this.generateLoader && entry.entryInfo.assetOutPath) {
            await fs.promises.rename(assetOutPath, entry.entryInfo.assetOutPath)
          }
        } else {
          const res = await compileFile({
            filename: assetOutPath,
            output: path.resolve(output, entry.jscFileName),
            compileAsModule: this.compileAsModule,
            electron
          })

          if (res) {
            entry.compiled = true
            entry.assetOutPath = assetOutPath
            const stat = fs.statSync(res)

            console.log(`JSC module '${res}' compiled. Size: ${stat.size} bytes.`)

            if (this.keepSource) {
              const extname = path.extname(assetOutPath)
              await fs.promises.rename(assetOutPath, assetOutPath.replace(new RegExp(`(\\${extname})$`), '.orig$1'))
            } else {
              await fs.promises.rm(assetOutPath)
            }

            // Rename loader
            if (this.generateLoader && entry.loaderOutPath) {
              await fs.promises.rename(entry.loaderOutPath, assetOutPath)
            }
          }
        }
      }
    })
  }
}
