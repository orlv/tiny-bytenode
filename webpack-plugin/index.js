import compileFile from '../src/compile-file.js'
import path from 'node:path'
import webpack from 'webpack'
import fs from 'node:fs'
import { transformAsync } from '@babel/core'
import transformArrowFunctionsPlugin from '@babel/plugin-transform-arrow-functions'
import transformClassesPlugin from '@babel/plugin-transform-classes'

const TMP_LOADER_NAME = '-jsc-loader'
const LOADER_TMP_DIR = '_jsc-loaders'

export default class TinyBytenodeWebpackPlugin {
  name = 'TinyBytenodeWebpackPlugin'

  /**
   * @param {object} [params]
   * @param {boolean} [params.compileAsModule]
   * @param {boolean} [params.compileForElectron]
   * @param {boolean} [params.compileForElectronMain]
   * @param {boolean} [params.compileForElectronRenderer]
   * @param {string} [params.electronPath]
   * @param {boolean} [params.keepSource]
   * @param {boolean} [params.sourcemap]
   * @param {boolean} [params.transformArrowFunctions]
   * @param {boolean} [params.transformClasses] - Transform classes. Actual for VueJS.
   * @param {boolean} [params.generateLoader]
   * @param {boolean} [params.excludeFromHTML]
   */
  constructor({
    compileAsModule = true,
    compileForElectron,
    compileForElectronMain = false,
    compileForElectronRenderer = false,
    electronPath,
    keepSource = false,
    sourcemap = false,
    transformArrowFunctions = true,
    transformClasses = false,
    generateLoader = true,
    excludeFromHTML = true
  } = {}) {
    this.compileAsModule = compileAsModule
    this.compileForElectron = compileForElectron
    this.compileForElectronMain = compileForElectronMain
    this.compileForElectronRenderer = compileForElectronRenderer
    this.electronPath = electronPath
    this.keepSource = keepSource
    this.sourcemap = sourcemap
    this.generateLoader = generateLoader
    this.excludeFromHTML = excludeFromHTML
    this.tmpDirs = new Set()

    this.babelPlugins = []

    if (transformArrowFunctions) {
      this.babelPlugins.push(transformArrowFunctionsPlugin)
    }

    if (transformClasses) {
      this.babelPlugins.push(transformClassesPlugin)
    }
  }

  apply(compiler) {
    compiler.options.devtool = this.sourcemap ? compiler.options.devtool || 'source-map' : false

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
          const loaderFileName = `${loaderEntryName}.cjs` // rename file later

          const tmpDir = path.resolve(compiler.outputPath, LOADER_TMP_DIR)
          fs.mkdirSync(path.dirname(tmpDir), { recursive: true })
          this.tmpDirs.add(tmpDir)

          const loaderFilePath = path.resolve(tmpDir, loaderFileName)
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
            loader: false,
            loaderOutPath: '',
            assetOutPath: '',
            compiled: false
          })
          entryMap[loaderEntryName] = { loader: true, entryInfo }

          fs.mkdirSync(path.dirname(loaderFilePath), { recursive: true })
          fs.writeFileSync(loaderFilePath, code, 'utf8')

          if (this.excludeFromHTML) {
            const htmlPlugin = compiler.options.plugins.find((p) => p.constructor?.name === 'HtmlWebpackPlugin')

            if (htmlPlugin) {
              if (!htmlPlugin.options.excludeChunks) {
                htmlPlugin.options.excludeChunks = []
              }

              htmlPlugin.options.excludeChunks.push(loaderEntryName)
            }
          }
        }
      })
    }

    if (this.babelPlugins.length) {
      compiler.hooks.compilation.tap(this.name, (compilation) => {
        compilation.hooks.processAssets.tapPromise(
          {
            name: this.name,
            stage: webpack.Compilation.PROCESS_ASSETS_STAGE_DERIVED
          },
          async (assets) => {
            for (const [pathname, source] of Object.entries(assets)) {
              const before = source.buffer().toString()
              const { code, map } = await transformAsync(before, {
                plugins: this.babelPlugins,
                sourceMaps: this.sourcemap,
                sourceFileName: pathname,
                inputSourceMap: this.sourcemap ? source.map() || undefined : undefined
              })
              const after = map
                ? new webpack.sources.SourceMapSource(code || '', pathname, map)
                : new webpack.sources.RawSource(code || '')

              compilation.updateAsset(pathname, after)
            }
          }
        )
      })
    }

    compiler.hooks.afterEmit.tapPromise(this.name, async (compilation) => {
      const output = compiler.options.output.path

      for (const tmpPath of this.tmpDirs.values()) {
        try {
          await fs.promises.rm(tmpPath, { recursive: true })
        } catch {
          //
        }
      }

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
          if (this.electronPath && !fs.existsSync(this.electronPath)) {
            throw new Error('Electron not found.')
          }

          const res = await compileFile({
            filename: assetOutPath,
            output: path.resolve(output, entry.jscFileName),
            compileAsModule: this.compileAsModule,
            electron,
            electronMain: this.compileForElectronMain,
            electronRenderer: this.compileForElectronRenderer,
            electronPath: this.electronPath
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
