# @flareapp/webpack

Webpack 5 plugin for [Flare](https://flareapp.io) that uploads sourcemaps after each build. With sourcemaps, error reports sent by `@flareapp/js` will show the original source code instead of minified output.

The plugin also injects the Flare API key and a sourcemap version identifier into your build via `DefinePlugin`, so `flare.light()` works without any additional configuration.

## Installation

```bash
npm install @flareapp/webpack
```

## Quick start

Add the plugin to your `webpack.config.js`:

```js
const { FlareWebpackPlugin } = require('@flareapp/webpack');

module.exports = {
    // ...
    devtool: 'source-map',
    plugins: [
        new FlareWebpackPlugin({
            apiKey: 'YOUR_FLARE_API_KEY',
        }),
    ],
};
```

## Options

| Option             | Type      | Default                              | Description                                        |
| ------------------ | --------- | ------------------------------------ | -------------------------------------------------- |
| `apiKey`           | `string`  | (required)                           | Your Flare API key                                 |
| `apiEndpoint`      | `string`  | `https://flareapp.io/api/sourcemaps` | Sourcemap upload endpoint                          |
| `version`          | `string`  | random UUID                          | Sourcemap version identifier                       |
| `removeSourcemaps` | `boolean` | `false`                              | Delete `.map` files from build output after upload |
| `runInDevelopment` | `boolean` | `false`                              | Upload sourcemaps even in development mode         |
| `publicPath`       | `string`  | from webpack config                  | Override the public path prepended to filenames    |

## Compatibility

- Webpack 5

## Documentation

Full documentation is available at [flareapp.io/docs/javascript/general/resolving-bundled-code](https://flareapp.io/docs/javascript/general/resolving-bundled-code).

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
