import path from 'node:path'
import os from 'node:os'
import { brotliCompressSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/**
 * Compiles in Electron's Node mode, main process, or renderer/preload process.
 * Always use the same Electron executable as the application.
 *
 * @param {string} code
 * @param {object} [options]
 * @param {string} [options.electronPath]
 * @param {boolean} [options.electronMain]
 * @param {boolean} [options.electronRenderer]
 * @param {boolean} [options.compress]
 * @returns {Promise<Buffer>}
 */
export default async function compileElectronCode(
  code,
  { electronPath, electronMain = false, electronRenderer = false, compress = false } = {}
) {
  if (electronMain && electronRenderer) {
    throw new Error('electronMain and electronRenderer are mutually exclusive.')
  }

  const executable = electronPath ? path.resolve(electronPath) : require('electron')

  if (!fs.existsSync(executable)) {
    throw new Error(`Electron not found at '${executable}'`)
  }

  const browserProcess = electronMain || electronRenderer
  const compiler = fileURLToPath(new URL(browserProcess ? './electron-compiler.cjs' : './cli.js', import.meta.url))
  const env = { ...process.env }
  const args = browserProcess ? ['--no-sandbox', compiler] : [compiler, '--compile', '--no-module']

  if (browserProcess) {
    delete env.ELECTRON_RUN_AS_NODE
  } else {
    env.ELECTRON_RUN_AS_NODE = '1'
  }

  // Each renderer compile needs its own Chromium profile, including parallel builds.
  const userDataDir = electronRenderer ? fs.mkdtempSync(path.join(os.tmpdir(), 'tiny-bytenode-')) : null

  if (userDataDir) {
    args.unshift(`--user-data-dir=${userDataDir}`)
    args.push('--renderer')
  }

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
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
  } finally {
    if (userDataDir) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
}
