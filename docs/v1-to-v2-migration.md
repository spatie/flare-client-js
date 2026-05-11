# Migrating to `@flareapp/js@2` / `@flareapp/react@2` / `@flareapp/vue@2`

v2 emits the Flare server's canonical payload format directly. The v1 SDKs also have this new format from >=1.2.0. We are enventually going to retire the old ingestion endpoint, so make sure you are on >=1.2.0 or 2.0.0.

## What changes in your code

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

The third parameter changed from `exceptionClass` (an arbitrary string, default `'Log'`) to `level` (a `MessageLevel` union), and swapped position with the second parameter:

```diff
-flare.reportMessage('hello', { foo: 'bar' }, 'Log');
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

| Old                                  | New                                                  |
| ------------------------------------ | ---------------------------------------------------- |
| `report.exception_class`             | `report.exceptionClass`                              |
| `report.seen_at`                     | `report.seenAtUnixNano` (nanoseconds)                |
| `report.context`                     | `report.attributes`                                  |
| `report.glows`                       | `report.events.filter(e => e.type === 'php_glow')`   |
| `report.notifier`                    | gone (use `report.attributes['telemetry.sdk.name']`) |
| `report.stacktrace[i].line_number`   | `report.stacktrace[i].lineNumber`                    |
| `report.stacktrace[i].column_number` | `report.stacktrace[i].columnNumber`                  |
| `report.stacktrace[i].code_snippet`  | `report.stacktrace[i].codeSnippet`                   |

New fields on `Report` (not renames):

| Field                                     | Description                                            |
| ----------------------------------------- | ------------------------------------------------------ |
| `report.level`                            | Message level (`'info'`, `'warning'`, `'error'`, etc.) |
| `report.stacktrace[i].isApplicationFrame` | Whether the frame belongs to application code          |

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

The `@flareapp/vue` plugin picks up Vue Router context automatically from `app.config.globalProperties.$router` (set when you call `app.use(router)`). No extra configuration needed.

For React (or other JS frameworks), call `setEntryPoint` from your routing layer's navigation hook.

### New: `code` auto-populated from `error.code`

```ts
const err = new Error('Connection failed');
(err as any).code = 'ENOTFOUND';
flare.report(err); // payload.code === 'ENOTFOUND'
```

### New: `sampleRate`

```ts
flare.configure({ sampleRate: 0.5 }); // report ~50% of errors
```

Number between `0` and `1` (default `1`). Applies to `report()`, `reportMessage()`, and `reportUnhandledRejection()`. Works the same regardless of framework — configure it via `@flareapp/js`.

### Vue 2 dropped

`@flareapp/vue@2` only supports Vue 3 (`^3.0.0`). If you are on Vue 2, stay on `@flareapp/vue@1`.

## What did NOT change

- Authentication mechanism (project API key in a header).
- Public method names: `light`, `configure`, `report`, `reportMessage`, `glow`, `clearGlows`, `addContext`, `addContextGroup`, `test`.
- Sourcemap upload (`@flareapp/vite`) protocol.
