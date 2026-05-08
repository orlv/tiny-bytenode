import babel from '@babel/core'
import fs from 'node:fs'
import path from 'node:path'
import compileFile from '../src/compile-file.js'

const virtualLoaderPrefix = '\0tiny-bytenode-vite-loader:'

/**
 * @param {object} [params]
 * @param {boolean} [params.compileAsModule]
 * @param {boolean} [params.compileForElectron]
 * @param {string} [params.electronPath]
 * @param {boolean} [params.keepSource]
 * @param {boolean} [params.transformArrowFunctions]
 * @param {boolean} [params.transformClasses]
 * @param {boolean} [params.generateLoader]
 * @param {boolean} [params.excludeFromHTML]
 * @returns {object}
 */
export default function TinyBytenodeVitePlugin({
  compileAsModule = true,
  compileForElectron = false,
  electronPath = '',
  keepSource = false,
  transformArrowFunctions = true,
  transformClasses = false,
  generateLoader = true,
  excludeFromHTML = true
} = {}) {
  const options = {
    compileAsModule,
    compileForElectron,
    electronPath,
    keepSource,
    transformArrowFunctions,
    transformClasses,
    generateLoader,
    excludeFromHTML
  }

  const loaderEntries = []
  let config = null

  return {
    name: 'tiny-bytenode-vite',
    apply: 'build',
    config() {
      return { build: { sourcemap: false } }
    },
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },
    options(rollupOptions) {
      if (!generateLoader) {
        return null
      }

      loaderEntries.splice(0)

      for (const entry of parseInputEntries(rollupOptions.input || config?.build?.lib?.entry, config)) {
        loaderEntries.push(entry)
      }

      return null
    },
    buildStart() {
      if (!generateLoader) {
        return
      }

      for (const entry of loaderEntries) {
        this.emitFile({
          type: 'chunk',
          id: entry.loaderId,
          name: entry.loaderName,
          fileName: `${entry.loaderName}-jsc-loader.cjs`
        })
      }
    },
    resolveId(id) {
      return id.startsWith(virtualLoaderPrefix) ? id : null
    },
    load(id) {
      if (!id.startsWith(virtualLoaderPrefix)) {
        return null
      }

      return [
        `import '@orlv/tiny-bytenode/src/loader.js'`,
        `require('./' + __filename.split(/[\\\\/]/).pop().replace(/\\.[cm]?js$/, '.jsc'))`,
        ''
      ].join('\n')
    },
    async writeBundle(outputOptions, bundle) {
      if (config?.build?.watch) {
        return
      }

      if (generateLoader && !compileAsModule) {
        throw new Error('TinyBytenodeVitePlugin cannot generate a CommonJS loader when compileAsModule is false.')
      }

      if (electronPath && !fs.existsSync(electronPath)) {
        throw new Error('Electron not found.')
      }

      let outputDir =
        outputOptions.dir || (outputOptions.file ? path.dirname(outputOptions.file) : config?.build?.outDir)

      if (!outputDir) {
        throw new Error('Cannot resolve Vite output directory for bytecode compilation.')
      }

      if (!path.isAbsolute(outputDir)) {
        outputDir = path.resolve(config?.root || process.cwd(), outputDir)
      }

      const chunks = Object.values(bundle).filter((chunk) => {
        return (
          chunk?.type === 'chunk' &&
          chunk.isEntry &&
          /\.(?:c|m)?js$/.test(chunk.fileName) &&
          !chunk.facadeModuleId?.startsWith(virtualLoaderPrefix)
        )
      })
      const compiledFiles = []
      const inlinedChunks = new Set()

      const babelPlugins = []

      if (transformArrowFunctions) {
        babelPlugins.push('@babel/plugin-transform-arrow-functions')
      }

      if (transformClasses) {
        babelPlugins.push('@babel/plugin-transform-classes')
      }

      const transform = !compileAsModule || babelPlugins.length

      for (const chunk of chunks) {
        const entryPath = path.join(outputDir, chunk.fileName)

        await inlineLocalChunkRequires(entryPath, outputDir, inlinedChunks)

        if (transform) {
          const source = await fs.promises.readFile(entryPath, 'utf8')

          let code = compileAsModule
            ? source
            : `(async function () { ${source.replaceAll('import.meta.url', 'document.baseURI')} })().catch(function (e) { console.error(e) })`

          if (babelPlugins.length) {
            code = (
              await babel.transformAsync(code, {
                filename: entryPath,
                babelrc: false,
                configFile: false,
                compact: false,
                comments: false,
                sourceMaps: false,
                plugins: babelPlugins
              })
            )?.code
          }

          await fs.promises.writeFile(entryPath, code, 'utf8')
        }

        const bytecodePath = entryPath.replace(/\.[cm]?js$/, '.jsc')

        await compileFile({
          filename: entryPath,
          output: bytecodePath,
          compileAsModule,
          electron: compileForElectron,
          electronPath
        })

        if (options.keepSource) {
          const extname = path.extname(entryPath)
          await fs.promises.rename(entryPath, entryPath.replace(new RegExp(`(\\${extname})$`), `.orig$1`))
        } else {
          await fs.promises.rm(entryPath)
        }

        const stat = await fs.promises.stat(bytecodePath)
        console.log(`Electron bytecode compiled: ${bytecodePath} (${stat.size} bytes).`)

        compiledFiles.push(chunk.fileName)

        if (generateLoader) {
          const loaderPath = await moveLoaderToEntry(outputDir, bundle, chunk, loaderEntries)
          await inlineLocalChunkRequires(loaderPath, outputDir, inlinedChunks)
        }
      }

      for (const chunkFileName of inlinedChunks) {
        await fs.promises.rm(path.join(outputDir, chunkFileName), { force: true })
        await fs.promises.rm(path.join(outputDir, `${chunkFileName}.map`), { force: true })
      }

      if (excludeFromHTML && !generateLoader) {
        await removeScriptsFromHtml(outputDir, bundle, compiledFiles)
      }
    }
  }
}

/**
 * @param {string|object[]|object} input
 * @param {object|null} config
 * @returns {Array}
 */
function parseInputEntries(input, config) {
  if (!input) {
    return []
  }

  const entries = []
  const addEntry = (name, value) => {
    if (typeof value !== 'string') {
      return
    }

    const inputPath = path.resolve(config?.root || process.cwd(), value)
    const loaderName = uniqueLoaderName((name || path.parse(value).name).replace(/[^a-zA-Z0-9_-]/g, '-'), entries)
    const loaderId = `${virtualLoaderPrefix}${loaderName}`

    entries.push({ inputPath, loaderId, loaderName })
  }

  if (typeof input === 'string') {
    addEntry(path.parse(input).name, input)
  } else if (Array.isArray(input)) {
    for (const value of input) {
      addEntry(path.parse(value).name, value)
    }
  } else if (typeof input === 'object') {
    for (const [name, value] of Object.entries(input)) {
      addEntry(name, value)
    }
  }

  return entries
}

/**
 * @param {string} name
 * @param {Array} entries
 * @returns {string}
 */
function uniqueLoaderName(name, entries) {
  let nextName = name
  let index = 1

  while (entries.some((entry) => entry.loaderName === nextName)) {
    index += 1
    nextName = `${name}-${index}`
  }

  return nextName
}

/**
 * @param {string} outputDir
 * @param {Record<string, object>} bundle
 * @param {object} chunk
 * @param {Array} loaderEntries
 * @returns {Promise<string>}
 */
async function moveLoaderToEntry(outputDir, bundle, chunk, loaderEntries) {
  const chunkInputPath = path.resolve(chunk.facadeModuleId || '')
  const loaderEntry = loaderEntries.find((entry) => entry.inputPath === chunkInputPath)

  if (!loaderEntry) {
    throw new Error(`Cannot find generated loader for '${chunk.fileName}'.`)
  }

  const loaderChunk = Object.values(bundle).find((item) => item?.facadeModuleId === loaderEntry.loaderId)

  if (!loaderChunk) {
    throw new Error(`Cannot find generated loader chunk for '${chunk.fileName}'.`)
  }

  const loaderPath = path.join(outputDir, chunk.fileName)

  await fs.promises.rename(path.join(outputDir, loaderChunk.fileName), loaderPath)
  await fs.promises.rm(path.join(outputDir, `${loaderChunk.fileName}.map`), { force: true })

  return loaderPath
}

/**
 * @param {string} filename
 * @param {string} outputDir
 * @param {Set<string>} inlinedChunks
 */
async function inlineLocalChunkRequires(filename, outputDir, inlinedChunks) {
  const source = await fs.promises.readFile(filename, 'utf8')
  const nextSource = source.replace(
    /\b(const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*require\(([`'"])\.\/(chunk-[^`'"]+\.cjs)\3\);?/g,
    (statement, declaration, name, quote, chunkFileName) => {
      const chunkPath = path.join(outputDir, chunkFileName)

      if (!fs.existsSync(chunkPath)) {
        return statement
      }

      inlinedChunks.add(chunkFileName)

      return [
        `${declaration} ${name}=(()=>{`,
        `const module={exports:{}};`,
        `const exports=module.exports;`,
        fs.readFileSync(chunkPath, 'utf8'),
        `return module.exports;`,
        `})();`
      ].join('\n')
    }
  )

  await fs.promises.writeFile(filename, nextSource, 'utf8')
}

/**
 * @param {string} outputDir
 * @param {Record<string, object>} bundle
 * @param {string[]} compiledFiles
 */
async function removeScriptsFromHtml(outputDir, bundle, compiledFiles) {
  const htmlFiles = Object.values(bundle)
    .filter((item) => item?.type === 'asset' && item.fileName.endsWith('.html'))
    .map((item) => item.fileName)
  const compiled = new Set(compiledFiles.map((v) => v.replace(/^(?:\.\/|\/+)/, '')))

  for (const fileName of htmlFiles) {
    const htmlPath = path.join(outputDir, fileName)
    const html = await fs.promises.readFile(htmlPath, 'utf8')
    const nextHtml = html.replace(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>\s*<\/script>\s*/g, (tag, src) =>
      compiled.has(src.replace(/^(?:\.\/|\/+)/, '')) ? '' : tag
    )

    if (nextHtml !== html) {
      await fs.promises.writeFile(htmlPath, nextHtml, 'utf8')
    }
  }
}
