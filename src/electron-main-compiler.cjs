const { app } = require('electron')
const vm = require('node:vm')
const v8 = require('node:v8')

// No renderer is created; this also allows compilation in Linux containers running as root.
app.commandLine.appendSwitch('no-sandbox')
app.disableHardwareAcceleration()
v8.setFlagsFromString('--no-lazy --no-flush-bytecode')

let code = ''

process.stdin.setEncoding('utf8')

process.stdin.on('data', (chunk) => {
  code += chunk
})

process.stdin.on('end', async () => {
  try {
    await app.whenReady()
    const script = new vm.Script(code, { produceCachedData: true })
    process.stdout.write(script.createCachedData(), () => app.exit(0))
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`, () => app.exit(1))
  }
})
