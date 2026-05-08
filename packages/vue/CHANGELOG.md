## 2.0.0

### Breaking changes

- Bumps peer dependency `@flareapp/js` to `^2.0.0`. See its CHANGELOG for wire format changes.
- `flareVue` no longer passes a third `extraSolutionParameters` arg to `flare.report`.
- Vue error context now lands on the report as `attributes['context.custom'].vue.*` (was nested under `context.vue.*`). Key fields: `vue.info`, `vue.errorOrigin`, `vue.componentName`, `vue.componentHierarchy`, `vue.componentHierarchyFrames`, `vue.componentProps`, `vue.route`.
- `vue-router` moved from a required to an optional peer dependency.
- Dropped Vue 2 support. Only Vue 3 (`^3.0.0`) is supported.

### New

- **`FlareErrorBoundary` component.** Vue equivalent of the React error boundary. Catches errors in its subtree via `onErrorCaptured`, reports to Flare with full Vue context, and renders a `#fallback` slot with `error`, `componentProps`, `componentHierarchy`, `componentHierarchyFrames`, and `resetErrorBoundary`. Supports `resetKeys` for auto-reset and `onReset` callback.
- **Lifecycle hooks on `flareVue()`.** `beforeEvaluate`, `beforeSubmit`, and `afterSubmit` options give control over the report pipeline at the app level.
- **`captureWarnings` option.** When enabled, Vue warnings are reported via `flare.reportMessage()` at `warning` level.
- **Prop serialization.** `attachProps` (boolean), `propsMaxDepth` (number), `propsDenylist` (regex), and `replaceDefaultDenylist` (boolean) control which component props are included in reports. `DEFAULT_PROPS_DENYLIST` is exported.
- **Component hierarchy frames.** Reports include structured `componentHierarchyFrames` with component name, file path, and serialized props per frame.
- Route context is automatically captured from `app.config.globalProperties.$router` when an error occurs. No explicit router option needed.
- Non-`Error` values are coerced to `Error`.
- Chains existing `app.config.errorHandler` instead of replacing it silently.
- Duplicate-install guard prevents double-reporting when `app.use(flareVue)` is called more than once.
- The package self-identifies via `flare.setSdkInfo({ name: '@flareapp/vue', version })` and `flare.setFramework({ name: 'Vue', version: app.version })` on install.
- New exported types: `ComponentHierarchyFrame`, `ErrorOrigin`, `FlareErrorBoundaryFallbackProps`, `FlareErrorBoundaryHookParams`, `FlareVueContext`, `FlareVueOptions`, `FlareVueWarningContext`, `RouteContext`, `RouteParamValue`, `RouteQueryValue`.
