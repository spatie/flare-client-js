# Decode minified React errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag Flare reports from `@flareapp/react` with the structured number, args, and React version of a minified React production error, so the Flare backend can decode the human-readable message.

**Architecture:** A tiny pure parser (`parseMinifiedReactError`) extracts `number`/`args`/`url` from the error message via regex. A shared `buildReactContext` helper (replacing today's copy-pasted context block in the boundary and the handler) attaches the parsed `minifiedError` plus the React `version` to `context.react`. `contextToAttributes` forwards both new fields to the backend under `context.custom.react`. No code map is bundled; decoding happens server-side.

**Tech Stack:** TypeScript 5.7, Vitest, tsdown, `@flareapp/react` package.

---

## File Structure

- Create: `packages/react/src/parseMinifiedReactError.ts` — pure parser, message string to structured fields.
- Create: `packages/react/src/buildReactContext.ts` — shared builder for `context.react`, used by both error paths.
- Modify: `packages/react/src/types.ts` — add `MinifiedReactError` type, extend `FlareReactContext.react` with `version` + `minifiedError`.
- Modify: `packages/react/src/FlareErrorBoundary.ts` — replace inline context block with `buildReactContext`.
- Modify: `packages/react/src/flareReactErrorHandler.ts` — replace inline context block with `buildReactContext`.
- Modify: `packages/react/src/contextToAttributes.ts` — forward `version` + `minifiedError`.
- Modify: `packages/react/src/index.ts` — export `MinifiedReactError` type.
- Create: `packages/react/tests/parseMinifiedReactError.test.ts`
- Create: `packages/react/tests/buildReactContext.test.ts`
- Modify: `packages/react/tests/contextToAttributes.test.ts` — add required `version`, assert forwarding.

Run all react tests with: `cd packages/react && npx vitest run`
Type-check with: `cd packages/react && npx tsc --noEmit`

---

## Task 1: `parseMinifiedReactError` parser

**Files:**

- Modify: `packages/react/src/types.ts`
- Create: `packages/react/src/parseMinifiedReactError.ts`
- Test: `packages/react/tests/parseMinifiedReactError.test.ts`

This task is additive only (a new type alias + a new file). It does not touch `FlareReactContext`, so nothing else breaks.

- [ ] **Step 1: Add the `MinifiedReactError` type to `types.ts`**

Insert this block after the existing `ComponentStackFrame` type, leaving `FlareReactContext` unchanged for now:

```ts
export type MinifiedReactError = {
    number: number;
    args: string[];
    url: string | null;
};
```

- [ ] **Step 2: Write the failing test**

Create `packages/react/tests/parseMinifiedReactError.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { parseMinifiedReactError } from '../src/parseMinifiedReactError';

describe('parseMinifiedReactError', () => {
    test('parses a React 18/19 message (react.dev URL)', () => {
        const error = new Error(
            'Minified React error #418; visit https://react.dev/errors/418?args[]=Foo&args[]=Bar for the full message',
        );

        expect(parseMinifiedReactError(error)).toEqual({
            number: 418,
            args: ['Foo', 'Bar'],
            url: 'https://react.dev/errors/418?args[]=Foo&args[]=Bar',
        });
    });

    test('parses a React 16/17 message (reactjs.org error-decoder URL)', () => {
        const error = new Error(
            'Minified React error #185; visit https://reactjs.org/docs/error-decoder.html?invariant=185&args[]=Foo for the full message',
        );

        expect(parseMinifiedReactError(error)).toEqual({
            number: 185,
            args: ['Foo'],
            url: 'https://reactjs.org/docs/error-decoder.html?invariant=185&args[]=Foo',
        });
    });

    test('returns null for a non-minified error message', () => {
        expect(parseMinifiedReactError(new Error('Cannot read properties of undefined'))).toBeNull();
    });

    test('handles a minified message with no args', () => {
        const error = new Error('Minified React error #310; visit https://react.dev/errors/310 for the full message');

        expect(parseMinifiedReactError(error)).toEqual({
            number: 310,
            args: [],
            url: 'https://react.dev/errors/310',
        });
    });

    test('URL-decodes arg values', () => {
        const error = new Error(
            'Minified React error #418; visit https://react.dev/errors/418?args[]=%3Cdiv%3E&args[]=%20%26%20 for the full message',
        );

        expect(parseMinifiedReactError(error)).toEqual({
            number: 418,
            args: ['<div>', ' & '],
            url: 'https://react.dev/errors/418?args[]=%3Cdiv%3E&args[]=%20%26%20',
        });
    });

    test('returns null for an empty message without throwing', () => {
        expect(parseMinifiedReactError(new Error(''))).toBeNull();
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/react && npx vitest run tests/parseMinifiedReactError.test.ts`
Expected: FAIL — cannot resolve `../src/parseMinifiedReactError`.

- [ ] **Step 4: Write the implementation**

Create `packages/react/src/parseMinifiedReactError.ts`:

```ts
import type { MinifiedReactError } from './types';

const NUMBER_PATTERN = /Minified React error #(\d+)/;
const ARG_PATTERN = /args\[\]=([^&\s]*)/g;
const URL_PATTERN = /(https?:\/\/\S+)/;

export function parseMinifiedReactError(error: Error): MinifiedReactError | null {
    const message = error?.message;

    if (!message) {
        return null;
    }

    const numberMatch = message.match(NUMBER_PATTERN);

    if (!numberMatch) {
        return null;
    }

    const args: string[] = [];

    for (const match of message.matchAll(ARG_PATTERN)) {
        args.push(decodeURIComponent(match[1]));
    }

    const urlMatch = message.match(URL_PATTERN);

    return {
        number: Number(numberMatch[1]),
        args,
        url: urlMatch ? urlMatch[1] : null,
    };
}
```

Note: `\S+` stops the URL capture at the first whitespace, so the trailing " for the full message" is excluded. `[^&\s]*` stops each arg at the next `&` or whitespace.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/react && npx vitest run tests/parseMinifiedReactError.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/types.ts packages/react/src/parseMinifiedReactError.ts packages/react/tests/parseMinifiedReactError.test.ts
git commit -m "feat(react): parse minified React errors into structured fields"
```

---

## Task 2: Attach version + minifiedError to the report context

**Files:**

- Modify: `packages/react/src/types.ts`
- Create: `packages/react/src/buildReactContext.ts`
- Modify: `packages/react/src/FlareErrorBoundary.ts:44-49`
- Modify: `packages/react/src/flareReactErrorHandler.ts:34-39`
- Modify: `packages/react/src/contextToAttributes.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/buildReactContext.test.ts`
- Modify: `packages/react/tests/contextToAttributes.test.ts`

Making `version` a required field of `FlareReactContext.react` breaks raw context literals. The only raw literals in tests are in `contextToAttributes.test.ts`; the boundary/handler tests build context through the real code path or spread `...context.react`, so they keep compiling. This whole task is one coherent change and is committed once, green.

- [ ] **Step 1: Write the failing test for `buildReactContext`**

Create `packages/react/tests/buildReactContext.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { version as reactVersion } from 'react';

import { buildReactContext } from '../src/buildReactContext';

const stack = '\n    at App (http://localhost:5173/src/App.tsx:5:3)\n';

describe('buildReactContext', () => {
    test('includes the React version on every context', () => {
        const context = buildReactContext(stack, new Error('plain error'));

        expect(context.react.version).toBe(reactVersion);
    });

    test('parses component stack into componentStack and componentStackFrames', () => {
        const context = buildReactContext(stack, new Error('plain error'));

        expect(context.react.componentStack).toEqual(['at App (http://localhost:5173/src/App.tsx:5:3)']);
        expect(context.react.componentStackFrames).toEqual([
            { component: 'App', file: 'http://localhost:5173/src/App.tsx', line: 5, column: 3 },
        ]);
    });

    test('omits minifiedError for a plain error', () => {
        const context = buildReactContext(stack, new Error('plain error'));

        expect(context.react.minifiedError).toBeUndefined();
    });

    test('attaches minifiedError for a minified React error', () => {
        const error = new Error(
            'Minified React error #418; visit https://react.dev/errors/418?args[]=Foo for the full message',
        );

        const context = buildReactContext(stack, error);

        expect(context.react.minifiedError).toEqual({
            number: 418,
            args: ['Foo'],
            url: 'https://react.dev/errors/418?args[]=Foo',
        });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/react && npx vitest run tests/buildReactContext.test.ts`
Expected: FAIL — cannot resolve `../src/buildReactContext`.

- [ ] **Step 3: Extend `FlareReactContext` in `types.ts`**

Replace the existing `FlareReactContext` type with:

```ts
export type FlareReactContext = {
    react: {
        componentStack: string[];
        componentStackFrames: ComponentStackFrame[];
        version: string;
        minifiedError?: MinifiedReactError;
    };
};
```

- [ ] **Step 4: Create `buildReactContext.ts`**

Create `packages/react/src/buildReactContext.ts`:

```ts
import { version } from 'react';

import { formatComponentStack } from './formatComponentStack';
import { parseComponentStack } from './parseComponentStack';
import { parseMinifiedReactError } from './parseMinifiedReactError';
import type { FlareReactContext } from './types';

export function buildReactContext(rawStack: string, error: Error): FlareReactContext {
    const minifiedError = parseMinifiedReactError(error);

    return {
        react: {
            componentStack: formatComponentStack(rawStack),
            componentStackFrames: parseComponentStack(rawStack),
            version,
            ...(minifiedError ? { minifiedError } : {}),
        },
    };
}
```

- [ ] **Step 5: Run the `buildReactContext` test to verify it passes**

Run: `cd packages/react && npx vitest run tests/buildReactContext.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Use `buildReactContext` in `FlareErrorBoundary.ts`**

In `packages/react/src/FlareErrorBoundary.ts`, replace the inline block in `componentDidCatch`:

```ts
const rawStack = errorInfo.componentStack ?? '';

const context: FlareReactContext = {
    react: {
        componentStack: formatComponentStack(rawStack),
        componentStackFrames: parseComponentStack(rawStack),
    },
};
```

with:

```ts
const rawStack = errorInfo.componentStack ?? '';

const context = buildReactContext(rawStack, error);
```

Then update the imports at the top of the file: remove the now-unused `formatComponentStack` and `parseComponentStack` imports and add `buildReactContext`:

```ts
import { buildReactContext } from './buildReactContext';
```

Keep the `FlareReactContext` type import — it is still used in the prop type signatures.

- [ ] **Step 7: Use `buildReactContext` in `flareReactErrorHandler.ts`**

In `packages/react/src/flareReactErrorHandler.ts`, replace the inline block:

```ts
const rawStack = errorInfo.componentStack ?? '';

const context: FlareReactContext = {
    react: {
        componentStack: formatComponentStack(rawStack),
        componentStackFrames: parseComponentStack(rawStack),
    },
};
```

with:

```ts
const rawStack = errorInfo.componentStack ?? '';

const context = buildReactContext(rawStack, errorObject);
```

Note: pass `errorObject` (the converted Error), not `error` (the raw `unknown`). Update imports: remove `formatComponentStack` and `parseComponentStack`, add `import { buildReactContext } from './buildReactContext';`. Keep the `FlareReactContext` import (used in option type signatures).

- [ ] **Step 8: Forward the new fields in `contextToAttributes.ts`**

Replace the body of `contextToAttributes` in `packages/react/src/contextToAttributes.ts`:

```ts
export function contextToAttributes(context: FlareReactContext): Attributes {
    return {
        'context.custom': {
            react: {
                componentStack: context.react.componentStack as AttributeValue,
                componentStackFrames: context.react.componentStackFrames as AttributeValue,
                version: context.react.version as AttributeValue,
                ...(context.react.minifiedError
                    ? { minifiedError: context.react.minifiedError as AttributeValue }
                    : {}),
            },
        },
    };
}
```

- [ ] **Step 9: Export `MinifiedReactError` from `index.ts`**

In `packages/react/src/index.ts`, update the type export line:

```ts
export type { ComponentStackFrame, FlareReactContext, MinifiedReactError } from './types';
```

- [ ] **Step 10: Update `contextToAttributes.test.ts` for the required `version` and forwarding**

Replace the file `packages/react/tests/contextToAttributes.test.ts` with:

```ts
import { describe, expect, test } from 'vitest';

import { contextToAttributes } from '../src/contextToAttributes';
import { FlareReactContext } from '../src/types';

describe('contextToAttributes', () => {
    test('wraps react context (with version) under context.custom', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: ['at App', 'at div'],
                componentStackFrames: [{ component: 'App', file: 'App.tsx', line: 5, column: 3 }],
                version: '19.0.0',
            },
        };

        const attributes = contextToAttributes(context);

        expect(attributes).toEqual({
            'context.custom': {
                react: {
                    componentStack: ['at App', 'at div'],
                    componentStackFrames: [{ component: 'App', file: 'App.tsx', line: 5, column: 3 }],
                    version: '19.0.0',
                },
            },
        });
    });

    test('forwards minifiedError when present', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: [],
                componentStackFrames: [],
                version: '19.0.0',
                minifiedError: { number: 418, args: ['Foo'], url: 'https://react.dev/errors/418?args[]=Foo' },
            },
        };

        const attributes = contextToAttributes(context);

        expect((attributes['context.custom'] as any).react.minifiedError).toEqual({
            number: 418,
            args: ['Foo'],
            url: 'https://react.dev/errors/418?args[]=Foo',
        });
    });

    test('omits minifiedError when absent', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: [],
                componentStackFrames: [],
                version: '19.0.0',
            },
        };

        const attributes = contextToAttributes(context);

        expect((attributes['context.custom'] as any).react).not.toHaveProperty('minifiedError');
    });
});
```

- [ ] **Step 11: Run the full react suite and type-check**

Run: `cd packages/react && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors. If `tsc` flags an unused import in `FlareErrorBoundary.ts` or `flareReactErrorHandler.ts`, remove the leftover `formatComponentStack`/`parseComponentStack` import.

- [ ] **Step 12: Commit**

```bash
git add packages/react/src packages/react/tests/buildReactContext.test.ts packages/react/tests/contextToAttributes.test.ts
git commit -m "feat(react): attach React version and minified error to report context"
```

---

## Task 3: End-to-end assertion through the handler

**Files:**

- Modify: `packages/react/tests/flareReactErrorHandler.test.ts`

Lock in that a minified React error thrown through the real handler path surfaces `minifiedError` and `version` in the reported attributes. This guards the wiring, not just the unit.

- [ ] **Step 1: Write the failing test**

Append this `describe` block inside the top-level `describe('flareReactErrorHandler', ...)` in `packages/react/tests/flareReactErrorHandler.test.ts`:

```ts
describe('minified React errors', () => {
    test('forwards minifiedError and version in the reported attributes', () => {
        const handler = flareReactErrorHandler();
        const error = new Error(
            'Minified React error #418; visit https://react.dev/errors/418?args[]=Foo for the full message',
        );

        handler(error, { componentStack: '    at App' });

        const attributes = mockReport.mock.calls[0][1];
        const react = (attributes['context.custom'] as any).react;

        expect(react.minifiedError).toEqual({
            number: 418,
            args: ['Foo'],
            url: 'https://react.dev/errors/418?args[]=Foo',
        });
        expect(typeof react.version).toBe('string');
    });

    test('omits minifiedError for a plain error', () => {
        const handler = flareReactErrorHandler();

        handler(new Error('plain error'), { componentStack: '    at App' });

        const attributes = mockReport.mock.calls[0][1];
        expect((attributes['context.custom'] as any).react).not.toHaveProperty('minifiedError');
    });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd packages/react && npx vitest run tests/flareReactErrorHandler.test.ts`
Expected: PASS. (The wiring already exists from Task 2, so this test confirms it rather than driving new code. If it fails, the handler is not calling `buildReactContext` with the converted error — revisit Task 2 Step 7.)

- [ ] **Step 3: Commit**

```bash
git add packages/react/tests/flareReactErrorHandler.test.ts
git commit -m "test(react): assert minified error reaches reported attributes end-to-end"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole repo**

Run: `npm run typescript`
Expected: no errors.

- [ ] **Step 2: Run the react package tests**

Run: `cd packages/react && npx vitest run`
Expected: all PASS.

- [ ] **Step 3: Build the react package**

Run: `cd packages/react && npm run build`
Expected: clean CJS + ESM + d.ts output. This confirms `import { version } from 'react'` resolves through tsdown/rollup against the React peer dependency (named CJS export interop).

- [ ] **Step 4: Update the README**

Add a short note to `packages/react/README.md` documenting that the client now attaches `react.version` and, for minified production errors, `react.minifiedError` (`{ number, args, url }`) to the report context, which the Flare backend uses to decode the message. Match the README's existing section style.

- [ ] **Step 5: Commit**

```bash
git add packages/react/README.md
git commit -m "docs(react): document minified error decoding context"
```

---

## Notes for the implementer

- Do not bundle React's `codes.json`. The decoding happens on the Flare backend; the client only ships the structured fields.
- `import { version } from 'react'` relies on React's named CJS export `version`, present in all peer-supported majors (16/17/18/19). Task 4 Step 3 verifies the build resolves it.
- The global `window.onerror` path in `@flareapp/js` is intentionally out of scope. Only the boundary and handler paths get the parse.
