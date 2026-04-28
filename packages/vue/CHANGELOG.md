## 2.0.0

### Breaking changes

- Bumps peer dependency `@flareapp/js` to `^2.0.0`. See its CHANGELOG for wire format changes.
- `flareVue` no longer passes a third `extraSolutionParameters` arg to `flare.report`.
- Vue error context now lands on the report as `attributes['vue.error.info']` and `attributes['vue.error.component_name']` (was nested under `context.vue.*`).

### New

- `flareVue(app, { router })` — when a `vue-router` instance is provided, the plugin registers `router.afterEach` and pushes the current route metadata into `flare.setEntryPoint`. `vue-router` is now an optional peer dep.
- The package self-identifies via `flare.setSdkInfo({ name: '@flareapp/vue', version })` and `flare.setFramework({ name: 'Vue', version: app.version })` on install.
