const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const vm = require('node:vm')
const v8 = require('node:v8')

app.disableHardwareAcceleration()
v8.setFlagsFromString('--no-lazy --no-flush-bytecode')

let code = ''

/** @param {Buffer|Uint8Array} bytecode */
function finish(bytecode) {
  process.stdout.write(Buffer.from(bytecode), () => app.exit(0))
}

/** @param {Error|string} error */
function fail(error) {
  process.stderr.write(`${error.stack || error}\n`, () => app.exit(1))
}

process.stdin.setEncoding('utf8')

process.stdin.on('data', (chunk) => {
  code += chunk
})

process.stdin.on('end', async () => {
  try {
    await app.whenReady()

    if (process.argv.includes('--renderer')) {
      ipcMain.handle('tiny-bytenode-source', () => code)
      ipcMain.once('tiny-bytenode-compiled', (_event, bytecode) => finish(bytecode))
      ipcMain.once('tiny-bytenode-error', (_event, error) => fail(error))

      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'electron-compiler-preload.cjs'),
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false
        }
      })
      window.webContents.on('preload-error', (_event, _path, error) => fail(error))
      window.webContents.on('render-process-gone', (_event, details) => fail(`Renderer exited: ${details.reason}`))
      await window.loadURL('about:blank')
    } else {
      const script = new vm.Script(code, { produceCachedData: true })
      finish(script.createCachedData())
    }
  } catch (error) {
    fail(error)
  }
})
