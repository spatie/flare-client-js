// scripts/check-pack.mjs
//
// Publish-integrity guard. For each published package it runs `npm pack
// --dry-run` and asserts that every file referenced by the manifest
// (main / module / types / svelte / browser / bin and every leaf of
// `exports`) is actually present in the tarball npm would publish.
//
// This catches the class of bug behind issue #52: @flareapp/core@2.2.0
// shipped without its dist/ folder (no `files` field + dist gitignored ->
// npm fell back to .gitignore and dropped the build output), so its
// `exports` pointed at ./dist/index.mjs which did not exist. Any external
// consumer of @flareapp/js failed to resolve @flareapp/core at bundle time.
//
// Run from the repo root: `node scripts/check-pack.mjs` (all published
// packages) or `node scripts/check-pack.mjs js core` (a subset). Requires
// the packages to be built first; it does not build them.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every published package. flare-api is private and never published, so it
// is intentionally absent.
const PUBLISHED_PACKAGES = [
    'core',
    'js',
    'node',
    'react',
    'vue',
    'svelte',
    'sveltekit',
    'vite',
    'webpack',
    'nextjs',
    'electron',
];

function pkgDir(name) {
    return join(ROOT, 'packages', name);
}

function readPkgJson(name) {
    return JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf-8'));
}

// Normalize a manifest path ("./dist/index.mjs") to how npm pack reports it
// ("dist/index.mjs").
function normalize(path) {
    return path.replace(/^\.\//, '').replace(/^\//, '');
}

// Collect every relative file path the manifest claims to ship. Walks the
// flat entry fields plus the (possibly deeply nested, condition-keyed)
// exports map. Ignores bare package specifiers and wildcards.
function referencedPaths(pkg) {
    const paths = new Set();

    const addIfRelative = (value) => {
        if (typeof value !== 'string') return;
        if (!value.startsWith('.') && !value.startsWith('/')) return; // bare specifier
        if (value.includes('*')) return; // glob subpath pattern, can't check statically
        paths.add(normalize(value));
    };

    for (const field of ['main', 'module', 'types', 'svelte', 'browser']) {
        addIfRelative(pkg[field]);
    }

    if (typeof pkg.bin === 'string') addIfRelative(pkg.bin);
    else if (pkg.bin && typeof pkg.bin === 'object') {
        for (const v of Object.values(pkg.bin)) addIfRelative(v);
    }

    const walkExports = (node) => {
        if (typeof node === 'string') addIfRelative(node);
        else if (node && typeof node === 'object') {
            for (const v of Object.values(node)) walkExports(v);
        }
    };
    walkExports(pkg.exports);

    return paths;
}

// The set of files `npm pack` would include, as reported by its JSON dry-run.
function packedFiles(name) {
    const out = execSync('npm pack --dry-run --json', {
        cwd: pkgDir(name),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    const parsed = JSON.parse(out);
    return new Set(parsed[0].files.map((f) => f.path));
}

export function checkPack(names = PUBLISHED_PACKAGES) {
    const failures = [];

    for (const name of names) {
        const pkg = readPkgJson(name);
        if (pkg.private) continue;

        const referenced = referencedPaths(pkg);
        const packed = packedFiles(name);
        const missing = [...referenced].filter((p) => !packed.has(p));

        if (missing.length > 0) {
            failures.push({ name: pkg.name, missing });
            console.error(`  FAIL ${pkg.name}: manifest references files absent from the tarball:`);
            for (const m of missing) console.error(`         - ${m}`);
        } else {
            console.log(`  ok   ${pkg.name} (${referenced.size} referenced files present)`);
        }
    }

    return failures;
}

// Run directly: `node scripts/check-pack.mjs [pkg ...]`
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const names = args.length > 0 ? args : PUBLISHED_PACKAGES;
    const failures = checkPack(names);
    if (failures.length > 0) {
        console.error(
            `\n  ${failures.length} package(s) would publish a broken tarball. Build first, then fix the \`files\` field or exports.\n`,
        );
        process.exit(1);
    }
    console.log(`\n  All ${names.length} package(s) ship every file their manifest references.\n`);
}
