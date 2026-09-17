// Chrome: `at ComponentName (http://localhost:5173/src/App.tsx:12:9)`; no source: `at div`.
export const CHROMIUM_STACK_REGEX = /^at\s+(\S+)(?:\s+\((.+):(\d+):(\d+)\))?$/;

// Firefox/Safari: `ComponentName@http://localhost:5173/src/App.tsx:12:9`; no source: `div`.
export const FIREFOX_SAFARI_STACK_REGEX = /^(\S+?)@(.+):(\d+):(\d+)$/;

// React 16/17/18 synthetic component stack: `in ComponentName (at App.jsx:10[:5])`, or bare
// `in ComponentName` with no source. The file capture is lazy so `:line(:column)` still binds correctly
// when the path itself has colons. Without `__source`, React appends an owner suffix
// (`(created by Root)`), matched and discarded — greedy since owner names can contain brackets.
export const REACT_LEGACY_STACK_REGEX =
    /^in\s+(\S+)(?:\s+\(at\s+(.+?):(\d+)(?::(\d+))?\))?(?:\s+\(created by\s+.+\))?$/;

// tsdown inlines the member access at build time. A `typeof process` guard or a local `process`
// declaration survives the build and reads '?' in browsers. Under vitest it reads '?'.
export const PACKAGE_VERSION: string = process.env.PACKAGE_VERSION ?? '?';
