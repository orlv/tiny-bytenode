// import fs from 'fs'
// import path from 'path'
// import assert from 'assert'
// import { spawn } from 'child_process'
// import { after, before, describe, it } from 'mocha'
// import electronPath from 'electron'
// import { compileFile } from '../src/compile-file.js'
// import { fileURLToPath } from 'node:url'
// import { createRequire } from 'node:module'
// import { compileCode } from '../src/compile.js'
// import { runBytecode } from '../src/run-bytecode.js'
// import { compileElectronCode } from '../src/compile-electron.js'
// import '../src/loader.js'

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { spawn } = require('child_process')
const { after, before, describe, it } = require('mocha')
const electronPath = require('electron')
const compileFile = require('../src/compile-file.js')
// const { fileURLToPath } = require('node:url')
// const { createRequire } = require('node:module')
const compileCode = require('../src/compile.js')
const runBytecode = require('../src/run-bytecode.js')
const compileElectronCode = require('../src/compile-electron.js')

require('../src/loader.js')

// const require = createRequire(import.meta.url)
// const __dirname = fileURLToPath(path.dirname(import.meta.url))

const TEMP_DIR = 'temp'
const TEST_FILE = 'testfile.js'
const TEST_CODE = "console.log('      Greetings from Bytenode!');43;"

/**
 * @param {string} moduleName
 * @param {string} output
 */
function createLoader(moduleName, output) {
  const code = [
    `import { createRequire } from 'node:module'`,
    `import '../../loader.js'`,
    ``,
    `const require = createRequire(import.meta.url)`,
    ``,
    `require('${moduleName}')`,
    ``,
    ``
  ].join('\n')

  fs.writeFileSync(output, code)
}

describe('Bytenode', () => {
  let bytecode

  describe('compileCode()', () => {
    it('compiles without error', () => {
      assert.doesNotThrow(() => {
        bytecode = compileCode(TEST_CODE)
      })
    })
    it('returns non-zero-length buffer', () => {
      assert.notStrictEqual(bytecode.length, 0)
    })
  })

  describe('compileCode(), with compress = true', () => {
    it('compiles without error', () => {
      assert.doesNotThrow(() => {
        bytecode = compileCode(TEST_CODE, true)
      })
    })
    it('returns non-zero-length buffer', () => {
      assert.notStrictEqual(bytecode.length, 0)
    })
  })

  describe('compileElectronCode()', () => {
    it('compiles code', async () => {
      let eBytecode
      await assert.doesNotReject(async () => {
        eBytecode = await compileElectronCode(TEST_CODE)
      }, 'Rejection Error Compiling For Electron')
      // @ts-ignore
      assert.notStrictEqual(eBytecode.length, 0, 'Zero Length Buffer')
    })

    it('compiles code, with compress = true', async () => {
      let eBytecode
      await assert.doesNotReject(async () => {
        eBytecode = await compileElectronCode(TEST_CODE, {
          compress: true
        })
      }, 'Rejection Error Compiling For Electron')
      // @ts-ignore
      assert.notStrictEqual(eBytecode.length, 0, 'Zero Length Buffer')
    })

    it('compiles code with electron path', async () => {
      let eBytecode
      await assert.doesNotReject(async () => {
        eBytecode = await compileElectronCode(TEST_CODE, {
          electronPath
        })
      }, 'Rejection Error Compiling For Electron')
      // @ts-ignore
      assert.notStrictEqual(eBytecode.length, 0, 'Zero Length Buffer')
    })
  })

  describe('runBytecode()', () => {
    it('runs without error', () => {
      assert.doesNotThrow(() => {
        const result = runBytecode(bytecode)

        assert.strictEqual(result, 43)
      })
    })
  })

  describe('compileFile()', () => {
    // create temp directory
    const tempPath = path.join(__dirname, TEMP_DIR)
    before(() => {
      if (!fs.existsSync(tempPath)) {
        fs.mkdirSync(tempPath)
      }
    })

    const testFilePath = path.join(__dirname, TEST_FILE)
    const outputFile = path.join(tempPath, TEST_FILE.replace('.js', '.jsc'))
    const loaderFile = path.join(tempPath, TEST_FILE)

    it('creates non-zero length binary and loader files', async () => {
      await assert.doesNotReject(() => {
        return new Promise((resolve, reject) => {
          try {
            createLoader(path.basename(outputFile), loaderFile)

            compileFile({
              filename: testFilePath,
              output: outputFile
              // loaderFilename: '%.js'
            }).then(() => resolve())
          } catch (err) {
            reject(err)
          }
        })
      })

      const jscStats = fs.statSync(outputFile)
      assert.ok(jscStats.isFile(), ".jsc File Doesn't Exist")
      assert.ok(jscStats.size, 'Zero Length .jsc File')

      const loaderStats = fs.statSync(loaderFile)
      assert.ok(loaderStats.isFile(), "Loader File Doesn't Exist")
      assert.ok(loaderStats.size, 'Zero Length Loader File')
    })

    it('compiles with compress = true', async () => {
      await assert.doesNotReject(() => {
        return new Promise((resolve, reject) => {
          try {
            compileFile({
              filename: testFilePath,
              output: outputFile,
              compress: true
            }).then(() => resolve())
          } catch (err) {
            reject(err)
          }
        })
      })
      const jscStats = fs.statSync(outputFile)
      assert.ok(jscStats.isFile(), ".jsc File Doesn't Exist")
      assert.ok(jscStats.size, 'Zero Length .jsc File')
      const loaderStats = fs.statSync(loaderFile)
      assert.ok(loaderStats.isFile(), "Loader File Doesn't Exist")
      assert.ok(loaderStats.size, 'Zero Length Loader File')
    })

    it('runs the .jsc file via require()', () => {
      assert.doesNotThrow(() => {
        const result = require(outputFile)

        assert.strictEqual(result, 42)
      }, 'Error While Running Loader File')
    })

    after(() => {
      if (fs.existsSync(tempPath)) {
        rimraf(tempPath)
      }
    })
  })

  describe('compileFile() for Electron', () => {
    // create temp directory
    const tempPath = path.join(__dirname, TEMP_DIR)
    before(() => {
      if (!fs.existsSync(tempPath)) {
        fs.mkdirSync(tempPath)
      }
    })

    const testFilePath = path.join(__dirname, TEST_FILE)
    const outputFile = path.join(tempPath, TEST_FILE.replace('.js', '.jsc'))
    const loaderFile = path.join(tempPath, TEST_FILE)

    it('creates non-zero length binary and loader files', async () => {
      await assert.doesNotReject(() => {
        return new Promise((resolve, reject) => {
          createLoader(path.basename(outputFile), loaderFile)

          compileFile({
            filename: testFilePath,
            output: outputFile,
            loaderFilename: '%.js',
            electron: true
          })
            .then(() => resolve())
            .catch((err) => reject(err))
        })
      })
      const jscStats = fs.statSync(outputFile)
      assert.ok(jscStats.isFile(), ".jsc File Doesn't Exist")
      assert.ok(jscStats.size, 'Zero Length .jsc File')
      const loaderStats = fs.statSync(loaderFile)
      assert.ok(loaderStats.isFile(), "Loader File Doesn't Exist")
      assert.ok(loaderStats.size, 'Zero Length Loader File')
    })

    it('runs the .jsc file via Electron', async () => {
      await assert.doesNotReject(() => {
        return new Promise((resolve, reject) => {
          const electronPath = require('electron')
          const bytenodePath = path.resolve(__dirname, '../lib/cli.js')
          const proc = spawn(electronPath, [bytenodePath, outputFile], {
            env: { ELECTRON_RUN_AS_NODE: '1' }
          })
          proc.on('message', (message) => console.log(message))
          proc.on('error', (err) => reject(err))
          proc.on('exit', () => resolve())
        })
      }, 'Rejected While Running .jsc in Electron')
    })

    it('creates non-zero length binary and loader files with electron path', async () => {
      rimraf(tempPath, false)
      await assert.doesNotReject(() => {
        return new Promise((resolve, reject) => {
          createLoader(path.basename(outputFile), loaderFile)

          compileFile({
            filename: testFilePath,
            output: outputFile,
            loaderFilename: '%.js',
            electronPath
          })
            .then(resolve)
            .catch(reject)
        })
      })
      const jscStats = fs.statSync(outputFile)
      assert.ok(jscStats.isFile(), ".jsc File Doesn't Exist")
      assert.ok(jscStats.size, 'Zero Length .jsc File')
      const loaderStats = fs.statSync(loaderFile)
      assert.ok(loaderStats.isFile(), "Loader File Doesn't Exist")
      assert.ok(loaderStats.size, 'Zero Length Loader File')
    })

    it('runs the .jsc file via Electron', async () => {
      await assert.doesNotReject(() => {
        return new Promise((resolve, reject) => {
          const electronPath = require('electron')
          const bytenodePath = path.resolve(__dirname, '../lib/cli.js')
          const proc = spawn(electronPath, [bytenodePath, outputFile], {
            env: { ELECTRON_RUN_AS_NODE: '1' }
          })
          proc.on('message', (message) => console.log(message))
          proc.on('error', (err) => reject(err))
          proc.on('exit', () => resolve())
        })
      }, 'Rejected While Running .jsc in Electron')
    })

    after(() => {
      if (fs.existsSync(tempPath)) {
        rimraf(tempPath)
      }
    })
  })
})

/**
 * Remove directory recursively
 * @param {string} dirPath - Path to directory
 * @param {boolean} [removeSelf] - Remove directory itself
 * @see https://stackoverflow.com/a/42505874/14350317
 */
function rimraf(dirPath, removeSelf = true) {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach(function (entry) {
      const entryPath = path.join(dirPath, entry)
      if (fs.lstatSync(entryPath).isDirectory()) {
        rimraf(entryPath)
      } else {
        fs.unlinkSync(entryPath)
      }
    })
    if (removeSelf) {
      fs.rmdirSync(dirPath)
    }
  } else {
    if (!removeSelf) {
      fs.mkdirSync(dirPath)
    }
  }
}
