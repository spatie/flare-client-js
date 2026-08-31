// Ambient `process` type for tsc only (never imported). The tsconfig `types` list excludes @types/node
// to keep jest-dom matcher typings working; tsdown inlines PACKAGE_VERSION at build time regardless.
declare const process: { env?: { PACKAGE_VERSION?: string } } | undefined;
