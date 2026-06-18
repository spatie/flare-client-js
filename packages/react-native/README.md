# @flareapp/react-native

React Native SDK for [Flare](https://flareapp.io) error tracking by Spatie.

Pure JavaScript — works on both Expo (managed) and bare React Native with no
required native module.

## Install

```bash
npm install @flareapp/react-native @flareapp/react
```

## Usage

```ts
import { flare, FlareErrorBoundary } from '@flareapp/react-native';

flare.light('your-project-key');
flare.setUser({ id: 1, email: 'user@example.com' });
```

Wrap your app in the boundary to capture React render errors:

```tsx
<FlareErrorBoundary>
    <App />
</FlareErrorBoundary>
```

## What it captures

- Uncaught JS errors (via `ErrorUtils`)
- React render errors (via `FlareErrorBoundary`)
- Unhandled promise rejections (best-effort; uses the active JS engine's hook —
  Hermes or JSC)

Device/app context is collected from React Native core, enriched with
`expo-device` / `expo-application` when present. Note: on iOS, Expo's `app.id`
(Android package name) is not available as a sync constant, so that attribute is
Android-only.

## Not yet included

- Native crash capture (requires a native module)
- Metro sourcemap upload (planned as a separate package)
- Automatic breadcrumbs (use `flare.glow(...)` manually for now)
