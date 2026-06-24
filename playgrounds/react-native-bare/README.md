# react-native-bare — Flare smoke test

Bare React Native app for manually smoke-testing `@flareapp/react-native`.

- React Native `0.86.0` / React `19.2.3` (resolved at scaffold time).
- Standalone: NOT an npm workspace. Own `node_modules` + Metro.

## Setup

1. Link the local SDK (from repo root): `node scripts/rn-relink.mjs bare`
   Re-run after any change to `@flareapp/core`, `@flareapp/react`, or
   `@flareapp/react-native`.
2. `cp flare.config.example.ts flare.config.ts` and set your Flare project key.
   (`flare.config.ts` is git-ignored.)

## Run

```bash
cd ios && pod install && cd ..   # first run only
npm run ios        # or: npm run android
```

Tap each numbered button, then confirm the report in your Flare dashboard.

## Scenarios

| #   | Button                       | What to verify                                                                                                               |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sync throw                   | Report appears; `error.fatal` absent/false                                                                                   |
| 2   | Fatal error                  | Release build only: report delivered before crash (fix #2; skipped in dev)                                                   |
| 3   | Unhandled rejection (Error)  | Report with the original stack trace                                                                                         |
| 4   | Unhandled rejection (string) | `UnhandledRejection`, empty stack                                                                                            |
| 5   | React render error           | Boundary fallback shows; report has React component stack; Reset recovers                                                    |
| 6   | Manual report                | Report appears                                                                                                               |
| 7   | Glow then report             | Report carries the `checkout-step` glow                                                                                      |
| 8   | setUser then report          | Report has `enduser.id/email/username`                                                                                       |
| 9   | Context marker               | Report has `os.name`, `os.version`, `device.screen.*`. Bare RN has NO `device.model.name`/`app.version` (no Expo) — expected |

## Notes

- `@flareapp/react/inject` resolves through `@flareapp/react`'s exports map
  (Metro package exports). `@flareapp/react` has no `react-native` condition, so
  Metro resolves the subpath via its `import`/`require` conditions. The subpath
  exists only in the exports map (no main-field fallback), so `metro.config.js`
  sets `resolver.unstable_enablePackageExports = true` — required on the bare
  template, which defaults it off.
- Fix #2 (fatal flush-before-delegate) is `!__DEV__`-gated; use a Release build to
  observe it. To verify the ORDERING (report flushed before the crash, not just
  that it eventually arrives), point `ingestUrl` at the local e2e
  fake-flare-server (your Mac's LAN IP, NOT localhost) and read the timestamped
  receipt from its `/__inspect/reports` endpoint — real ingress proves arrival
  but not that the report beat termination.
- Offline / scenarios 1 and 3-9: point `ingestUrl` at the same fake-flare-server
  via your Mac's LAN IP.
