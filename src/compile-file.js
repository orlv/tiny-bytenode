const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const compileElectronCode = require('./compile-electron.js')
const compileCode = require('./compile.js')

/**
 * Compiles JavaScript file to .jsc file.
 *
 * @param {object} params
 * @param {string} params.filename - The JavaScript source file that will be compiled.
 * @param {boolean} [params.compileAsModule] - If true, the output will be a commonjs module.
 * @param {boolean} [params.compress] - If true, compress the output bytecode.
 * @param {string} [params.output] - The output filename. Defaults to the same path and name of the original file, but with `.jsc` extension.
 * @param {boolean} [params.electron] - If true, compile code for Electron.
 * @param {string} [params.electronPath] - Path to Electron executable.
 * @param {string} [params.ext] - Output file extension.
 * @returns {Promise<string>} - A Promise which returns the compiled filename.
 */
module.exports = async function compileFile({
  filename,
  compileAsModule = true,
  compress = false,
  output = '',
  electron = false,
  electronPath = '',
  ext = '.jsc'
}) {
  if (electronPath) {
    // eslint-disable-next-line no-param-reassign
    electron = true
  }

  if (typeof filename !== 'string') {
    throw new Error(`filename must be a string. ${typeof filename} was given.`)
  }

  if (!output) {
    // eslint-disable-next-line no-param-reassign
    output = `${filename.slice(0, -path.extname(filename).length)}${ext}`
  } else if (typeof output !== 'string') {
    throw new Error(`output must be a string. ${typeof output} was given.`)
  }

  const javascriptCode = (await fs.promises.readFile(filename, 'utf-8')).toString()

  let code = javascriptCode.replace(/^#!.*/, '')

  if (compileAsModule) {
    code = Module.wrap(code)
  }

  const bytecodeBuffer = electron
    ? await compileElectronCode(code, { compress, electronPath })
    : compileCode(code, compress)

  await fs.promises.writeFile(output, bytecodeBuffer)

  return output
}
