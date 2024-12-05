const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const generateScript = require('./generate-script.js')

const COMPILED_EXTNAME = '.jsc'

Module._extensions[COMPILED_EXTNAME] = function (fileModule, filename) {
  const bytecodeBuffer = fs.readFileSync(filename)

  const script = generateScript(bytecodeBuffer, filename)

  // This part is based on:
  // https://github.com/zertosh/v8-compile-cache/blob/7182bd0e30ab6f6421365cee0a0c4a8679e9eb7c/v8-compile-cache.js#L158-L178

  /**
   * @param {string} id
   * @returns {*}
   */
  function require(id) {
    return fileModule.require(id)
  }

  require.resolve = function (request, options) {
    return Module._resolveFilename(request, fileModule, false, options)
  }

  if (process.main) {
    require.main = process.main
  }

  require.extensions = Module._extensions
  require.cache = Module._cache

  const compiledWrapper = script.runInThisContext({
    filename,
    lineOffset: 0,
    columnOffset: 0,
    displayErrors: true
  })

  const dirname = path.dirname(filename)
  const args = [fileModule.exports, require, fileModule, filename, dirname, process, global]

  return compiledWrapper.apply(fileModule.exports, args)
}
