# @flareapp/vite

Vite build plugin for [Flare](https://flareapp.io) that uploads sourcemaps after each build. With sourcemaps, error reports sent by `@flareapp/js` will show the original source code instead of minified output.

The plugin also injects the Flare API key and a sourcemap version identifier into your build, so `flare.light()` works without any additional configuration.

## Installation

```bash
npm install @flareapp/vite
```

## Quick start

Add the plugin to your `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import flareSourcemapUploader from '@flareapp/vite';

export default defineConfig({
    plugins: [
        flareSourcemapUploader({
            key: 'YOUR_FLARE_API_KEY',
        }),
    ],
});
```

## Documentation

Full documentation on configuration options, sourcemap resolution, and more is available at [flareapp.io/docs/javascript/general/resolving-bundled-code](https://flareapp.io/docs/javascript/general/resolving-bundled-code).

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
