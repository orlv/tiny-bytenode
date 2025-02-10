const { brotliDecompressSync } = require('node:zlib')
const compileCode = require('./compile.js')
const vm = require('node:vm')

const MAGIC_NUMBER = Buffer.from([0xde, 0xc0])
const ZERO_LENGTH_EXTERNAL_REFERENCE_TABLE = Buffer.alloc(2)

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isBufferV8Bytecode(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    !buffer.subarray(0, 2).equals(ZERO_LENGTH_EXTERNAL_REFERENCE_TABLE) &&
    buffer.subarray(2, 4).equals(MAGIC_NUMBER)
  )

  // TODO: check that code start + payload size = buffer length. See
  //       https://github.com/bytenode/bytenode/issues/210#issuecomment-1605691369
}

// TODO: rewrite this function
/**
 * @param {Buffer} bytecodeBuffer
 * @returns {number}
 * @throws
 */
function readSourceHash(bytecodeBuffer) {
  if (!Buffer.isBuffer(bytecodeBuffer)) {
    throw new Error('bytecodeBuffer must be a buffer object.')
  }

  // if (process.version.startsWith('v8.8') || process.version.startsWith('v8.9')) {
  //   // Node is v8.8.x or v8.9.x
  //   return bytecodeBuffer.subarray(12, 16).reduce((sum, number, power) => sum + number * Math.pow(256, power), 0)
  // }

  return bytecodeBuffer.subarray(8, 12).reduce((sum, number, power) => sum + number * Math.pow(256, power), 0)
}

// TODO: rewrite this function
/**
 * @param {Buffer} bytecodeBuffer
 */
function fixBytecode(bytecodeBuffer) {
  if (!Buffer.isBuffer(bytecodeBuffer)) {
    throw new Error('bytecodeBuffer must be a buffer object.')
  }

  const dummyBytecode = compileCode('"ಠ_ಠ"')
  const version = parseFloat(process.version.slice(1, 5))

  // if (process.version.startsWith('v8.8') || process.version.startsWith('v8.9')) {
  //   // Node is v8.8.x or v8.9.x
  //   dummyBytecode.subarray(16, 20).copy(bytecodeBuffer, 16)
  //   dummyBytecode.subarray(20, 24).copy(bytecodeBuffer, 20)
  // } else
  if (version >= 12 && version <= 23) {
    dummyBytecode.subarray(12, 16).copy(bytecodeBuffer, 12)
  } else {
    dummyBytecode.subarray(12, 16).copy(bytecodeBuffer, 12)
    dummyBytecode.subarray(16, 20).copy(bytecodeBuffer, 16)
  }
}

/**
 * @param {Buffer} cachedData
 * @param {string} [filename]
 * @returns {module:vm.Script}
 * @throws
 */
module.exports = function generateScript(cachedData, filename) {
  if (!isBufferV8Bytecode(cachedData)) {
    // Try to decompress as Brotli
    // eslint-disable-next-line no-param-reassign
    cachedData = brotliDecompressSync(cachedData)

    if (!isBufferV8Bytecode(cachedData)) {
      throw new Error('Invalid bytecode buffer')
    }
  }

  fixBytecode(cachedData)

  const length = readSourceHash(cachedData)

  const dummyCode =
    length > 1
      ? '"' + '\u200b'.repeat(length - 2) + '"' // "\u200b" Zero width space
      : ''

  const script = new vm.Script(dummyCode, { cachedData, filename })

  if (script.cachedDataRejected) {
    throw new Error('Invalid or incompatible cached data (cachedDataRejected)')
  }

  return script
}
