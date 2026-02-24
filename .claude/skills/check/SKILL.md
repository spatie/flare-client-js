---
name: check
description: Run the full CI validation suite — type-check, tests, formatting, and build — across all packages.
disable-model-invocation: true
allowed-tools: Bash
---

# Full CI Check

Run all validation steps from the repo root to make sure the monorepo is in a clean, releasable state.

## Steps

Run each of these sequentially from the repo root. Stop and report clearly on the first failure:

1. **Type-check**: `npm run typescript`
2. **Tests**: `npm run test`
3. **Format check**: `npx prettier --check "**/*.{js,json,vue,ts,tsx}"`
4. **Build**: `npm run build`

## Output

Show a concise pass/fail summary for each step:

```
Type-check:   PASS
Tests:        PASS (X tests)
Formatting:   PASS
Build:        PASS (4 packages)
```

If any step fails, show the relevant error output and suggest how to fix it (e.g., `npm run format` for formatting issues).
