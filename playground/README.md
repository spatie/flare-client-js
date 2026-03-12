# Playground

Local Vite dev app for manually testing all Flare integrations. It is a multi-page setup with separate entry points for
plain JavaScript, React, and Vue. Each page has buttons that trigger different error types (uncaught exceptions,
unhandled promise rejections, async errors, component errors, etc.).

This package is private and is not published to npm.

## Setup

1. Copy the example env file and fill in your Flare API keys:

```bash
cp .env.example .env.local
```

2. Add your keys to `.env.local`:

```
VITE_FLARE_JS_KEY=your-js-key
VITE_FLARE_REACT_KEY=your-react-key
VITE_FLARE_VUE_KEY=your-vue-key
```

You can use the same key for all three, or separate keys if you have separate Flare projects.

3. Start the dev server from the repo root:

```bash
npm run playground
```

This builds all packages first, then starts the Vite dev server.

## Pages

| Path      | Integration       | Description                                                          |
|-----------|-------------------|----------------------------------------------------------------------|
| `/`       | -                 | Landing page with links to all test pages                            |
| `/js/`    | `@flareapp/js`    | Tests for the core client (global error listeners, manual reporting) |
| `/react/` | `@flareapp/react` | Tests for `FlareErrorBoundary` and `flareReactErrorHandler`          |
| `/vue/`   | `@flareapp/vue`   | Tests for the Vue error handler plugin                               |

## How it works

The playground imports the packages from the local workspace (not from npm), so any changes you make to a package's
source code are reflected immediately. The Vite config uses path aliases to resolve `@flareapp/*` to the local source
files.
