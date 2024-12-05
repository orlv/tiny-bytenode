const path = require('node:path')
const { brotliCompressSync } = require('node:zlib')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const v8 = require('node:v8')

v8.setFlagsFromString('--no-lazy')

if (Number.parseInt(process.versions.node, 10) >= 12) {
  v8.setFlagsFromString('--no-flush-bytecode') // Thanks to A-Parser (@a-parser)
}

/**
 * This function runs the compileCode() function (above) via a child process using Electron as Node
 *
 * @param {string} code
 * @param {object} [options]
 * @param {string} [options.electronPath] - Path to Electron executable, defaults to the installed node_modules/electron.
 * @param {boolean} [options.compress]
 * @returns {Promise<Buffer>} - Returns a Promise which resolves in the generated bytecode.
 */
module.exports = function compileElectronCode(code, { electronPath, compress } = {}) {
  return new Promise((resolve, reject) => {
    /** */
    function onEnd() {
      if (compress) {
        resolve(brotliCompressSync(data))
      } else {
        resolve(data)
      }
    }

    let data = Buffer.from([])

    if (electronPath) {
      // eslint-disable-next-line no-param-reassign
      electronPath = path.normalize(electronPath)
    } else {
      // eslint-disable-next-line no-param-reassign
      electronPath = require('electron')
    }

    if (!fs.existsSync(electronPath)) {
      throw new Error(`Electron not found at '${electronPath}'`)
    }

    const bytenodePath = path.resolve(__dirname, 'cli.js')

    // Create a subprocess in which we run Electron as our Node and V8 engine
    // Running Bytenode to compile our code through stdin/stdout
    const child = spawn(electronPath, [bytenodePath, '--compile', '--no-module'], {
      env: { ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    })

    if (child.stdin) {
      child.stdin.write(code)
      child.stdin.end()
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        data = Buffer.concat([data, chunk])
      })

      child.stdout.on('error', (err) => {
        console.error(err)
      })

      child.stdout.on('end', onEnd)
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        console.error('Error: ', chunk.toString())
      })

      child.stderr.on('error', (err) => {
        console.error('Error: ', err)
      })
    }

    child.addListener('message', (message) => console.log(message))
    child.addListener('error', (err) => console.error(err))

    child.on('error', (err) => reject(err))
    child.on('exit', onEnd)
  })
}