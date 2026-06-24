#!/usr/bin/env node
// Build + pack @flareapp/core, @flareapp/react, @flareapp/react-native and
// install the tarballs into the chosen smoke app(s), then verify the install
// closure. Run from the repo root: `node scripts/rn-relink.mjs <bare|expo|both>`.
//
// Why tarballs (not workspace symlinks): the smoke test must validate the REAL
// published artifact — exports map, the `react-native` export condition, the
// inlined SDK version — not source. See the design spec.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['core', 'react', 'react-native'];
const APPS = {
    bare: join(repoRoot, 'playgrounds', 'react-native-bare'),
    expo: join(repoRoot, 'playgrounds', 'react-native-expo'),
};

const target = process.argv[2];
if (!['bare', 'expo', 'both'].includes(target || '')) {
    console.error('Usage: node scripts/rn-relink.mjs <bare|expo|both>');
    process.exit(1);
}
const targets = target === 'both' ? ['bare', 'expo'] : [target];

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const capture = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' });

// 1. Build local packages.
for (const p of PACKAGES) {
    console.log(`\n[relink] building @flareapp/${p}`);
    run('npm', ['run', 'build', '-w', `@flareapp/${p}`], repoRoot);
}

// Fingerprint each local build's published `dist/` so verify() can prove the app
// installed THIS build and not a same-version registry copy that leaked in via
// npm dedup. A content hash is deterministic and version-independent — unlike a
// feature-symbol sentinel, it cannot false-pass once the registry ships the same
// version number carrying the same symbol.
const localHashes = {};
for (const p of PACKAGES) {
    localHashes[p] = hashDist(join(repoRoot, 'packages', p, 'dist'));
    if (!localHashes[p]) {
        console.error(`[relink] local @flareapp/${p} has no dist/ — build failed?`);
        process.exit(1);
    }
}

// 2. Pack into a temp dir.
const packDir = mkdtempSync(join(tmpdir(), 'flare-relink-'));
const tarballs = {};
for (const p of PACKAGES) {
    const json = capture('npm', ['pack', '--json', '--pack-destination', packDir], join(repoRoot, 'packages', p));
    const file = JSON.parse(json)[0].filename;
    tarballs[p] = join(packDir, file);
    console.log(`[relink] packed @flareapp/${p} -> ${file}`);
}

for (const t of targets) {
    const appDir = APPS[t];
    if (!existsSync(appDir)) {
        console.error(`[relink] app missing: ${appDir}`);
        process.exit(1);
    }
    console.log(`\n[relink] installing tarballs into ${t}`);
    // --no-save: do NOT write these tarball paths into the app's package.json /
    // package-lock.json. They are temp-dir paths (machine-specific, ephemeral),
    // so saving them would commit a broken, non-reproducible manifest. The local
    // SDK is injected into node_modules only; a later bare `npm install` prunes
    // it, which is why the README says to re-run relink after `npm install`.
    // (expo-device / expo-application are saved deps of the Expo app, added at
    // scaffold time — not here.)
    //
    // --omit=peer: @flareapp/react declares @flareapp/js as a PEER dependency.
    // npm 7+ auto-installs missing peers by default, so a plain install pulls
    // @flareapp/js from the REGISTRY into the app even though nothing imports it
    // (the RN SDK consumes only @flareapp/react/inject, which has no @flareapp/js
    // import). That stray copy then trips verify step 2 below on every clean run.
    // Omitting peer installs keeps the tree to exactly the three local tarballs;
    // react / react-native are already provided by the app template, so their
    // peers stay satisfied without an auto-install. Do not drop this flag.
    run(
        'npm',
        ['install', '--no-save', '--omit=peer', tarballs.core, tarballs.react, tarballs['react-native']],
        appDir,
    );
    verify(t, appDir);
}

rmSync(packDir, { recursive: true, force: true });
console.log('\n[relink] done.');

function verify(name, appDir) {
    const fail = (m) => {
        console.error(`[relink:verify ${name}] FAIL: ${m}`);
        process.exit(1);
    };

    // 1. Every installed @flareapp package must be byte-identical to the local
    //    build, and present exactly once. Catches a same-version registry copy
    //    leaking in via npm dedup — whether it replaced the top-level copy or
    //    nested under another @flareapp package. Deterministic; no reliance on a
    //    feature symbol the registry might one day also ship.
    for (const p of PACKAGES) {
        const copies = findScopedCopies(appDir, p);
        if (copies.length === 0) fail(`@flareapp/${p} not installed`);
        if (copies.length > 1) {
            fail(
                `${copies.length} copies of @flareapp/${p} installed (expected 1) — a registry copy leaked in via dedup. ` +
                    `Delete ${name} node_modules + package-lock.json and re-run.`,
            );
        }
        if (hashDist(join(copies[0], 'dist')) !== localHashes[p]) {
            fail(
                `installed @flareapp/${p} dist differs from the local build — the wrong copy was installed. ` +
                    `Delete ${name} node_modules + package-lock.json and re-run.`,
            );
        }
    }

    // 2. @flareapp/js must be ABSENT. This is a defense-in-depth invariant, NOT
    //    the primary bundle guard — the real guard is Task 6's resolve gate (the
    //    Metro bundle must contain no `@flareapp/js`, since nothing imports it;
    //    physical presence in node_modules is harmless until something requires
    //    it). With `--omit=peer` on the install above, @flareapp/js should never
    //    land here. If it does, the likely cause is that the peer-omit was
    //    dropped and npm auto-installed @flareapp/js as @flareapp/react's peer —
    //    NOT that App code imports @flareapp/react's main entry. Fail loudly
    //    either way so the wrong tree can't pass silently.
    if (existsSync(join(appDir, 'node_modules', '@flareapp', 'js'))) {
        fail(
            "@flareapp/js is present. It is @flareapp/react's peer; npm most likely auto-installed it from the " +
                'registry (confirm the install above passes --omit=peer). Delete the app node_modules + package-lock.json and re-run.',
        );
    }

    // 3. Exactly one react and one react-native.
    for (const mod of ['react', 'react-native']) {
        const copies = countCopies(appDir, mod);
        if (copies === 0) fail(`${mod} not resolved`);
        if (copies > 1) fail(`${copies} copies of ${mod} (expected 1) — duplicate/haste collision risk`);
    }

    console.log(`[relink:verify ${name}] OK`);
}

// Count top-level + any nested-under-@flareapp copies of a module.
function countCopies(appDir, mod) {
    let count = existsSync(join(appDir, 'node_modules', mod, 'package.json')) ? 1 : 0;
    const scoped = join(appDir, 'node_modules', '@flareapp');
    if (existsSync(scoped)) {
        for (const pkg of readdirSync(scoped)) {
            if (existsSync(join(scoped, pkg, 'node_modules', mod, 'package.json'))) count++;
        }
    }
    return count;
}

// All install locations of @flareapp/<pkg> in the app tree: the top-level copy
// plus any copy nested under another @flareapp package (the shape a dedup miss
// takes).
function findScopedCopies(appDir, pkg) {
    const out = [];
    const top = join(appDir, 'node_modules', '@flareapp', pkg);
    if (existsSync(join(top, 'package.json'))) out.push(top);
    const scoped = join(appDir, 'node_modules', '@flareapp');
    if (existsSync(scoped)) {
        for (const parent of readdirSync(scoped)) {
            const nested = join(scoped, parent, 'node_modules', '@flareapp', pkg);
            if (existsSync(join(nested, 'package.json'))) out.push(nested);
        }
    }
    return out;
}

// SHA-256 over a published dist/: every file's relative path + bytes, in sorted
// order. Byte-identical builds hash equal; a registry copy with different bytes
// (even at the same version) does not. Returns null if dist/ is missing.
function hashDist(distDir) {
    if (!existsSync(distDir)) return null;
    const files = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir).toSorted()) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else files.push(full);
        }
    };
    walk(distDir);
    const h = createHash('sha256');
    for (const f of files.toSorted()) {
        h.update(relative(distDir, f).split(sep).join('/'));
        h.update('\0');
        h.update(readFileSync(f));
        h.update('\0');
    }
    return h.digest('hex');
}
