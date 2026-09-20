import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import compileFile from '../src/compile-file.js'
import compileElectronCode from '../src/compile-electron.js'
import TinyBytenodeVitePlugin from '../vite-plugin/index.js'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const electronPath = process.env.ELECTRON_PATH || require('electron')
const loaderPath = fileURLToPath(new URL('../src/loader.js', import.meta.url))
await fs.mkdir('dist', { recursive: true })
const directory = await fs.mkdtemp(path.resolve('dist/electron-bytecode-test-'))
after(() => fs.rm(directory, { recursive: true, force: true }))
const filename = path.join(directory, 'entry.cjs')
await fs.writeFile(
  filename,
  'module.exports = { value: "closed", version: process.versions.electron, type: process.type }'
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

/**
 * @param {string} entry
 * @param {boolean} [node]
 * @param {RegExp} [expectedError]
 * @returns {string}
 */
function run(entry, node = false, expectedError) {
  const args = node ? [entry] : ['--no-sandbox', `--user-data-dir=${path.join(directory, 'user-data')}`, entry]
  const res = spawnSync(electronPath, args, {
    env: node ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env,
    encoding: 'utf8',
    timeout: 10000
  })
  assert.equal(res.error, undefined)
  assert.equal(res.signal, null, res.stderr)
  assert.equal(res.status, expectedError ? 1 : 0, res.stderr)

  if (expectedError) {
    assert.match(res.stderr, expectedError)
  }

  return res.stdout.trim()
}

/**
 * @param {string} code
 * @param {string} [htmlFile]
 * @param {RegExp} [expectedError]
 * @returns {Promise<unknown>}
 */
async function runPreload(code, htmlFile, expectedError) {
  const preload = path.join(directory, 'test-preload.cjs')
  const main = path.join(directory, 'test-renderer-main.cjs')
  await fs.writeFile(
    preload,
    `
    const { ipcRenderer } = require('electron')
    ;(async () => { ${code} })().then(
      result => ipcRenderer.send('result', result),
      error => ipcRenderer.send('failure', error.stack || String(error))
    )
  `
  )
  await fs.writeFile(
    main,
    `
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.disableHardwareAcceleration()
    const fail = error => { console.error(error); app.exit(1) }
    process.on('uncaughtException', fail)
    ipcMain.on('failure', (_event, error) => fail(error))
    ipcMain.on('result', (_event, result) => {
      process.stdout.write(JSON.stringify(result), () => app.exit(0))
    })
    app.whenReady().then(() => {
      const window = new BrowserWindow({ show: false, webPreferences: {
        preload: ${JSON.stringify(preload)},
        nodeIntegration: true, contextIsolation: false, sandbox: false
      } })
      window.webContents.on('preload-error', (_event, _path, error) => fail(error))
      window.webContents.on('render-process-gone', (_event, details) => fail(details.reason))
      ${htmlFile ? `window.loadFile(${JSON.stringify(htmlFile)})` : 'window.loadURL("about:blank")'}.catch(fail)
    }).catch(fail)
  `
  )
  const output = run(main, false, expectedError)
  return expectedError ? undefined : JSON.parse(output)
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
  test(`Renderer ${compress ? 'compressed ' : ''}bytecode loads in a real preload`, { timeout: 20000 }, async () => {
    const output = path.join(directory, 'preload.jsc')
    await compileFile({ filename, output, electronRenderer: true, electronPath, compress })
    const result = await runPreload(`
        require(${JSON.stringify(loaderPath)})
        const result = require(${JSON.stringify(output)})
        require('node:assert/strict').equal(result.version, process.versions.electron)
        return result
      `)
    assert.equal(result.value, 'closed')
    assert.equal(result.type, 'renderer')
  })
}

for (const target of ['Main', 'Renderer']) {
  test(`Vite ${target} bytecode fails without the matching Electron flag`, { timeout: 20000 }, async (t) => {
    const flag = `compileForElectron${target}`
    const outputs = []

    for (const enabled of [false, true]) {
      const outDir = path.join(directory, `vite-${target}-${enabled}`)
      await build({
        root: directory,
        configFile: false,
        logLevel: 'silent',
        build: {
          outDir,
          lib: { entry: filename, formats: ['cjs'], fileName: () => 'entry.cjs' }
        },
        plugins: [
          TinyBytenodeVitePlugin({
            generateLoader: false,
            electronPath,
            [flag]: enabled
          })
        ]
      })
      outputs.push(path.join(outDir, 'entry.jsc'))
    }

    const [withoutFlag, withFlag] = outputs
    const nodeBytecode = await fs.readFile(withoutFlag)
    const targetBytecode = await fs.readFile(withFlag)

    for (const output of [withFlag, withoutFlag]) {
      // Check the working build first. A missing plugin flag must not turn this test into a skip.
      if (output === withoutFlag && nodeBytecode.readUInt32LE(16) === targetBytecode.readUInt32LE(16)) {
        t.skip(`Node mode and ${target} have the same V8 snapshot in this Electron build`)
        return
      }

      const expectedError = output === withoutFlag ? /cachedDataRejected/ : undefined
      const code = `
        require(${JSON.stringify(loaderPath)})
        const result = require(${JSON.stringify(output)})
        require('node:assert/strict').equal(result.value, 'closed')
      `

      if (target === 'Renderer') {
        await runPreload(`${code}; return result.value`, undefined, expectedError)
      } else {
        const runner = path.join(directory, 'vite-main-runner.cjs')
        await fs.writeFile(
          runner,
          `
          const { app } = require('electron')
          process.on('uncaughtException', error => { console.error(error); app.exit(1) })
          ${code}
          app.exit(0)
        `
        )
        run(runner, false, expectedError)
      }
    }
  })
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

test('Compilation reports invalid source and missing executables', { timeout: 30000 }, async () => {
  for (const options of [{}, { electronMain: true }, { electronRenderer: true }]) {
    await assert.rejects(compileElectronCode('function {', { electronPath, ...options }), /SyntaxError/)
  }

  await assert.rejects(
    compileElectronCode('42', { electronPath: path.join(directory, 'missing') }),
    /Electron not found/
  )
})

test('Main and renderer compilation modes cannot be combined', async () => {
  await assert.rejects(
    compileElectronCode('42', { electronMain: true, electronRenderer: true, electronPath }),
    /mutually exclusive/
  )
  await assert.rejects(
    compileFile({ filename, electronMain: true, electronRenderer: true, electronPath }),
    /mutually exclusive/
  )
})

test('Renderer bytecode resolves Vite assets in a real Electron page', { timeout: 20000 }, async () => {
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
    plugins: [
      TinyBytenodeVitePlugin({
        compileAsModule: false,
        generateLoader: false,
        compileForElectronRenderer: true,
        electronPath
      })
    ]
  })
  const assetsDir = path.join(outDir, 'assets')
  const files = await fs.readdir(assetsDir)
  const bytecodeFile = files.find((file) => file.endsWith('.jsc'))
  assert.ok(bytecodeFile, 'Renderer bytecode must be emitted')
  const generateScriptPath = fileURLToPath(new URL('../src/generate-script.js', import.meta.url))
  const assetUrl = await runPreload(
    `
    await new Promise(resolve => window.addEventListener('DOMContentLoaded', resolve, { once: true }))
    const generateScript = require(${JSON.stringify(generateScriptPath)}).default
    const bytecode = require('node:fs').readFileSync(${JSON.stringify(path.join(assetsDir, bytecodeFile))})
    await generateScript(bytecode).runInThisContext()
    return globalThis.assetUrl
    `,
    path.join(outDir, 'index.html')
  )
  assert.equal(await fs.readFile(new URL(assetUrl), 'utf8'), svg)
})
