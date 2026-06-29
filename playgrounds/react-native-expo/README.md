# react-native-expo — Flare smoke test

Expo (managed) app for manually smoke-testing `@flareapp/react-native`, including
the Expo device/app context enrichment.

- Expo SDK `56.0.12` / React Native `0.85.3` (resolved at scaffold time).
- Standalone: NOT an npm workspace. `expo-device` + `expo-application` are saved
  deps of this app (added at scaffold time, committed in `package.json`), so the
  Expo enrichment path runs. The relink does NOT install them.

## Setup

1. Link the local SDK (from repo root): `node scripts/rn-relink.mjs expo`
   It injects the three `@flareapp` tarballs (`core`, `react`, `react-native`) and
   builds `@flareapp/react-native-sourcemaps` (consumed as a `file:` dep at build
   time, so its `dist/` must exist). Re-run after any SDK change, and after any
   plain `npm install` here (which prunes the injected tarballs).
   `expo-device`/`expo-application` come from this app's own `package.json`.
2. `cp flare.config.example.ts flare.config.ts` and set your Flare project key.

## Run

```bash
npx expo run:ios      # or: npx expo run:android  (Expo Go also works for JS-only paths)
```

Tap each numbered button, then confirm the report in your Flare dashboard.

## Scenarios

Same as the bare app, with one difference for #9:

| #   | Button         | What to verify                                                                                                                                 |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Context marker | Report has `os.name`, `os.version`, `device.screen.*`, AND `device.model.name` + `app.version` from Expo — this is the runtime proof of fix #1 |

(Scenarios 1–8 identical to the bare app's README.)

## Notes

- Fix #1: with `expo-device` installed, `device.model.name` must appear on report
  #9. If it does not, Metro failed to collect the optional require — regression.
- Fix #2 is `!__DEV__`-gated; use `--configuration Release` to observe it. To
  verify the report is flushed BEFORE the crash (not merely that it arrives),
  point `ingestUrl` at the local e2e fake-flare-server (Mac LAN IP, not
  localhost) and check the timestamped receipt at its `/__inspect/reports`
  endpoint.
- `app.id` (Android package name) is Android-only; absent on iOS by design.
