# Decode minified React errors (React client)

Date: 2026-06-08
Package: `@flareapp/react`

## Problem

Production React throws opaque errors:

```
Minified React error #418; visit https://react.dev/errors/418?args[]=foo&args[]=bar
for the full message or use the non-minified dev environment for full errors and
additional helpful warnings.
```

The readable message lives in React's `codes.json` (number → template with `%s`
slots), interpolated with the `args[]` from the URL. Today Flare reports the raw
minified message. We want the decoded, human-readable message surfaced in Flare.

## Constraints

- No massive bundlesize increase. React's `codes.json` is ~500 entries
  (~30-50KB raw); bundling it into the client is rejected.
- Scope: `@flareapp/react` only. The two error paths that own React context
  (`FlareErrorBoundary` + `flareReactErrorHandler`) catch render/commit errors,
  where virtually all `Minified React error #` throws originate (hydration #418,
  hooks #310, setState-on-unmounted #185). Global `window.onerror` in
  `@flareapp/js` is intentionally NOT touched: keeping React-specific regex out
  of the framework-agnostic core avoids bundle cost for non-React users.

## Decision: client parses, backend looks up

Split the work:

- Client: cheap regex parse of the error message into structured fields. Near-zero
  bundle cost (one pure function).
- Backend (out of scope for this repo): on seeing the structured field, do the
  `codes.json` lookup, pick the map by React version, interpolate the template
  with `args`. The big map stays server-side, reused across all reports,
  version-pinned.

Client attaches to the report context:

```
react.minifiedError = {
  number: 418,
  args: ["foo", "bar"],
  url: "https://react.dev/errors/418?args[]=foo&args[]=bar",
}
react.version = "19.0.0"
```

Backend keys off presence of `react.minifiedError` to decide when to decode.
`react.version` lets it pick the matching `codes.json` (templates drift across
React versions).

## Components

### 1. `parseMinifiedReactError.ts` (new)

```ts
export type MinifiedReactError = {
    number: number;
    args: string[];
    url: string | null;
};

export function parseMinifiedReactError(error: Error): MinifiedReactError | null;
```

- Match `/Minified React error #(\d+)/` against `error.message`. No match →
  return `null`. This is the common path (most errors are not minified React
  errors), so it exits cheap.
- Args: match all occurrences of `args[]=<value>` in the message, `decodeURIComponent`
  each value. Both URL formats use `args[]=` — react.dev (React 18/19) and
  reactjs.org/docs/error-decoder.html (React 16/17).
- URL: extract the first `https?://\S+` substring from the message; `null` if absent.
- Guard against a missing/undefined `error.message`.
- Pure, side-effect free, independently testable.

### 2. React version

`import { version } from 'react'` at module top of the shared context builder.
React exports `version` in all peer-supported majors (16/17/18/19). Negligible
bundle impact — the peer dep is already loaded by the host app.

### 3. `buildReactContext.ts` (new, shared helper)

Today `FlareErrorBoundary.componentDidCatch` and `flareReactErrorHandler` build an
identical `context.react` block by copy-paste. This feature adds two more fields to
that block; folding the construction into one helper removes the drift risk.

```ts
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

Both call sites become `const context = buildReactContext(rawStack, error);`.

### 4. Type extension (`types.ts`)

```ts
export type FlareReactContext = {
    react: {
        componentStack: string[];
        componentStackFrames: ComponentStackFrame[];
        version: string; // always sent
        minifiedError?: MinifiedReactError; // only when parse matches
    };
};
```

### 5. `contextToAttributes.ts`

Forward the two new fields under `context.custom.react`:

```ts
react: {
    componentStack: context.react.componentStack as AttributeValue,
    componentStackFrames: context.react.componentStackFrames as AttributeValue,
    version: context.react.version as AttributeValue,
    ...(context.react.minifiedError
        ? { minifiedError: context.react.minifiedError as AttributeValue }
        : {}),
},
```

## Data flow

1. Error caught by `FlareErrorBoundary.componentDidCatch` or `flareReactErrorHandler`.
2. `buildReactContext(rawStack, error)` builds `context.react`, including `version`
   always and `minifiedError` when the message parses as a minified React error.
3. `beforeSubmit` hook can still modify/replace the context (unchanged contract).
4. `contextToAttributes` maps it to `context.custom.react.*`.
5. `flare.reportSilently` sends it.
6. Backend (out of scope): detects `react.minifiedError`, looks up `codes.json` by
   `react.version`, interpolates `args`, surfaces the decoded message.

## Testing

- `parseMinifiedReactError`:
    - React 18/19 message (react.dev URL) → correct number, decoded args, url.
    - React 16/17 message (reactjs.org error-decoder URL) → correct number, args, url.
    - Non-minified error message → `null`.
    - Minified message with no args → empty `args`, number + url set.
    - URL-encoded arg values → decoded.
    - Missing/empty `error.message` → `null`, no throw.
- `buildReactContext`: minified error present → `minifiedError` set + `version`
  present; plain error → no `minifiedError`, `version` present.
- `contextToAttributes`: new fields forwarded; `minifiedError` omitted when absent.
- Existing boundary/handler tests still pass (context shape additive, not breaking).

## Out of scope

- Backend `codes.json` lookup and interpolation.
- Global `window.onerror` path in `@flareapp/js`.
- Bundling the codes map client-side.
