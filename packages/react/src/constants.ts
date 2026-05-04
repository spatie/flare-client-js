// Local `process` declaration because tsconfig.json sets "types": ["@testing-library/jest-dom"]
// which excludes @types/node. Removing that field would break jest-dom matcher typings
// (.toBeInTheDocument() etc.) in test files. tsdown replaces process.env.PACKAGE_VERSION with a
// string literal at build time, so this declaration is only needed for type-checking.
declare const process: { env?: { PACKAGE_VERSION?: string } } | undefined;

// Chrome:
// "at ComponentName (http://localhost:5173/src/App.tsx:12:9)"
// (no source): "at div"
export const CHROMIUM_STACK_REGEX = /^at\s+(\S+)(?:\s+\((.+):(\d+):(\d+)\))?$/;

// Firefox/Safari:
// "ComponentName@http://localhost:5173/src/App.tsx:12:9"
// (no source): "div"
export const FIREFOX_SAFARI_STACK_REGEX = /^(\S+?)@(.+):(\d+):(\d+)$/;

// Injected at build time via tsdown --env.PACKAGE_VERSION (reads package.json version).
export const PACKAGE_VERSION =
    typeof process !== 'undefined' && typeof process.env?.PACKAGE_VERSION !== 'undefined'
        ? process.env.PACKAGE_VERSION
        : '?';
