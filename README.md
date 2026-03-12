# Flare JavaScript Client

The official JavaScript/TypeScript client for [Flare](https://flareapp.io) error tracking
by [Spatie](https://spatie.be). Captures frontend errors, collects browser context (cookies, request data, query
params), and reports them to the Flare backend. Includes framework integrations for React and Vue, and a Vite plugin for
sourcemap uploads.

Read the JavaScript error tracking section
in [the Flare documentation](https://flareapp.io/docs/javascript-error-tracking/installation) for more information.

## Packages

This is a npm workspaces monorepo containing the following packages:

| Package                            | npm                                                                | Description                                                                        |
|------------------------------------|--------------------------------------------------------------------|------------------------------------------------------------------------------------|
| [`packages/js`](packages/js)       | [`@flareapp/js`](https://www.npmjs.com/package/@flareapp/js)       | Core client for error capture, stack traces, context collection, and API reporting |
| [`packages/react`](packages/react) | [`@flareapp/react`](https://www.npmjs.com/package/@flareapp/react) | React error boundary component and React 19 error handler                          |
| [`packages/vue`](packages/vue)     | [`@flareapp/vue`](https://www.npmjs.com/package/@flareapp/vue)     | Vue error handler plugin                                                           |
| [`packages/vite`](packages/vite)   | [`@flareapp/vite`](https://www.npmjs.com/package/@flareapp/vite)   | Vite build plugin for sourcemap uploads                                            |
| [`playground`](playground)         | (private)                                                          | Local dev/test app for all integrations                                            |

## Local development

### Prerequisites

- Node.js >= 18 (see `.node-version` for the exact version used in development)
- npm (comes with Node.js)

### Setup

```bash
# Clone the repo
git clone https://github.com/spatie/flare-client-js.git
cd flare-client-js

# Install all dependencies (root + all workspaces)
npm install

# Build all packages
npm run build
```

### Commands

All commands are run from the repository root:

| Command              | Description                                           |
|----------------------|-------------------------------------------------------|
| `npm run build`      | Build all packages to their respective `dist` folders |
| `npm run test`       | Run tests for all packages that have them             |
| `npm run typescript` | Type-check all packages                               |
| `npm run format`     | Run Prettier across all files                         |
| `npm run playground` | Build packages, then start the playground dev server  |

### Playground

The playground is a local Vite dev app for manually testing all integrations. Each page has
buttons that trigger different error types.

```bash
# Copy the env file and add your Flare API keys
cp playground/.env.example playground/.env.local

# Start the playground
npm run playground
```

See the [playground README](playground/README.md) for more details.

### Code style

Formatting is handled by Prettier. A pre-commit hook (Husky + lint-staged) automatically formats staged files on commit.

To manually format all files:

```bash
npm run format
```

See `.prettierrc` for the full configuration.

### CI

GitHub Actions runs on every push:

- **Test**: installs dependencies, builds all packages, runs all tests
- **TypeScript**: installs dependencies, builds all packages, type-checks all packages

## Versioning and releasing

Each package is versioned and published independently.

### Bumping a version

1. Update the `version` field in the package's `package.json`
2. Commit the version bump
3. Tag the commit using the format `<package-name>@<version>` (e.g. `@flareapp/js@1.2.0`)
4. Push the commit and tag

```bash
# Example: releasing @flareapp/js v1.2.0
cd packages/js
# Update version in package.json to 1.2.0, then:
cd ../..
git add packages/js/package.json
git commit -m "Release @flareapp/js v1.2.0"
git tag @flareapp/js@1.2.0
git push origin main --tags
```

### Publishing to npm

Run `npm publish` from the individual package directory. The `prepublishOnly` script in each package automatically runs
a build before publishing.

```bash
cd packages/js
npm publish
```

All packages have `"publishConfig": { "access": "public" }` so they are published as public scoped packages.

### Publishing multiple packages

When releasing changes that span multiple packages, publish them in dependency order:

1. `@flareapp/js` (core, no internal dependencies)
2. `@flareapp/vite` (no internal dependencies)
3. `@flareapp/react` (depends on `@flareapp/js`)
4. `@flareapp/vue` (depends on `@flareapp/js`)

## Project structure

```
flare-client-js/
├── packages/
│   ├── js/          # Core client
│   ├── react/       # React integration
│   ├── vue/         # Vue integration
│   └── vite/        # Vite sourcemap plugin
├── playground/      # Local dev/test app
├── .github/         # GitHub Actions workflows
├── .husky/          # Git hooks (pre-commit formatting)
└── package.json     # Root workspace config
```

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
