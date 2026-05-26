# @flareapp/nextjs

Next.js plugin for [Flare](https://flareapp.io) that uploads client-side sourcemaps after each production build. Wraps `@flareapp/webpack` and configures it for Next.js automatically.

## Installation

```bash
npm install @flareapp/nextjs
```

## Quick start

Wrap your Next.js config with `withFlareSourcemaps` in `next.config.mjs`:

```js
import { withFlareSourcemaps } from '@flareapp/nextjs';

export default withFlareSourcemaps(
    {
        // your normal Next.js config
    },
    {
        apiKey: process.env.FLARE_KEY,
    },
);
```

This will:

- Enable `productionBrowserSourceMaps` (unless you explicitly set it to `false`)
- Add the Flare webpack plugin to client-side builds only
- Upload sourcemaps to Flare after each production build
- Remove `.map` files from build output by default

## Options

| Option             | Type      | Default                              | Description                                     |
| ------------------ | --------- | ------------------------------------ | ----------------------------------------------- |
| `apiKey`           | `string`  | (required)                           | Your Flare API key                              |
| `apiEndpoint`      | `string`  | `https://flareapp.io/api/sourcemaps` | Sourcemap upload endpoint                       |
| `version`          | `string`  | random UUID                          | Sourcemap version identifier                    |
| `removeSourcemaps` | `boolean` | `true`                               | Delete `.map` files after upload                |
| `runInDevelopment` | `boolean` | `false`                              | Upload sourcemaps in development builds         |
| `publicPath`       | `string`  | from webpack config                  | Override the public path prepended to filenames |

## Error tracking

For catching and reporting React errors in your Next.js app, use `@flareapp/react` alongside this plugin:

```bash
npm install @flareapp/js @flareapp/react
```

## Compatibility

- Next.js 13+

## Documentation

Full documentation is available at [flareapp.io/docs/javascript/general/resolving-bundled-code](https://flareapp.io/docs/javascript/general/resolving-bundled-code).

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
