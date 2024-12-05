const generateScript = require('./generate-script.js')

/**
 * Runs v8 bytecode buffer and returns the result.
 *
 * @param {Buffer} bytecodeBuffer - The buffer object that was created using compileCode function.
 * @returns {any} - The result of the very last statement executed in the script.
 */
module.exports = function runBytecode(bytecodeBuffer) {
  if (!Buffer.isBuffer(bytecodeBuffer)) {
    throw new Error('bytecodeBuffer must be a buffer object.')
  }

  const script = generateScript(bytecodeBuffer)

  return script.runInThisContext()
}
