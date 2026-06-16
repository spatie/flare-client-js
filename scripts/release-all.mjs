// scripts/release-all.mjs
//
// Note: @flareapp/flare-api is a private workspace package, bundled into
// @flareapp/vite and @flareapp/webpack via tsdown's --noExternal flag.
// It is not published and not version-bumped here. Changes to flare-api
// ship only when vite or webpack are re-released (their prepublishOnly
// rebuilds and inlines the latest flare-api source).
//
// Versioning model:
//   - The "lockstep" packages (js + framework integrations + bundler plugins)
//     all release at a SINGLE shared version, anchored on @flareapp/js.
//   - @flareapp/core and @flareapp/node version INDEPENDENTLY. Each run asks
//     whether to (re)release them and at which version, so a plain lockstep
//     release does not drag them along. core must publish before js/node,
//     which carry an exact pin on it.
//   - @flareapp/electron also versions INDEPENDENTLY. It hard-pins both
//     @flareapp/core (exact) and @flareapp/js (exact), so it must publish
//     AFTER both core (tier 0) and js (tier 1) are visible on npm.
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import ora from 'ora';

import { checkPack } from './check-pack.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DEP_CHECK = process.argv.includes('--skip-dep-check') || process.env.SKIP_DEP_CHECK === '1';

// How long to wait for a freshly published version to become visible on npm
// before giving up, and how often to re-check. npm's registry can lag a minute
// or two between `npm publish` returning and the version resolving on installs.
const NPM_POLL_INTERVAL_MS = Number(process.env.NPM_POLL_INTERVAL_MS ?? 30_000);
const NPM_POLL_TIMEOUT_MS = Number(process.env.NPM_POLL_TIMEOUT_MS ?? 10 * 60_000);

// The lockstep set: one shared version anchored on @flareapp/js.
const LOCKSTEP_PACKAGES = ['js', 'react', 'vue', 'svelte', 'webpack', 'vite', 'sveltekit', 'nextjs'];

// Independently versioned packages, prompted separately each run.
const INDEPENDENT_PACKAGES = ['core', 'node', 'electron'];

// Publish tiers, ordered by dependency. A package may only publish once every
// package it hard-depends on has been published AND has become visible on npm.
//   core      <- js, node hard-pin it
//   js        <- framework integrations peer-depend on it
//   svelte    <- sveltekit depends on it
//   webpack   <- nextjs depends on it
// Packages skipped this run are filtered out of these tiers before publishing.
const PUBLISH_ORDER = [
    ['core'],
    ['js', 'node'],
    ['react', 'vue', 'svelte', 'webpack', 'vite', 'electron'],
    ['sveltekit', 'nextjs'],
];

// Cross-package references rewritten on each release.
//   - Lockstep refs become `^<lockstepVersion>`.
//   - core refs become the EXACT core version, but only when core is part of
//     this run and the referring package is too.
const LOCKSTEP_REFS = [
    { pkg: 'react', field: 'peerDependencies', dep: '@flareapp/js' },
    { pkg: 'vue', field: 'peerDependencies', dep: '@flareapp/js' },
    { pkg: 'svelte', field: 'peerDependencies', dep: '@flareapp/js' },
    { pkg: 'sveltekit', field: 'peerDependencies', dep: '@flareapp/js' },
    { pkg: 'sveltekit', field: 'dependencies', dep: '@flareapp/svelte' },
    { pkg: 'nextjs', field: 'dependencies', dep: '@flareapp/webpack' },
];

const CORE_REFS = [
    { pkg: 'js', field: 'dependencies', dep: '@flareapp/core' },
    { pkg: 'node', field: 'dependencies', dep: '@flareapp/core' },
    { pkg: 'electron', field: 'dependencies', dep: '@flareapp/core' },
    { pkg: 'react', field: 'dependencies', dep: '@flareapp/core' },
];

// Lockstep deps that are hard-pinned EXACTLY (not caret). electron pins @flareapp/js exactly,
// the same way js/node pin core exactly. Rewritten to the exact lockstep version.
const LOCKSTEP_EXACT_REFS = [
    { pkg: 'electron', field: 'dependencies', dep: '@flareapp/js' },
];

function run(cmd, opts = {}) {
    const stdio = opts.stdio ?? ['ignore', 'pipe', 'inherit'];
    const result = execSync(cmd, { encoding: 'utf-8', stdio, cwd: opts.cwd ?? ROOT });
    return result ? result.trim() : '';
}

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

function pkgDir(name) {
    return join(ROOT, 'packages', name);
}

function readPkgJson(name) {
    return JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf-8'));
}

function writePkgJson(name, data) {
    writeFileSync(join(pkgDir(name), 'package.json'), JSON.stringify(data, null, 4) + '\n');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ask(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function isCommandAvailable(cmd) {
    try {
        run(`which ${cmd}`);
        return true;
    } catch {
        return false;
    }
}

const CHECK_DEPS_SCRIPT = resolvePath(dirname(fileURLToPath(import.meta.url)), 'check-deps-published.mjs');

/**
 * Verify the @flareapp/* deps that lockstep packages rely on are already on
 * npm. Deps being published in THIS run are excluded: they are guaranteed
 * available later by the publish phase, which waits for npm visibility before
 * releasing anything that depends on them. So a package whose every @flareapp
 * dep is part of this run is skipped here entirely.
 */
function checkIndependentDepsPublished(releaseSet) {
    const env = { ...process.env };
    if (SKIP_DEP_CHECK) env.SKIP_DEP_CHECK = '1';

    for (const name of releaseSet) {
        const pkgJson = readPkgJson(name);
        const flareDeps = collectFlareDeps(pkgJson);
        // If every @flareapp dep is also being released now, the publish phase
        // covers availability; nothing to pre-check.
        const externalDeps = flareDeps.filter((dep) => !releaseSet.has(shortName(dep)));
        if (externalDeps.length === 0) continue;

        const exclude = [...releaseSet].map((n) => `@flareapp/${n}`).join(',');
        const result = spawnSync('node', [CHECK_DEPS_SCRIPT, pkgDir(name), `--exclude=${exclude}`], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.status !== 0) {
            process.exit(result.status ?? 1);
        }
    }
}

function collectFlareDeps(pkgJson) {
    const out = [];
    for (const field of ['dependencies', 'peerDependencies']) {
        for (const dep of Object.keys(pkgJson[field] ?? {})) {
            if (dep.startsWith('@flareapp/')) out.push(dep);
        }
    }
    return out;
}

function shortName(scoped) {
    return scoped.replace(/^@flareapp\//, '');
}

function bumpVersion(current, type) {
    const [major, minor, patch] = current.split('.').map(Number);
    switch (type) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
        default:
            return type;
    }
}

function isValidSemver(v) {
    return /^\d+\.\d+\.\d+$/.test(v);
}

async function promptLockstepVersion() {
    console.log('\n--- Lockstep version (js + framework + bundler packages) ---\n');

    const currentVersion = readPkgJson('js').version;
    info(`Current version: ${currentVersion}`);

    const patch = bumpVersion(currentVersion, 'patch');
    const minor = bumpVersion(currentVersion, 'minor');
    const major = bumpVersion(currentVersion, 'major');

    console.log('');
    console.log(`  1) patch  ${currentVersion} -> ${patch}`);
    console.log(`  2) minor  ${currentVersion} -> ${minor}`);
    console.log(`  3) major  ${currentVersion} -> ${major}`);
    console.log(`  4) custom (enter exact version)`);
    console.log('');

    const choice = await ask('  Select [1-4]: ');

    let newVersion;
    switch (choice) {
        case '1':
            newVersion = patch;
            break;
        case '2':
            newVersion = minor;
            break;
        case '3':
            newVersion = major;
            break;
        case '4':
            newVersion = await ask('  Enter version (e.g. 3.0.0): ');
            if (!isValidSemver(newVersion)) fail(`Invalid semver: ${newVersion}`);
            break;
        default:
            fail(`Invalid choice: ${choice}`);
    }

    return { currentVersion, newVersion };
}

/**
 * Prompt for an independently versioned package (core, node). The caller can:
 *   - enter an exact semver to (re)release at that version,
 *   - 'k' to keep the current version (first publish of an unreleased package),
 *   - 's' to skip the package entirely this run.
 * Returns the chosen version, or null when skipped.
 */
async function promptIndependentVersion(name) {
    const current = readPkgJson(name).version;
    console.log(`\n--- @flareapp/${name} (independent) ---\n`);
    info(`Current version: ${current}`);
    const ans = await ask(`  Enter version to release, 'k' to keep ${current}, or 's' to skip @flareapp/${name}: `);
    if (ans === '' || ans.toLowerCase() === 's') return null;
    if (ans.toLowerCase() === 'k') return current;
    if (!isValidSemver(ans)) fail(`Invalid semver for @flareapp/${name}: ${ans}`);
    return ans;
}

/**
 * Resolve the full release plan: which packages publish, at which versions, in
 * which order. Returns { versions, releaseSet, tiers, lockstepVersion }.
 */
async function planRelease() {
    const { newVersion: lockstepVersion } = await promptLockstepVersion();
    const coreVersion = await promptIndependentVersion('core');
    const nodeVersion = await promptIndependentVersion('node');
    const electronVersion = await promptIndependentVersion('electron');

    const versions = {};
    for (const name of LOCKSTEP_PACKAGES) versions[name] = lockstepVersion;
    if (coreVersion) versions['core'] = coreVersion;
    if (nodeVersion) versions['node'] = nodeVersion;
    if (electronVersion) versions['electron'] = electronVersion;

    const releaseSet = new Set(Object.keys(versions));
    const tiers = PUBLISH_ORDER.map((tier) => tier.filter((n) => releaseSet.has(n))).filter((t) => t.length > 0);

    return { versions, releaseSet, tiers, lockstepVersion };
}

async function confirmPlan(plan) {
    console.log('\n--- Release plan ---\n');
    for (const tier of plan.tiers) {
        for (const name of tier) {
            const current = readPkgJson(name).version;
            const target = plan.versions[name];
            const note = target === current ? ' (keep / first publish)' : ` (was ${current})`;
            console.log(`    @flareapp/${name}@${target}${note}`);
        }
    }
    if (plan.releaseSet.has('core')) {
        console.log('');
        info(`@flareapp/core@${plan.versions['core']} will be released first; js/node/electron pins rewritten to it.`);
    }
    if (plan.releaseSet.has('electron')) {
        console.log('');
        info(`@flareapp/electron@${plan.versions['electron']} publishes after core + js; its exact js pin will be rewritten to ${plan.lockstepVersion}.`);
    }
    console.log('');
    const confirm = await ask('  Proceed with this plan? [y/N]: ');
    if (confirm.toLowerCase() !== 'y') {
        console.log('  Aborted.');
        process.exit(0);
    }
}

function bumpPackages(plan) {
    console.log('\n--- Bumping versions via release-it ---\n');

    for (const name of plan.releaseSet) {
        const target = plan.versions[name];
        const current = readPkgJson(name).version;
        if (target === current) {
            info(`@flareapp/${name} already at ${target}; skipping bump (will still tag + publish).`);
            continue;
        }
        info(`Bumping @flareapp/${name} to ${target}...`);
        const cmd = [
            'npx release-it',
            target,
            '--ci',
            '--git.commit=false',
            '--git.tag=false',
            '--git.push=false',
            '--git.requireCleanWorkingDir=false',
            '--git.requireBranch=',
            '--npm.publish=false',
            '--hooks.before:release=',
        ].join(' ');

        try {
            run(cmd, { cwd: pkgDir(name), stdio: 'inherit' });
        } catch {
            fail(
                `release-it failed for @flareapp/${name}. ` +
                    `To undo partial bumps and staged version.ts hooks, run: git reset --hard HEAD`,
            );
        }
    }

    info('All packages bumped');
}

function updateCrossReferences(plan) {
    console.log('\n--- Updating cross-package references ---\n');

    // Lockstep refs -> caret on the lockstep version.
    for (const { pkg, field, dep } of LOCKSTEP_REFS) {
        if (!plan.releaseSet.has(pkg)) continue;
        const pkgJson = readPkgJson(pkg);
        if (pkgJson[field]?.[dep]) {
            const oldRange = pkgJson[field][dep];
            const newRange = `^${plan.lockstepVersion}`;
            pkgJson[field][dep] = newRange;
            writePkgJson(pkg, pkgJson);
            info(`@flareapp/${pkg} ${field}.${dep}: ${oldRange} -> ${newRange}`);
        }
    }

    // Lockstep deps that are pinned exactly (electron -> js).
    for (const { pkg, field, dep } of LOCKSTEP_EXACT_REFS) {
        if (!plan.releaseSet.has(pkg)) continue;
        const pkgJson = readPkgJson(pkg);
        if (pkgJson[field]?.[dep]) {
            const oldRange = pkgJson[field][dep];
            pkgJson[field][dep] = plan.lockstepVersion; // exact pin
            writePkgJson(pkg, pkgJson);
            info(`@flareapp/${pkg} ${field}.${dep}: ${oldRange} -> ${plan.lockstepVersion}`);
        }
    }

    // core refs -> exact core version, but only when core is being released
    // this run and the referring package is too (don't rewrite the pin of a
    // package we are not republishing).
    if (plan.releaseSet.has('core')) {
        const coreVersion = plan.versions['core'];
        for (const { pkg, field, dep } of CORE_REFS) {
            if (!plan.releaseSet.has(pkg)) continue;
            const pkgJson = readPkgJson(pkg);
            if (pkgJson[field]?.[dep]) {
                const oldRange = pkgJson[field][dep];
                pkgJson[field][dep] = coreVersion; // exact pin
                writePkgJson(pkg, pkgJson);
                info(`@flareapp/${pkg} ${field}.${dep}: ${oldRange} -> ${coreVersion}`);
            }
        }
    }

    info('Cross-package references updated');
}

function commitAndTag(plan) {
    console.log('\n--- Committing and tagging ---\n');

    const status = run('git status --porcelain');
    if (!status) {
        fail('No file changes after bump phase. Versions likely match current. Nothing to release.');
    }

    const filesToStage = [...plan.releaseSet].map((name) => `packages/${name}/package.json`);
    // release-it's after:bump hook regenerates these for svelte/sveltekit.
    if (plan.releaseSet.has('svelte')) filesToStage.push('packages/svelte/src/version.ts');
    if (plan.releaseSet.has('sveltekit')) filesToStage.push('packages/sveltekit/src/version.ts');

    const addResult = spawnSync('git', ['add', '--', ...filesToStage], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (addResult.status !== 0) {
        fail(`git add failed: ${addResult.stderr || addResult.status}`);
    }

    const commitMsg = releaseCommitMessage(plan);
    const commitResult = spawnSync('git', ['commit', '-m', commitMsg], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (commitResult.status !== 0) {
        fail(`git commit failed: ${commitResult.stderr || commitResult.status}`);
    }
    info(`Committed: ${commitMsg}`);

    for (const tier of plan.tiers) {
        for (const name of tier) {
            const tag = `@flareapp/${name}@${plan.versions[name]}`;
            run(`git tag -a "${tag}" -m "${tag}"`);
            info(`Tagged: ${tag}`);
        }
    }
}

function releaseCommitMessage(plan) {
    // Lockstep packages share one version; surface that plus any independent
    // versions so the commit reads clearly.
    const parts = [`chore: release v${plan.lockstepVersion}`];
    const independent = INDEPENDENT_PACKAGES.filter((n) => plan.releaseSet.has(n)).map(
        (n) => `@flareapp/${n}@${plan.versions[n]}`,
    );
    if (independent.length) parts.push(`(${independent.join(', ')})`);
    return parts.join(' ');
}

/**
 * Block until `@flareapp/<name>@<version>` resolves on npm, polling every
 * NPM_POLL_INTERVAL_MS up to NPM_POLL_TIMEOUT_MS, with a live spinner. A
 * not-yet-published version makes `npm view` exit non-zero; that is treated as
 * "keep waiting", not an error, until the timeout is hit.
 */
async function waitForNpm(name, version) {
    const full = `@flareapp/${name}@${version}`;
    const spinner = ora(`Waiting for ${full} on npm...`).start();
    const deadline = Date.now() + NPM_POLL_TIMEOUT_MS;

    for (;;) {
        if (isVersionOnNpm(`@flareapp/${name}`, version)) {
            spinner.succeed(`${full} is live on npm`);
            return;
        }
        if (Date.now() >= deadline) {
            spinner.fail(`${full} not visible after ${Math.round(NPM_POLL_TIMEOUT_MS / 1000)}s`);
            fail(
                `Timed out waiting for ${full} to appear on npm. It was published, but the ` +
                    `registry has not made it resolvable yet. Re-run publishing for the remaining ` +
                    `tiers once it appears, or raise NPM_POLL_TIMEOUT_MS.`,
            );
        }
        const secs = Math.round(NPM_POLL_INTERVAL_MS / 1000);
        spinner.text = `Waiting for ${full} on npm... (re-checking every ${secs}s)`;
        await sleep(NPM_POLL_INTERVAL_MS);
    }
}

function isVersionOnNpm(scopedName, version) {
    const result = spawnSync('npm', ['view', `${scopedName}@${version}`, 'version'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.status === 0 && result.stdout.trim() === version;
}

async function dryRunGate(plan) {
    console.log('\n--- Summary ---\n');
    console.log('  Tags:');
    for (const tier of plan.tiers) {
        for (const name of tier) {
            console.log(`    @flareapp/${name}@${plan.versions[name]}`);
        }
    }
    console.log('');
    console.log('  Publish order (waits for npm visibility between tiers):');
    for (const tier of plan.tiers) {
        console.log(`    ${tier.map((n) => `@flareapp/${n}`).join(', ')}`);
    }
    console.log('');

    const changedFiles = run('git diff --name-only HEAD~1');
    console.log('  Files changed:');
    for (const f of changedFiles.split('\n').filter(Boolean)) {
        console.log(`    ${f}`);
    }
    console.log('');

    const answer = await ask('  Publish to npm and push to origin? [y/N]: ');
    if (answer.toLowerCase() !== 'y') {
        console.log('');
        info('Aborted. Commit and tags are local.');
        const tags = plan.tiers.flat().map((n) => `@flareapp/${n}@${plan.versions[n]}`);
        info('To undo: git reset --hard HEAD~1 && git tag -d ' + tags.join(' '));
        process.exit(0);
    }
}

async function publishPackages(plan) {
    console.log('\n--- Publishing ---\n');

    const published = [];

    for (const tier of plan.tiers) {
        for (const name of tier) {
            info(`Publishing @flareapp/${name}@${plan.versions[name]}...`);
            try {
                run(`npm publish --workspace=@flareapp/${name}`, { stdio: 'inherit' });
                published.push(name);
            } catch {
                console.error('');
                console.error(`  PUBLISH FAILED for @flareapp/${name}`);
                console.error(`  Published so far: ${published.map((n) => `@flareapp/${n}`).join(', ') || 'none'}`);

                const remaining = plan.tiers.flat().slice(published.length + 1);
                if (remaining.length) {
                    console.error(`  Remaining: ${remaining.map((n) => `@flareapp/${n}`).join(', ')}`);
                }
                fail('Fix the issue and publish remaining packages manually.');
            }
        }

        // Wait for every package in this tier to become resolvable on npm before
        // publishing the next tier, which may hard-depend on them.
        const isLastTier = tier === plan.tiers[plan.tiers.length - 1];
        if (!isLastTier) {
            for (const name of tier) {
                await waitForNpm(name, plan.versions[name]);
            }
        }
    }

    info(`All ${published.length} packages published`);
}

function pushToOrigin() {
    console.log('\n--- Pushing ---\n');

    try {
        run('git push origin main --follow-tags', { stdio: 'inherit' });
        info('Pushed commit and tags to origin');
    } catch {
        fail('git push failed. Packages are already on npm. Push manually with: git push origin main --follow-tags');
    }
}

function generateNotesWithClaude(pkgName, version, commits) {
    const prompt = [
        `Generate a concise GitHub release changelog for @flareapp/${pkgName} v${version}.`,
        `Commits since last release:`,
        commits,
        `Write 3-5 bullet points summarizing changes. Be specific. No intro text, just bullet points.`,
    ].join('\n');

    const result = spawnSync('claude', ['-p', prompt], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) {
        throw new Error(result.stderr || `claude exited with status ${result.status}`);
    }
    return result.stdout.trim();
}

function ghReleaseCreate(tag, notesPath) {
    const result = spawnSync('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notesPath], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
        throw new Error(result.stderr || `gh exited with status ${result.status}`);
    }
}

function createGitHubReleases(plan, ghAvailable) {
    console.log('\n--- GitHub releases ---\n');

    if (!ghAvailable) {
        warn('gh CLI not authenticated. Skipping GitHub releases.');
        return;
    }

    const claudeAvailable = isCommandAvailable('claude');
    if (!claudeAvailable) {
        warn('claude CLI not found. Releases will have minimal notes.');
    }

    const notesDir = mkdtempSync(join(tmpdir(), 'flare-release-notes-'));

    try {
        for (const tier of plan.tiers) {
            for (const name of tier) {
                const version = plan.versions[name];
                const tag = `@flareapp/${name}@${version}`;

                let prevTag;
                try {
                    prevTag = run(`git describe --tags --match="@flareapp/${name}@*" --abbrev=0 ${tag}^`);
                } catch {
                    prevTag = null;
                }

                let notes = `@flareapp/${name} v${version}`;

                if (prevTag) {
                    const logResult = spawnSync('git', ['log', '--pretty=format:%s (%h)', `${prevTag}...${tag}`], {
                        encoding: 'utf-8',
                    });
                    const commits = logResult.status === 0 ? logResult.stdout.trim() : '';

                    if (claudeAvailable && commits) {
                        try {
                            notes = generateNotesWithClaude(name, version, commits);
                        } catch (e) {
                            warn(`claude failed for @flareapp/${name} (${e.message}). Using minimal notes.`);
                        }
                    }
                }

                const notesPath = join(notesDir, `${name}.md`);
                writeFileSync(notesPath, notes);

                try {
                    ghReleaseCreate(tag, notesPath);
                    info(`Created release: ${tag}`);
                } catch (e) {
                    warn(`Failed to create release for ${tag}: ${e.message}`);
                }
            }
        }
    } finally {
        rmSync(notesDir, { recursive: true, force: true });
    }
}

async function preflight(plan) {
    console.log('\n--- Pre-flight checks ---\n');

    const status = run('git status --porcelain');
    if (status) fail('Working tree is not clean. Commit or stash changes first.');
    info('Working tree clean');

    const branch = run('git rev-parse --abbrev-ref HEAD');
    if (branch !== 'main') fail(`Must be on main branch (currently on ${branch}).`);
    info('On main branch');

    try {
        const npmUser = run('npm whoami');
        info(`npm authenticated as ${npmUser}`);
    } catch {
        fail('npm not authenticated. Run `npm login` first.');
    }

    let ghAvailable = true;
    try {
        run('gh auth status');
        info('gh CLI authenticated');
    } catch {
        warn('gh CLI not authenticated. GitHub releases will be skipped.');
        ghAvailable = false;
    }

    info('Checking that referenced dependencies are published (excluding ones released this run)...');
    checkIndependentDepsPublished(plan.releaseSet);
    info('Dependency check passed');

    info('Building packages...');
    for (const name of plan.releaseSet) {
        run(`npm run build --workspace=@flareapp/${name}`, { stdio: 'inherit' });
    }
    run('npm run build --workspace=@flareapp/flare-api', { stdio: 'inherit' });
    info('Build passed');

    info('Checking tarball integrity (every manifest-referenced file is shipped)...');
    const packFailures = checkPack([...plan.releaseSet]);
    if (packFailures.length > 0) {
        fail(
            'One or more packages would publish a broken tarball (see above). Fix the `files` field or exports before releasing.',
        );
    }
    info('Tarball integrity passed');

    info('Running tests...');
    for (const name of plan.releaseSet) {
        run(`npm run test --workspace=@flareapp/${name} --if-present`, { stdio: 'inherit' });
    }
    info('Tests passed');

    info('Running type-check...');
    for (const name of plan.releaseSet) {
        run(`npm run typescript --workspace=@flareapp/${name} --if-present`, { stdio: 'inherit' });
    }
    info('Type-check passed');

    return { ghAvailable };
}

async function main() {
    // Plan first so preflight knows which packages are in scope.
    const plan = await planRelease();
    await confirmPlan(plan);

    const { ghAvailable } = await preflight(plan);

    bumpPackages(plan);
    updateCrossReferences(plan);
    commitAndTag(plan);
    await dryRunGate(plan);
    await publishPackages(plan);
    pushToOrigin();
    createGitHubReleases(plan, ghAvailable);

    console.log(
        `\n  Done! Released v${plan.lockstepVersion}` +
            (plan.releaseSet.has('core') ? ` + core@${plan.versions['core']}` : '') +
            (plan.releaseSet.has('node') ? ` + node@${plan.versions['node']}` : '') +
            (plan.releaseSet.has('electron') ? ` + electron@${plan.versions['electron']}` : '') +
            '\n',
    );
}

main();
