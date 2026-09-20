import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import { build } from 'vite'
import webpack from 'webpack'
import compileCode from '../src/compile.js'
import compileFile from '../src/compile-file.js'
import runBytecode from '../src/run-bytecode.js'
import TinyBytenodeVitePlugin from '../vite-plugin/index.js'
import TinyBytenodeWebpackPlugin from '../webpack-plugin/index.js'
import '../src/loader.js'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const cwd = process.cwd()
let directory

/**
 * @param {string} outDir
 * @param {string} entry
 * @param {boolean} enabled
 */
async function assertSourceMaps(outDir, entry, enabled) {
  const files = await fs.readdir(outDir)
  assert.equal(
    files.some((file) => file.endsWith('.map')),
    enabled
  )
  const loader = await fs.readFile(path.join(outDir, entry), 'utf8')
  const reference = loader.match(/^\/\/# sourceMappingURL=(\S+)/m)
  assert.equal(Boolean(reference), enabled)

  if (enabled) {
    const map = JSON.parse(await fs.readFile(path.join(outDir, reference[1]), 'utf8'))
    assert.equal(map.version, 3)
    assert.ok(map.sources.length > 0)
    assert.ok(map.mappings.length > 0)
  }
}

before(async () => {
  await fs.mkdir(path.join(root, 'dist'), { recursive: true })
  directory = await fs.mkdtemp(path.join(root, 'dist/bytecode-test-'))
  // A consuming project may have an incompatible Babel installation.
  const pluginDir = path.join(directory, 'node_modules/@babel/plugin-transform-arrow-functions')
  await fs.mkdir(pluginDir, { recursive: true })
  await fs.writeFile(path.join(pluginDir, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
  await fs.writeFile(path.join(pluginDir, 'index.js'), 'throw new Error("Consumer Babel plugin must not be loaded")')
  process.chdir(directory)
})
after(async () => {
  process.chdir(cwd)
  await fs.rm(directory, { recursive: true, force: true })
})

for (const compress of [false, true]) {
  describe(compress ? 'Compressed bytecode' : 'Bytecode', () => {
    it('compiles and executes a script', () => {
      const bytecode = compileCode('40 + 3', compress)
      assert.ok(Buffer.isBuffer(bytecode) && bytecode.length > 0)
      assert.equal(runBytecode(bytecode), 43)
    })

    it('compiles and loads a CommonJS module', async () => {
      const filename = path.join(directory, `module-${compress}.cjs`)
      await fs.writeFile(filename, 'module.exports = 42')
      const output = await compileFile({ filename, compress })
      assert.equal(output, filename.replace(/\.cjs$/, '.jsc'))
      assert.equal(require(output), 42)
    })

    it('compiles a script to an explicit output file', async () => {
      const filename = path.join(directory, `script-${compress}.js`)
      const output = path.join(directory, `script-${compress}.jsc`)
      await fs.writeFile(filename, '#!/usr/bin/env node\n40 + 3')
      assert.equal(await compileFile({ filename, output, compileAsModule: false, compress }), output)
      assert.equal(runBytecode(await fs.readFile(output)), 43)
    })
  })
}

it('reports invalid source and bytecode inputs', async () => {
  assert.throws(() => compileCode(null), /javascriptCode must be string/)
  assert.throws(() => compileCode('function {'), SyntaxError)
  assert.throws(() => runBytecode(null), /bytecodeBuffer must be a buffer/)
  await assert.rejects(compileFile({ filename: null }), /filename must be a string/)
  await assert.rejects(compileFile({ filename: 'missing.js', output: 42 }), /output must be a string/)
  await assert.rejects(compileFile({ filename: path.join(directory, 'missing.js') }), /ENOENT/)
})

it('supports a custom bytecode extension', async () => {
  const filename = path.join(directory, 'custom.js')
  await fs.writeFile(filename, '42')
  const output = await compileFile({ filename, ext: '.bin', compileAsModule: false })
  assert.equal(output, path.join(directory, 'custom.bin'))
  assert.equal(runBytecode(await fs.readFile(output)), 42)
})

it('CLI returns a failure status for invalid source and missing files', async () => {
  const cli = path.join(root, 'src/cli.js')
  const badFile = path.join(directory, 'invalid.js')
  await fs.writeFile(badFile, 'const value = ;')

  for (const args of [[badFile], ['--no-module'], [path.join(directory, 'missing.js')]]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      input: 'const value = ;',
      encoding: 'utf8',
      timeout: 10000
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /SyntaxError|cannot find file/)
  }

  const result = spawnSync(process.execPath, [cli, '--no-module'], { input: '42', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr.toString())
  assert.equal(runBytecode(result.stdout), 42)
})

for (const sourcemap of [false, true]) {
  it(`builds TypeScript with Vite and sourcemap=${sourcemap}`, async () => {
    const filename = path.join(directory, 'entry.ts')
    await fs.writeFile(
      filename,
      `
    type Result = { value: number }
    enum Offset { Base = 40 }
    class Value { read(): number { return Offset.Base + 2 } }
    const read = (): number => new Value().read()
    const result: Result = { value: read() }
    console.log(JSON.stringify(result))
  `
    )
    const outDir = path.join(directory, `vite-${sourcemap}`)
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@orlv/tiny-bytenode': root } },
      build: {
        outDir,
        sourcemap: !sourcemap,
        lib: { entry: filename, formats: ['cjs'], fileName: () => 'entry.cjs' },
        rollupOptions: { external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)] }
      },
      plugins: [TinyBytenodeVitePlugin({ transformClasses: true, sourcemap })]
    })
    const res = spawnSync(process.execPath, [path.join(outDir, 'entry.cjs')], { encoding: 'utf8', timeout: 10000 })
    assert.equal(res.error, undefined)
    assert.equal(res.status, 0, res.stderr)
    assert.deepEqual(JSON.parse(res.stdout), { value: 42 })
    assert.ok((await fs.stat(path.join(outDir, 'entry.jsc'))).size > 0)
    await assertSourceMaps(outDir, 'entry.cjs', sourcemap)
  })
}

for (const [label, options, sourcemap] of [
  ['defaults', {}, false],
  ['sourcemap enabled', { sourcemap: true }, true]
]) {
  it(`builds with Webpack, ${label}, and executes its loader`, async () => {
    const filename = path.join(directory, 'webpack-entry.cjs')
    await fs.writeFile(
      filename,
      'class Value { read() { return 42 } }; const read = () => new Value().read(); process.stdout.write(JSON.stringify(read()))'
    )
    const outDir = path.join(directory, `webpack-${label}`)
    await new Promise((resolve, reject) => {
      webpack(
        {
          mode: 'production',
          target: 'node',
          devtool: sourcemap ? undefined : 'source-map',
          entry: { main: filename },
          output: { path: outDir, filename: '[name].cjs' },
          resolve: { alias: { '@orlv/tiny-bytenode': root } },
          plugins: [new TinyBytenodeWebpackPlugin({ transformClasses: true, ...options })]
        },
        (error, res) => {
          if (error || res.hasErrors()) {
            reject(error || new Error(res.toString({ all: false, errors: true })))
          } else {
            resolve()
          }
        }
      )
    })
    const res = spawnSync(process.execPath, [path.join(outDir, 'main.cjs')], {
      env: { ...process.env, FORCE_COLOR: '1' },
      encoding: 'utf8',
      timeout: 10000
    })
    assert.equal(res.error, undefined)
    assert.equal(res.status, 0, res.stderr)
    assert.equal(res.stdout, '42')
    await assertSourceMaps(outDir, 'main.cjs', sourcemap)
  })
}
