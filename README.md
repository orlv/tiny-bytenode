# @orlv/tiny-bytenode

Simplified version of Bytenode (https://github.com/bytenode/bytenode).

Includes webpack plugin.

```
npm i -D @orlv/tiny-bytenode
```

#### webpack config:

```
import TinyBytenodeWebpackPlugin from '@orlv/tiny-bytenode/webpack-plugin/index.js'

......

 plugins: [
    new TinyBytenodeWebpackPlugin({
      compileAsModule: true,
      compileForElectron: true,
      keepSource: false
      transformArrowFunctions: true,
      generateLoader: true
    })
]
```

- transformArrowFunctions - Compile arrow functions to ES5 functions. Solves the issue of crashes caused by arrow functions.

### Links:

- Bytenode: https://github.com/bytenode/bytenode
- Bytenode Webpack Plugin: https://github.com/herberttn/bytenode-webpack-plugin
