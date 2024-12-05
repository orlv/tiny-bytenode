#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const compileCode = require('./compile.js')
const compileFile = require('./compile-file.js')

/**
 * @returns {{compress: boolean, noModule: boolean, electron: boolean, electronPath: string, files: string[]}}
 */
function parseArgs() {
  const args = process.argv.slice(2)

  if (args.includes('-e')) {
    args[args.indexOf('-e')] = '--electron'
  }

  if (args.includes('-ep')) {
    args[args.indexOf('-ep')] = '--electron-path'
  }

  const options = {
    compress: false,
    noModule: false,
    electron: false,
    electronPath: '',
    files: []
  }

  for (let i = 0; i < args.length; i++) {
    const val = args[i]

    if (['--compress'].includes(val)) {
      options.compress = true
    } else if (['-c', '--compile'].includes(val)) {
      options.compile = true
    } else if (['-h', '--help'].includes(val)) {
      printHelp()
      process.exit(0)
    } else if (['-v', '--version'].includes(val)) {
      printVersion()
      process.exit(0)
    } else if (['-n', '--no-module'].includes(val)) {
      options.noModule = true
    } else if (['-e', '--electron'].includes(val)) {
      options.electron = true
    } else if (['-ep', '--electron-path'].includes(val)) {
      options.electron = true

      const electronPath = ++i < args.length ? path.resolve(args[i]) : ''

      if (!electronPath || !fs.existsSync(electronPath) || !fs.statSync(electronPath).isFile()) {
        console.error(`Error: cannot find electron at '${electronPath}'.`)
        process.exit(1)
      }
    } else if (val[0] === '-') {
      console.error(`Error: unsupported flag '${val}'.`)
      process.exit(1)
    } else {
      options.files.push(val)
    }
  }

  return options
}

/** */
function printHelp() {
  console.log(`
  Usage: bytenode [options] [ FILE... ]

  Options:
    -h, --help                        show help information.
    -v, --version                     show bytenode version.

    --compress                        compress bytecode
    -n, --no-module                   compile without producing commonjs module
    -e, --electron                    compile for Electron
    -ep, --electron-path              path to Electron executable
    [ FILE... ]                       compile stdin, a file, or a list of files

  Examples:

  $ ./cli.js script.js             compile 'script.js' to 'script.jsc',
  $ ./cli.js server.js app.js
  $ ./cli.js src/*.js              compile all '.js' files in 'src/' directory.
`)
}

/**
 *
 */
function printVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync('./package.json').toString())
    console.log(pkg.name, pkg.version)
  } catch (e) {
    console.error(e)
  }

  console.log('Node', process.versions.node)

  if (process.versions.electron) {
    console.log('Electron', process.versions.electron)
  }
}

/**
 * @param {object} options
 * @param {boolean} options.compress
 * @param {boolean} options.electron
 * @param {string} options.electronPath
 * @param {boolean} options.noModule
 * @param {string[]} options.files
 */
async function compileFiles({ files, noModule, compress, electron, electronPath }) {
  if (files.length === 0) {
    let script = ''

    process.stdin.setEncoding('utf-8')

    process.stdin.on('readable', () => {
      const data = process.stdin.read()

      if (data !== null) {
        script += data
      }
    })

    process.stdin.on('end', () => {
      try {
        const code = noModule ? script : module.wrap(script)
        const bytecode = compileCode(code, compress)

        process.stdout.write(bytecode)
      } catch (e) {
        console.error(e)
      }
    })
  } else {
    for (const name of files) {
      const filename = path.resolve(name)

      if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        console.error(`Error: cannot find file '${filename}'.`)
        process.exit(1)
      }

      try {
        await compileFile({
          filename,
          compileAsModule: !noModule,
          compress,
          electron,
          electronPath
        })
      } catch (e) {
        console.error(e)
      }
    }
  }
}

const options = parseArgs()

compileFiles(options).catch(console.error)
