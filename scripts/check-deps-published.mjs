// scripts/check-deps-published.mjs
//
// Verifies that every @flareapp/* dependency listed in a package's
// package.json is already published on npm at the required version.
//
// Usage (from a package directory or with an explicit path):
//   node ../../scripts/check-deps-published.mjs [package-path]
//
// Flags:
//   --skip-dep-check          Skip the check entirely (also honoured via SKIP_DEP_CHECK=1).
//   --exclude=<dep1>,<dep2>   Comma-separated full dep names to skip (e.g. --exclude=@flareapp/js).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SKIP_DEP_CHECK = process.argv.includes('--skip-dep-check') || process.env.SKIP_DEP_CHECK === '1';

const excludeArg = process.argv.find((a) => a.startsWith('--exclude='));
const EXCLUDE = new Set(excludeArg ? excludeArg.slice('--exclude='.length).split(',').filter(Boolean) : []);

function fail(msg) {
    console.error(`\n  ERROR: ${msg}\n`);
    process.exit(1);
}

function warn(msg) {
    console.warn(`  WARN: ${msg}`);
}

function info(msg) {
    console.log(`  ${msg}`);
}

function isDepPublishedOnNpm(dep, version) {
    try {
        const result = execFileSync('npm', ['view', `${dep}@${version}`, 'version'], {
            encoding: 'utf-8',
            stdio: 'pipe',
        });
        return result.trim() === version;
    } catch {
        return false;
    }
}

function main() {
    if (SKIP_DEP_CHECK) {
        warn('--skip-dep-check / SKIP_DEP_CHECK=1: skipping dependency publication check.');
        return;
    }

    // Accept an explicit package path as the first non-flag argument, or fall
    // back to the current working directory (standard when invoked from a
    // release-it hook inside a package directory).
    const pkgPath = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? process.cwd();

    const pkgJsonPath = join(resolve(pkgPath), 'package.json');

    let pkgJson;
    try {
        pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    } catch {
        fail(`Cannot read ${pkgJsonPath}`);
    }

    const deps = pkgJson.dependencies ?? {};
    const flareAppDeps = Object.entries(deps).filter(([dep]) => dep.startsWith('@flareapp/') && !EXCLUDE.has(dep));

    if (flareAppDeps.length === 0) {
        // Nothing to check — not an error, just a no-op.
        return;
    }

    for (const [dep, range] of flareAppDeps) {
        // Strip leading ^ or ~ to get the pinned version.
        const pinnedVersion = String(range).replace(/^[\^~]/, '');
        if (!isDepPublishedOnNpm(dep, pinnedVersion)) {
            fail(
                `${pkgJson.name} depends on ${dep}@${pinnedVersion} but that version is not published on npm.\n` +
                    `  Publish ${dep} first, then re-run the release.\n` +
                    `  To bypass this check (offline / private registry), pass --skip-dep-check or set SKIP_DEP_CHECK=1.`,
            );
        }
        info(`${dep}@${pinnedVersion} is published on npm`);
    }
}

main();
