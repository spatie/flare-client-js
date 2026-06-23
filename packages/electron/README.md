# @flareapp/electron

Electron SDK for [Flare](https://flareapp.io) error tracking. It captures JavaScript errors in **both** Electron processes and routes every report through the main process, so your API key lives in exactly one place.

## What it captures

- **Main process:** uncaught exceptions and unhandled promise rejections.
- **Renderer process:** `window.onerror` and `unhandledrejection`, plus anything you report manually.
- **Process crashes:** `render-process-gone` and `child-process-gone`, reported with the crash `reason` and `exitCode`.

It does **not** capture native crashes (C++/Crashpad minidumps). Only JavaScript-level errors are sent to Flare.

## Installation

```bash
npm install @flareapp/electron
```

`electron` is a peer dependency; this package expects your app to provide it.

## Quick start

Flare needs wiring in all three Electron contexts. The API key is configured **once, in the main process**.

```ts
// main.ts
import { flare } from '@flareapp/electron/main';

flare.light('YOUR_FLARE_API_KEY');
```

```ts
// preload.ts — required so renderer reports reach main over contextBridge
import { exposeFlare } from '@flareapp/electron/preload';

exposeFlare();
```

```ts
// renderer entry, e.g. main.tsx / index.ts — installs the global listeners
import '@flareapp/electron/renderer';
```

Point your `BrowserWindow` at the preload script with `contextIsolation: true` (the default).

## Using a UI framework

When your renderer uses React, Vue, or Svelte, inject the Electron Flare instance through the framework's `/inject` entry instead of the `@flareapp/js` web singleton. See the framework configuration guides:

- [Electron + React](https://flareapp.io/docs/react/electron/configuration)
- [Electron + Vue](https://flareapp.io/docs/vue/electron/configuration)
- [Electron + Svelte](https://flareapp.io/docs/svelte/electron/configuration)

## Identifying users

Set the user in the main process; it is stamped on main-origin reports and on forwarded renderer reports:

```ts
import { flare } from '@flareapp/electron/main';

flare.setUser({ id: 123, email: 'jane@example.com', fullName: 'Jane Doe' });
```

Recognised fields: `id`, `email`, `fullName`, `ipAddress`; extra keys land in `user.attributes`. Pass `null` to clear. The main-process user is authoritative for forwarded renderer reports.

## Documentation

Full documentation on the report flow, `beforeSubmit` filtering, sender trust, attaching users, and the framework integrations is available at [flareapp.io/docs/javascript/electron/how-it-works](https://flareapp.io/docs/javascript/electron/how-it-works).

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
