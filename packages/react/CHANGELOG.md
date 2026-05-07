## 2.0.0

### Breaking changes

- Bumps peer dependency `@flareapp/js` to `^2.0.0`. See its CHANGELOG for wire format changes.
- `flareReactErrorHandler` no longer passes a third `extraSolutionParameters` arg to `flare.report` (solutions API removed in `@flareapp/js` v2).
- The React component stack now lands on the report as `attributes['context.custom'].react.componentStack` and `attributes['context.custom'].react.componentStackFrames` (was nested under `context.react.*`). The `beforeSubmit` callback shape is unchanged.

### New

- The package self-identifies via `flare.setSdkInfo({ name: '@flareapp/react', version })` and `flare.setFramework({ name: 'React', version: React.version })` on import.
