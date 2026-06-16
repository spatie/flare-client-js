import { readFileSync } from 'node:fs';

const files = ['dist/inject.mjs', 'dist/inject.cjs'];
// Match a bare @flareapp/js root specifier but NOT @flareapp/js/browser (type-only,
// erased in JS) or @flareapp/js/anything-else.
const rootSpecifier = /["']@flareapp\/js["']/;

let failed = false;
for (const file of files) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    if (rootSpecifier.test(src)) {
        console.error(`[verify-inject-no-root] ${file} references the @flareapp/js root. The inject entry must not pull the root.`);
        failed = true;
    }
}
if (failed) {
    process.exit(1);
}
console.log('[verify-inject-no-root] OK — inject bundle has no @flareapp/js root reference.');
