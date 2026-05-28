// Hides `node:` specifiers from bundlers (webpack, esbuild) so consumers that bundle
// @flareapp/node into a non-node target don't fail to resolve the import statically.
export const nativeImport = new Function('id', 'return import(id)') as <T = unknown>(id: string) => Promise<T>;
