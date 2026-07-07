// Ambient `process` type for type-checking only; picked up by tsc via "include", never imported.
// tsconfig "types": ["@testing-library/jest-dom"] excludes @types/node (dropping it breaks jest-dom
// matcher typings). tsdown replaces process.env.PACKAGE_VERSION with a string literal at build time.
declare const process: { env?: { PACKAGE_VERSION?: string } } | undefined;
