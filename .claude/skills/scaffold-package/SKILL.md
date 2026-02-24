---
name: scaffold-package
description: Scaffold a new framework integration package in the monorepo following existing patterns.
disable-model-invocation: true
allowed-tools: Bash, Read, Write
argument-hint: <package-name>
---

# Scaffold New Package

Create a new `@flareapp/$ARGUMENTS` package in `packages/$ARGUMENTS/` following the established monorepo patterns.

## Steps

1. Read `packages/react/package.json`, `packages/react/tsconfig.json`, and `packages/react/src/index.ts` as reference for the standard structure.

2. Create the following directory structure:

```
packages/$ARGUMENTS/
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
├── LICENSE
└── .npmignore
```

3. **`package.json`** — based on the React package pattern:
   - `name`: `@flareapp/$ARGUMENTS`
   - `version`: `1.0.0`
   - `main`: `./dist/index.js`
   - `module`: `./dist/index.mjs`
   - `types`: `./dist/index.d.ts`
   - `exports`: CJS + ESM map (same pattern as React package)
   - `scripts`: `build` (tsup), `prepublishOnly`, `typescript` (tsc)
   - `devDependencies`: `@flareapp/js` as `file:../js`, `typescript`, `tsup`
   - `peerDependencies`: `@flareapp/js: ^1.0.0` + the framework (ask user for version range)
   - `publishConfig`: `{ "access": "public" }`
   - Same `author`, `license`, `homepage`, `bugs`, `repository` fields as existing packages

4. **`tsconfig.json`** — extend root:
   ```json
   {
     "extends": "../../tsconfig.json",
     "include": ["src"]
   }
   ```

5. **`src/index.ts`** — a minimal starter with a TODO comment explaining what to implement.

6. **`LICENSE`** — copy from an existing package.

7. **`.npmignore`** — copy from an existing package.

8. Run `npm install` from the repo root to link the new workspace.

9. Verify the setup works: run `npm run build` and `npm run typescript` from the repo root.

10. Show a summary of what was created and suggest next steps.
