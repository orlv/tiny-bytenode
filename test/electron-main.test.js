import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import compileFile from '../src/compile-file.js'
import compileElectronCode from '../src/compile-electron.js'
import generateScript from '../src/generate-script.js'
import TinyBytenodeVitePlugin from '../vite-plugin/index.js'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const electronPath = process.env.ELECTRON_PATH || require('electron')
const loaderPath = fileURLToPath(new URL('../src/loader.js', import.meta.url))
await fs.mkdir('dist', { recursive: true })
const directory = await fs.mkdtemp(path.resolve('dist/electron-bytecode-test-'))
after(() => fs.rm(directory, { recursive: true, force: true }))
const filename = path.join(directory, 'entry.cjs')
await fs.writeFile(filename, 'module.exports = { value: "closed", version: process.versions.electron }')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

/**
 * @param {string} entry
 * @param {boolean} [node]
 * @returns {string}
 */
function run(entry, node = false) {
  const res = spawnSync(electronPath, [entry], {
    env: node ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env,
    encoding: 'utf8',
    timeout: 10000
  })
  assert.equal(res.error, undefined)
  assert.equal(res.signal, null, res.stderr)
  assert.equal(res.status, 0, res.stderr)
  return res.stdout.trim()
}

for (const compress of [false, true]) {
  test(
    `Main-process ${compress ? 'compressed ' : ''}bytecode executes with the selected Electron version`,
    { timeout: 20000 },
    async () => {
      const output = path.join(directory, 'main.jsc')
      await compileFile({ filename, output, electronMain: true, electronPath, compress })
      const runner = path.join(directory, 'main-runner.cjs')
      await fs.writeFile(
        runner,
        `
    const { app } = require('electron')
    process.on('uncaughtException', error => { console.error(error); app.exit(1) })
    require(${JSON.stringify(loaderPath)})
    const res = require(${JSON.stringify(output)})
    require('node:assert/strict').equal(res.version, process.versions.electron)
    console.log(res.value)
    app.exit(0)
  `
      )
      assert.equal(run(runner), 'closed')
    }
  )

  test(
    `Node-mode ${compress ? 'compressed ' : ''}bytecode executes in Electron Node mode`,
    { timeout: 20000 },
    async () => {
      const output = path.join(directory, 'node.jsc')
      await compileFile({ filename, output, electron: true, electronPath, compress })
      const runner = path.join(directory, 'node-runner.cjs')
      await fs.writeFile(
        runner,
        `require(${JSON.stringify(loaderPath)}); console.log(require(${JSON.stringify(output)}).value)`
      )
      assert.equal(run(runner, true), 'closed')
    }
  )
}

test('A mismatched V8 snapshot is rejected without crashing Electron', { timeout: 20000 }, async () => {
  const output = path.join(directory, 'incompatible.jsc')
  await compileFile({ filename, output, electronMain: true, electronPath })
  const bytecode = await fs.readFile(output)
  // Corrupt the snapshot checksum; main and Node snapshots can match in newer Electron releases.
  bytecode[16] ^= 1
  await fs.writeFile(output, bytecode)
  const runner = path.join(directory, 'mismatch-runner.cjs')
  await fs.writeFile(
    runner,
    `
    const { app } = require('electron')
    process.on('uncaughtException', error => { console.error(error); app.exit(1) })
    require(${JSON.stringify(loaderPath)})
    require('node:assert/strict').throws(() => require(${JSON.stringify(output)}), /incompatible cached data/)
    console.log('rejected')
    app.exit(0)
  `
  )
  assert.equal(run(runner), 'rejected')
})

test('Compilation reports invalid source and missing executables', { timeout: 20000 }, async () => {
  for (const electronMain of [false, true]) {
    await assert.rejects(compileElectronCode('function {', { electronPath, electronMain }), /compilation failed/)
  }

  await assert.rejects(
    compileElectronCode('42', { electronPath: path.join(directory, 'missing') }),
    /Electron not found/
  )
})

test('Renderer bytecode resolves Vite assets relative to its original JavaScript chunk', async () => {
  const root = path.join(directory, 'renderer')
  const outDir = path.join(root, 'build')
  await fs.mkdir(root)
  await fs.writeFile(path.join(root, 'index.html'), '<script type="module" src="./entry.js"></script>')
  await fs.writeFile(path.join(root, 'entry.js'), 'globalThis.assetUrl = new URL("./image.svg", import.meta.url).href')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>'
  await fs.writeFile(path.join(root, 'image.svg'), svg)
  await build({
    root,
    base: './',
    configFile: false,
    logLevel: 'silent',
    build: { outDir, assetsInlineLimit: 0, modulePreload: false },
    plugins: [TinyBytenodeVitePlugin({ compileAsModule: false, generateLoader: false })]
  })
  const assetsDir = path.join(outDir, 'assets')
  const files = await fs.readdir(assetsDir)
  const bytecodeFile = files.find((file) => file.endsWith('.jsc'))
  assert.ok(bytecodeFile, 'Renderer bytecode must be emitted')
  const context = { URL, document: { baseURI: pathToFileURL(path.join(outDir, 'index.html')).href }, console }
  await generateScript(await fs.readFile(path.join(assetsDir, bytecodeFile))).runInNewContext(context)
  assert.equal(await fs.readFile(new URL(context.assetUrl), 'utf8'), svg)
})
