import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

// Match a bare @flareapp/js root specifier but NOT @flareapp/js/browser (type-only,
// erased in JS) or @flareapp/js/anything-else.
const rootSpecifier = /["']@flareapp\/js["']/;

// tsdown emits the inject entry as a thin re-export shim that imports the real code from a
// shared chunk. Grepping only the entry would miss a root import that landed in that chunk, so
// follow every relative import/require transitively and scan the whole reachable graph.
const relativeSpecifier = /(?:from\s*|require\(\s*)["'](\.\.?\/[^"']+)["']/g;

const entries = ['inject.mjs', 'inject.cjs'];
const scanned = new Set();
let failed = false;

function scan(absPath) {
    if (scanned.has(absPath)) {
        return;
    }
    scanned.add(absPath);

    const src = readFileSync(absPath, 'utf8');
    if (rootSpecifier.test(src)) {
        console.error(
            `[verify-inject-no-root] ${absPath} references the @flareapp/js root. The inject entry must not pull the root.`,
        );
        failed = true;
    }

    for (const match of src.matchAll(relativeSpecifier)) {
        scan(resolve(dirname(absPath), match[1]));
    }
}

for (const entry of entries) {
    scan(resolve(distDir, entry));
}

if (failed) {
    process.exit(1);
}
console.log(
    `[verify-inject-no-root] OK — inject bundle (${scanned.size} files incl. chunks) has no @flareapp/js root reference.`,
);
