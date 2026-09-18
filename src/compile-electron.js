import path from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/**
 * Compiles in Electron's Node mode, or its main process when electronMain is true.
 * Always use the same Electron executable as the application.
 *
 * @param {string} code
 * @param {object} [options]
 * @param {string} [options.electronPath]
 * @param {boolean} [options.electronMain]
 * @param {boolean} [options.compress]
 * @returns {Promise<Buffer>}
 */
export default function compileElectronCode(code, { electronPath, electronMain = false, compress = false } = {}) {
  return new Promise((resolve, reject) => {
    const executable = electronPath ? path.resolve(electronPath) : require('electron')

    if (!fs.existsSync(executable)) {
      reject(new Error(`Electron not found at '${executable}'`))
      return
    }

    const compiler = fileURLToPath(new URL(electronMain ? './electron-main-compiler.cjs' : './cli.js', import.meta.url))
    const env = { ...process.env }

    if (electronMain) {
      delete env.ELECTRON_RUN_AS_NODE
    } else {
      env.ELECTRON_RUN_AS_NODE = '1'
    }

    const child = spawn(executable, electronMain ? [compiler] : [compiler, '--compile', '--no-module'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const out = []
    let stderr = ''

    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.stdin.on('error', reject)
    child.on('close', (exitCode, signal) => {
      if (exitCode !== 0 || out.length === 0) {
        reject(new Error(`Electron bytecode compilation failed (${signal || exitCode}): ${stderr.trim()}`))
        return
      }

      const bytecode = Buffer.concat(out)
      resolve(compress ? brotliCompressSync(bytecode) : bytecode)
    })
    child.stdin.end(code)
  })
}
