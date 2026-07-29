import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));

const inject = pkg.exports?.['./inject'];
let failed = false;
const fail = (msg) => {
    console.error(`[verify-exports] ${msg}`);
    failed = true;
};

if (!inject) {
    fail('package.json exports["./inject"] is missing');
    process.exit(1);
}

// Assert the EXACT target for each condition. Existence alone is insufficient — a target of
// ./dist/index.js (the web root) would exist and re-export the same names, yet pull the root.
const expectedTargets = {
    'svelte': './dist/inject.js',
    'import.types': './dist/inject.d.ts',
    'import.default': './dist/inject.js',
};
const actualTargets = {
    'svelte': inject.svelte,
    'import.types': inject.import?.types,
    'import.default': inject.import?.default,
};
for (const [key, expected] of Object.entries(expectedTargets)) {
    if (actualTargets[key] !== expected) {
        fail(`exports["./inject"].${key} = ${actualTargets[key]} (expected ${expected})`);
    }
}

// Every leaf path the map references must exist on disk.
const paths = [];
(function collect(node) {
    if (typeof node === 'string') {
        paths.push(node);
    } else if (node && typeof node === 'object') {
        for (const v of Object.values(node)) {
            collect(v);
        }
    }
})(inject);
for (const p of paths) {
    if (!existsSync(resolve(pkgDir, p))) {
        fail(`exports["./inject"] points at a missing file: ${p}`);
    }
}

// Grep whatever target each entry actually resolves to, not a hardcoded path. Both entries need the
// full set, because importSource decides which one the injected import points at.
const expectedExports = [
    'createFlareErrorHandler',
    'FlareErrorBoundary',
    '__flareRegisterComponent',
    '__flareProfileComponent',
    'withFlareConfig',
    'flarePreprocessor',
];
const root = pkg.exports?.['.'];
const entriesToCheck = {
    '.': root?.import?.default ?? root?.svelte,
    './inject': inject.import?.default ?? inject.svelte,
};

for (const [entryName, runtimeTarget] of Object.entries(entriesToCheck)) {
    const entry = runtimeTarget ? resolve(pkgDir, runtimeTarget) : null;
    if (!entry || !existsSync(entry)) {
        fail(`exports["${entryName}"]: runtime target ${runtimeTarget} does not exist (build first)`);
        continue;
    }
    const src = readFileSync(entry, 'utf8');
    for (const name of expectedExports) {
        if (!new RegExp(`\\b${name}\\b`).test(src)) {
            fail(`exports["${entryName}"] (${runtimeTarget}) is missing export: ${name}`);
        }
    }
}

if (failed) {
    process.exit(1);
}
console.log(
    `[verify-exports] OK — exports["./inject"] targets match (${paths.length} paths) and both the root and inject entries expose the expected surface.`,
);
