const { ipcRenderer } = require('electron')
const vm = require('node:vm')
const v8 = require('node:v8')

v8.setFlagsFromString('--no-lazy --no-flush-bytecode')

ipcRenderer
  .invoke('tiny-bytenode-source')
  .then((code) => {
    const script = new vm.Script(code, { produceCachedData: true })
    ipcRenderer.send('tiny-bytenode-compiled', script.createCachedData())
  })
  .catch((error) => {
    ipcRenderer.send('tiny-bytenode-error', error.stack || String(error))
  })
