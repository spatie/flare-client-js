# @flareapp/electron

> ⚠️ **Experimental (`0.1.0`).** This package is new and its API may change in a minor release. Feedback and bug reports are very welcome at https://github.com/spatie/flare-client-js/issues.

Electron SDK for [Flare](https://flareapp.io) error tracking. It captures JavaScript errors in **both** Electron processes and routes every report through the main process, so your API key lives in exactly one place.

## What it captures

- **Main process:** uncaught exceptions and unhandled promise rejections.
- **Renderer process:** `window.onerror` and `unhandledrejection`, plus anything you report manually.
- **Process crashes:** `render-process-gone` and `child-process-gone` (renderer/GPU/utility), reported as structured errors with the crash `reason` and `exitCode`.

It does **not** capture native crashes (C++/Crashpad minidumps). Only JavaScript-level errors are sent to Flare.

## Install

```bash
npm install @flareapp/electron
```

`electron` is a peer dependency; this package expects your app to provide it.

## Setup

Flare needs wiring in all three Electron contexts. The API key, `stage`, `version`, and sourcemap settings are configured **once, in the main process** — the renderer needs none of them.

### 1. Main process

```ts
// main.ts
import { app } from 'electron';
import { flare } from '@flareapp/electron/main';

flare.light('your-flare-api-key');

// Optional: these are set ONCE here and applied to renderer reports too.
flare.configure({ stage: 'production', version: app.getVersion() });

// Optional: fatal-handler behavior and IPC trust policy.
flare.configureElectron({
    uncaughtExceptionMode: 'report-and-exit', // 'report' | 'report-and-exit' | 'off'
    unhandledRejectionMode: 'report-and-exit',
    captureRenderProcessGone: true,
});
```

In `report-and-exit` mode, after a fatal error Flare reports it, flushes pending reports (up to `shutdownTimeoutMs`), then calls `app.exit(1)`.

### 2. Preload script

Because `contextIsolation` is on (the Electron default and the recommended setting), the renderer cannot reach `ipcRenderer` directly. The preload helper bridges reports over `contextBridge`. This step is **required** — without it, renderer reports are dropped.

```ts
// preload.ts
import { exposeFlare } from '@flareapp/electron/preload';

exposeFlare();
```

Make sure your `BrowserWindow` points at this preload script:

```ts
new BrowserWindow({
    webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
    },
});
```

### 3. Renderer

Import the renderer entry once, as early as possible, to install the global error listeners:

```ts
// renderer entry, e.g. main.tsx / index.ts
import '@flareapp/electron/renderer';
```

For manual reporting, use the exported instance:

```ts
import { flare } from '@flareapp/electron/renderer';

try {
    doRiskyThing();
} catch (error) {
    flare.report(error as Error);
}
```

The renderer builds the full report (stack trace + source snippets + browser context) in its own context, then forwards it to the main process. No API key lives in the renderer.

## How reports flow

```
renderer error
  → RendererFlare builds Report (stack + snippets + browser context)
  → renderer beforeSubmit → serialize → size-check
  → window.__flare.report(jsonString)    [contextBridge]
  → ipcRenderer.invoke('flare:report')   [IPC]
  → main: trust sender → size-check → parse → validate
  → overlay stage/version/sourcemap + app metadata + user
  → main beforeSubmit → sent to Flare

main-process error
  → process handlers → sent to Flare (app.exit on report-and-exit)

renderer / GPU crash
  → render-process-gone / child-process-gone → reported → sent to Flare
```

The API key is held only in the main process because that is the single egress point: every report, wherever it originates, is sent from main.

## Filtering reports (`beforeSubmit`)

`beforeSubmit` runs in **two stages**: once in the renderer (scrub close to the source) and once in main (the final gate before sending). Returning `null`/`false` from either drops the report.

```ts
// main
flare.configure({
    beforeSubmit: (report) => {
        // final scrub before sending
        return report;
    },
});

// renderer
import { flare } from '@flareapp/electron/renderer';
flare.configure({
    beforeSubmit: (report) => {
        delete report.attributes['context.custom'];
        return report;
    },
});
```

## Sender trust

The main process only accepts reports from frames it trusts. By **default** it accepts:

- `file:` URLs (packaged builds), and
- `http(s)` on `localhost` / `127.0.0.1` (dev servers).

It rejects everything else, including remote origins and custom protocols. If your app serves its renderer over a custom protocol or loads trusted remote content, opt in:

```ts
// Add a custom protocol scheme:
flare.configureElectron({ trustedProtocols: ['app'] });

// Or take full control:
flare.configureElectron({
    trustSender: (frame) => new URL(frame.url).origin === 'https://app.example.com',
});
```

## Attaching the current user

```ts
import { flare } from '@flareapp/electron/main';

flare.setUser({ id: 123, email: 'user@example.com', username: 'jane' });
flare.setUser(null); // clear on logout
```

The user is attached to main-process reports and to forwarded renderer reports.

## Not captured

- Native crashes / Crashpad minidumps.
- Errors that occur before `flare.light('your-key')` runs in the main process. The fatal process handlers are attached by `light()`, and no report is sent without a key, so call `light()` as early as possible in your main entry. Errors before that point (in any process) are not sent.

This is an experimental release — see the note at the top.

## Using `@flareapp/react` in the renderer

In a plain web app, `@flareapp/react` reports through the `@flareapp/js` singleton you configure with `flare.light(key)`. In Electron that is wrong: the API key must live in the **main** process only, and reports must travel over IPC so main can enrich and gate them. So in the renderer you inject Electron's own Flare instance into the React boundary instead of letting it reach the web singleton.

### Install

```bash
npm install @flareapp/electron @flareapp/react
```

`@flareapp/js` comes in transitively via `@flareapp/electron` — do **not** import it in the renderer.

### 1. Main process — owns the key and the transport

```ts
// main.ts
import { app } from 'electron';
import { flare } from '@flareapp/electron/main';

app.whenReady().then(() => {
    flare.light('YOUR PROJECT KEY'); // key lives ONLY here
});
```

### 2. Preload — bridges the renderer to main

```ts
// preload.ts
import { exposeFlare } from '@flareapp/electron/preload';

exposeFlare(); // exposes window.__flare.report() via contextBridge
```

Point your `BrowserWindow` at this preload with `contextIsolation: true` (the default).

### 3. Renderer — get the IPC-forwarding instance

```ts
// flare.ts (renderer)
import { flare } from '@flareapp/electron/renderer';

export { flare };
```

### 4. React — inject that instance

Import from `@flareapp/react/inject` (not the package root) and pass the renderer instance:

```tsx
// App.tsx
import { flare } from './flare';
import { FlareErrorBoundary } from '@flareapp/react/inject';

export function App() {
    return (
        <FlareErrorBoundary flare={flare}>
            <Root />
        </FlareErrorBoundary>
    );
}
```

React 19 `createRoot` handler path:

```tsx
import { flare } from './flare';
import { flareReactErrorHandler } from '@flareapp/react/inject';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!, {
    onCaughtError: flareReactErrorHandler({ flare }),
    onUncaughtError: flareReactErrorHandler({ flare }),
});
```

### Rules

- **Never `import { flare } from '@flareapp/js'` in the renderer.** That pulls the web singleton (keyed, fetch-direct) and a second global error listener.
- Import the React SDK from `@flareapp/react/inject`, never the package root. If you import the root by mistake you will see a console warning that the default was registered while the Electron bridge is present.
- Omitting the `flare` prop on the `/inject` entry throws at boundary construction (boot), not silently at error time.

Reports from the renderer carry `sdk = @flareapp/electron` and `framework = React`. Your React component context (`context.custom.react`, component stack) rides along in the report attributes and survives the IPC trip intact.

## Using `@flareapp/vue` in the renderer

Same model as the React section: the API key lives in **main**, reports travel over IPC, and the renderer injects Electron's Flare instance into Vue instead of letting it reach the `@flareapp/js` singleton.

### Install

```bash
npm install @flareapp/electron @flareapp/vue
```

`@flareapp/js` comes in transitively via `@flareapp/electron` — do **not** import it in the renderer.

Set up main / preload / renderer exactly as in the React section (steps 1-3): `flare.light(key)` in main, `exposeFlare()` in preload, and a renderer `flare.ts` that re-exports `flare` from `@flareapp/electron/renderer`.

### Vue — inject the instance

Import `flareVue` (and, if you use it, `FlareErrorBoundary`) from `@flareapp/vue/inject`, not the package root, and pass the renderer instance:

```ts
// main.ts (renderer entry)
import { createApp } from 'vue';
import { flareVue } from '@flareapp/vue/inject';
import { flare } from './flare';
import App from './App.vue';

const app = createApp(App);
app.use(flareVue, { flare });
app.mount('#app');
```

Component boundary:

```vue
<script setup lang="ts">
import { FlareErrorBoundary } from '@flareapp/vue/inject';
import { flare } from './flare';
</script>

<template>
    <FlareErrorBoundary :flare="flare">
        <App />
    </FlareErrorBoundary>
</template>
```

### Rules

- **Never `import { flare } from '@flareapp/js'` in the renderer.** Import the Vue SDK from `@flareapp/vue/inject`, never the package root. Importing the root prints a console warning that the default was registered while the Electron bridge is present.
- Omitting the `flare` option/prop on the `/inject` entry throws at install / component setup (boot), not silently at error time.

Reports from the renderer carry `sdk = @flareapp/electron` and `framework = Vue`. Your Vue component context (`context.custom.vue`, component hierarchy, props) rides along and survives the IPC trip intact.

## Using `@flareapp/svelte` in the renderer

Same model as the React/Vue sections: the API key lives in **main**, reports travel over IPC, and the renderer injects Electron's Flare instance into Svelte instead of letting it reach the `@flareapp/js` singleton.

### Install

```bash
npm install @flareapp/electron @flareapp/svelte
```

`@flareapp/js` comes in transitively via `@flareapp/electron` — do **not** import it in the renderer.

Set up main / preload / renderer exactly as in the React section (steps 1-3): `flare.light(key)` in main, `exposeFlare()` in preload, and a renderer `flare.ts` that re-exports `flare` from `@flareapp/electron/renderer`.

### Svelte — inject the instance

Import `FlareErrorBoundary` (and/or `createFlareErrorHandler`) from `@flareapp/svelte/inject`, not the package root, and pass the renderer instance:

```svelte
<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/svelte/inject';
    import { flare } from './flare';
</script>

<FlareErrorBoundary {flare}>
    <App />
</FlareErrorBoundary>
```

Or the handler directly (e.g. in a SvelteKit-free Svelte app's error hook):

```ts
import { createFlareErrorHandler } from '@flareapp/svelte/inject';
import { flare } from './flare';

const handleError = createFlareErrorHandler({ flare });
```

### Rules

- **Never `import { flare } from '@flareapp/js'` in the renderer.** Import the Svelte SDK from `@flareapp/svelte/inject`, never the package root. Importing the root prints a console warning that the default was registered while the Electron bridge is present.
- Omitting the `flare` prop/option on the `/inject` entry throws at handler creation / component setup (boot), not silently at error time.

### Component tracking (optional)

If you use Flare's Svelte component tracking, point the preprocessor at the inject entry so the
generated per-component imports stay root-free in the renderer:

```js
// svelte.config.js (renderer build)
import { withFlareConfig } from '@flareapp/svelte/inject';

export default withFlareConfig(
    {
        /* your svelte config */
    },
    { importSource: '@flareapp/svelte/inject' },
);
```

Without `importSource`, the preprocessor emits `import ... from '@flareapp/svelte'`, which pulls the
web singleton (and its global side effects) into the renderer. Set it to `@flareapp/svelte/inject`
for Electron renderer builds.

Reports from the renderer carry `sdk = @flareapp/electron` and `framework = Svelte`. Your Svelte component context (`context.custom.svelte`, component hierarchy) rides along and survives the IPC trip intact.
