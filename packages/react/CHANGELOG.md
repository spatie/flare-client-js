## 2.0.0

### Breaking changes

- Bumps peer dependency `@flareapp/js` to `^2.0.0`. See its CHANGELOG for wire format changes.
- `flareReactErrorHandler` no longer passes a third `extraSolutionParameters` arg to `flare.report` (solutions API removed in `@flareapp/js` v2).
- The React component stack now lands on the report as `attributes['context.custom'].react.componentStack` and `attributes['context.custom'].react.componentStackFrames` (was nested under `context.react.*`).

### New

- **`FlareErrorBoundary` lifecycle hooks.** `beforeEvaluate`, `beforeSubmit`, and `afterSubmit` props give full control over the report pipeline from within the boundary.
- **`resetKeys` prop.** Mirrors `react-error-boundary`'s contract: when any element changes by `Object.is`, the boundary auto-resets. Pairs with the `onReset` callback.
- **`FlareErrorBoundaryFallbackProps`** now includes `resetErrorBoundary()` for programmatic reset from fallback UI.
- **`flareReactErrorHandler()` lifecycle hooks.** Same `beforeEvaluate`, `beforeSubmit`, and `afterSubmit` options, for use with third-party error boundaries.
- Non-`Error` values passed to `flareReactErrorHandler` are coerced to `Error`.
- The package self-identifies via `flare.setSdkInfo({ name: '@flareapp/react', version })` and `flare.setFramework({ name: 'React', version: React.version })` on import.
- New exported types: `ComponentStackFrame`, `FlareReactContext`, `FlareReactErrorHandlerCallback`, `FlareReactErrorHandlerOptions`.
