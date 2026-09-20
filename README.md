# @orlv/tiny-bytenode

JavaScript to V8 bytecode, with Vite/Webpack plugins and TypeScript types.

Tracks upstream changes from [Bytenode](https://github.com/bytenode/bytenode).

```sh
pnpm add -D @orlv/tiny-bytenode
```

```js
import TinyBytenodeVitePlugin from '@orlv/tiny-bytenode/vite-plugin/index.js'

export default {
  plugins: [
    TinyBytenodeVitePlugin({
      compileAsModule: true, // CommonJS wrapper.
      compileForElectronMain: false, // Electron main process.
      compileForElectronRenderer: false, // Electron renderer/preload.
      compileForElectron: false, // Legacy Node mode; use Main/Renderer for app builds.
      electronPath: '', // Executable path; empty uses the installed electron package.
      keepSource: false, // Keep original JavaScript.
      sourcemap: false, // Generate JavaScript source maps.
      transformArrowFunctions: true, // Convert arrow functions.
      transformClasses: false, // Convert classes to functions.
      generateLoader: true, // Generate a CommonJS loader.
      excludeFromHTML: true // Remove script tags when generateLoader is false.
    })
  ]
}
```

By default, compilation uses Node.js. For Electron, enable **one** flag:

- `compileForElectronMain` — main process.
- `compileForElectronRenderer` — renderer/preload.

`compileForElectron` selects the legacy `ELECTRON_RUN_AS_NODE` mode, retained for compatibility with existing build configurations.

Use the application's Electron version, platform and architecture. On headless Linux, run the build with `xvfb-run -a`.

For renderer page scripts, also set `compileAsModule: false` and `generateLoader: false`, then run the bytecode from your preload loader. For a CommonJS preload, keep `compileAsModule: true`.

Webpack: use `new TinyBytenodeWebpackPlugin(options)` from `@orlv/tiny-bytenode/webpack-plugin/index.js`. It uses the same options and detects `compileForElectron` from Webpack's target when omitted.

Vite handles TypeScript. `compileFile()` accepts JavaScript and uses `electronMain` / `electronRenderer` for the same modes.

Tests: `pnpm test` and `pnpm test:electron`. Set `ELECTRON_PATH` to test another Electron executable.

### Links

- [Bytenode](https://github.com/bytenode/bytenode)
- [Bytenode Webpack Plugin](https://github.com/herberttn/bytenode-webpack-plugin)
