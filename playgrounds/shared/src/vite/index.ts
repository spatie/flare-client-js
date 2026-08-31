// Vite-config helpers shared by the playgrounds.
//
// Import these with a RELATIVE path (`../shared/src/vite`), not through the package name. Vite bundles
// relative imports into the config it loads, while a bare specifier gets externalized and handed to
// node, which cannot resolve the extensionless relative imports inside these TypeScript files.
export { flareSourcemapsForPlayground } from './flareSourcemaps';
export { playgroundAllowedHosts } from './hosts';
export { mockApi } from './mockApi';
