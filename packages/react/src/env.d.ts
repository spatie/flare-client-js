// Provides the `process` type for type-checking only.
// tsconfig.json sets "types": ["@testing-library/jest-dom"] which excludes @types/node.
// Removing that field would break jest-dom matcher typings (.toBeInTheDocument() etc.).
// tsdown replaces process.env.PACKAGE_VERSION with a string literal at build time.
// This file must NOT be imported — it is an ambient declaration picked up by tsc via "include".
declare const process: { env?: { PACKAGE_VERSION?: string } } | undefined;
