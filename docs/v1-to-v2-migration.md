# Migrating to `@flareapp/js@2` / `@flareapp/react@2` / `@flareapp/vue@2`

v2 emits the Flare server's canonical wire format directly. v1 SDKs still work — the server keeps a legacy mapper — but v2 traffic skips the mapper entirely and posts to a new endpoint.

## What changed in your code

### Renamed config keys

```diff
 flare.configure({
-    reportingUrl: 'https://reporting.flareapp.io/api/reports',
+    ingestUrl: 'https://ingress.flareapp.io/v1/errors',
-    sourcemapVersion: 'v3',
+    sourcemapVersionId: 'v3',
 });
```

### Removed deprecated setters

```diff
-flare.beforeEvaluate = (err) => err;
-flare.beforeSubmit = (report) => report;
-flare.stage = 'production';
+flare.configure({
+    beforeEvaluate: (err) => err,
+    beforeSubmit: (report) => report,
+    stage: 'production',
+});
```

### `reportMessage` signature

```diff
-flare.reportMessage('hello', { foo: 'bar' }, 'Log INFO');
+flare.reportMessage('hello', 'info', { foo: 'bar' });
```

### Solutions API removed

```diff
-flare.registerSolutionProvider({ canSolve, getSolutions });
-flare.report(error, context, { extraParam: 1 });
+flare.report(error, attributes);
```

### `beforeSubmit` receives the new payload shape

If your `beforeSubmit` callback inspects or mutates the report, update field accesses:

| Old | New |
|---|---|
| `report.exception_class` | `report.exceptionClass` |
| `report.seen_at` | `report.seenAtUnixNano` (nanoseconds) |
| `report.context` | `report.attributes` |
| `report.glows` | `report.events.filter(e => e.type === 'php_glow')` |
| `report.message_level` | `report.level` |
| `report.notifier` | gone (use `report.attributes['telemetry.sdk.name']`) |
| `report.stacktrace[i].line_number` | `report.stacktrace[i].lineNumber` |
| `report.stacktrace[i].column_number` | `report.stacktrace[i].columnNumber` |
| `report.stacktrace[i].code_snippet` | `report.stacktrace[i].codeSnippet` |
| `report.stacktrace[i].application_frame` | `report.stacktrace[i].isApplicationFrame` |

### Custom context

The user-facing API is unchanged:

```ts
flare.addContext('orderId', 42);
flare.addContextGroup('feature_flags', { darkMode: true });
```

Internally, these write into `attributes['context.custom']` and `attributes['context.feature_flags']`.

### New: SPA route tagging via `setEntryPoint`

```ts
flare.setEntryPoint({
    identifier: '/users/:id',
    name: 'UserShow',
    type: 'react_route', // or 'vue_route' — your choice
});
```

The `@flareapp/vue` package wires this up automatically when given a `vue-router` instance:

```ts
app.use(flareVue, { router });
```

For React (or other JS frameworks), call `setEntryPoint` from your routing layer's navigation hook.

### New: `code` auto-populated from `error.code`

```ts
const err = new Error('Connection failed');
(err as any).code = 'ENOTFOUND';
flare.report(err); // payload.code === 'ENOTFOUND'
```

## What did NOT change

- Authentication mechanism (project API key in a header).
- Public method names: `light`, `configure`, `report`, `reportMessage`, `glow`, `clearGlows`, `addContext`, `addContextGroup`, `test`.
- Sourcemap upload (`@flareapp/vite`) protocol.
