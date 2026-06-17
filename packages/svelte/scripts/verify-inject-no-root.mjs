import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const rootSpecifier = /["']@flareapp\/js["']/;
const relativeSpecifier = /(?:from\s*|require\(\s*)["'](\.\.?\/[^"']+)["']/g;

// svelte-package emits per-file .js (ESM). The inject entry re-exports from sibling files;
// follow the relative import graph transitively so a root import in any reachable file is caught.
const entries = ['inject.js'];
const scanned = new Set();
let failed = false;

function scan(absPath) {
    if (scanned.has(absPath)) {
        return;
    }
    scanned.add(absPath);
    let src;
    try {
        src = readFileSync(absPath, 'utf8');
    } catch {
        return; // .svelte sources or paths that resolved oddly — skip silently
    }
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
    `[verify-inject-no-root] OK — inject graph (${scanned.size} files) has no @flareapp/js root reference.`,
);
