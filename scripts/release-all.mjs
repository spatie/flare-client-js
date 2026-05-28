// scripts/release-all.mjs
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PUBLIC_PACKAGES = ['js', 'react', 'vue', 'svelte', 'sveltekit', 'webpack', 'vite', 'nextjs'];

const PUBLISH_ORDER = [
    ['js'],
    ['react', 'vue', 'svelte', 'webpack', 'vite'],
    ['sveltekit', 'nextjs'],
];

const CROSS_PACKAGE_REFS = [
    { pkg: 'react', field: 'peerDependencies', dep: '@flareapp/js' },
    { pkg: 'vue', field: 'peerDependencies', dep: '@flareapp/js' },
    { pkg: 'svelte', field: 'peerDependencies', dep: '@flareapp/js' },
    { pkg: 'sveltekit', field: 'peerDependencies', dep: '@flareapp/js' },
    { pkg: 'sveltekit', field: 'dependencies', dep: '@flareapp/svelte' },
    { pkg: 'nextjs', field: 'dependencies', dep: '@flareapp/webpack' },
];

function run(cmd, opts = {}) {
    const result = execSync(cmd, { encoding: 'utf-8', stdio: opts.stdio ?? 'pipe', cwd: opts.cwd ?? ROOT });
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

function bumpVersion(current, type) {
    const [major, minor, patch] = current.split('.').map(Number);
    switch (type) {
        case 'major': return `${major + 1}.0.0`;
        case 'minor': return `${major}.${minor + 1}.0`;
        case 'patch': return `${major}.${minor}.${patch + 1}`;
        default: return type;
    }
}

function isValidSemver(v) {
    return /^\d+\.\d+\.\d+$/.test(v);
}

async function promptVersion() {
    console.log('\n--- Version ---\n');

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
        case '1': newVersion = patch; break;
        case '2': newVersion = minor; break;
        case '3': newVersion = major; break;
        case '4':
            newVersion = await ask('  Enter version (e.g. 3.0.0): ');
            if (!isValidSemver(newVersion)) fail(`Invalid semver: ${newVersion}`);
            break;
        default:
            fail(`Invalid choice: ${choice}`);
    }

    const confirm = await ask(`\n  Release v${newVersion}? [y/N]: `);
    if (confirm.toLowerCase() !== 'y') {
        console.log('  Aborted.');
        process.exit(0);
    }

    return { currentVersion, newVersion };
}

function bumpPackages(newVersion) {
    console.log('\n--- Bumping versions via release-it ---\n');

    for (const name of PUBLIC_PACKAGES) {
        info(`Bumping @flareapp/${name} to ${newVersion}...`);
        const cmd = [
            'npx release-it', newVersion,
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
        } catch (e) {
            fail(
                `release-it failed for @flareapp/${name}. ` +
                `To undo partial bumps and staged version.ts hooks, run: git reset --hard HEAD`,
            );
        }
    }

    info('All packages bumped');
}

function updateCrossReferences(newVersion) {
    console.log('\n--- Updating cross-package references ---\n');

    for (const { pkg, field, dep } of CROSS_PACKAGE_REFS) {
        const pkgJson = readPkgJson(pkg);
        if (pkgJson[field] && pkgJson[field][dep]) {
            const oldRange = pkgJson[field][dep];
            const newRange = `^${newVersion}`;
            pkgJson[field][dep] = newRange;
            writePkgJson(pkg, pkgJson);
            info(`@flareapp/${pkg} ${field}.${dep}: ${oldRange} -> ${newRange}`);
        }
    }

    info('Cross-package references updated');
}

function commitAndTag(newVersion) {
    console.log('\n--- Committing and tagging ---\n');

    const filesToStage = [
        ...PUBLIC_PACKAGES.map((name) => `packages/${name}/package.json`),
        'packages/svelte/src/version.ts',
        'packages/sveltekit/src/version.ts',
    ];

    const addResult = spawnSync('git', ['add', '--', ...filesToStage], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (addResult.status !== 0) {
        fail(`git add failed: ${addResult.stderr || addResult.status}`);
    }

    const commitMsg = `chore: release v${newVersion}`;
    const commitResult = spawnSync('git', ['commit', '-m', commitMsg], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (commitResult.status !== 0) {
        fail(`git commit failed: ${commitResult.stderr || commitResult.status}`);
    }
    info(`Committed: ${commitMsg}`);

    for (const name of PUBLIC_PACKAGES) {
        const tag = `@flareapp/${name}@${newVersion}`;
        run(`git tag -a "${tag}" -m "${tag}"`);
        info(`Tagged: ${tag}`);
    }
}

async function dryRunGate(currentVersion, newVersion) {
    console.log('\n--- Summary ---\n');
    console.log(`  Version: ${currentVersion} -> ${newVersion}`);
    console.log('');
    console.log('  Tags:');
    for (const name of PUBLIC_PACKAGES) {
        console.log(`    @flareapp/${name}@${newVersion}`);
    }
    console.log('');
    console.log('  Publish order:');
    for (const tier of PUBLISH_ORDER) {
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
        info(
            'To undo: git reset --hard HEAD~1 && git tag -d ' +
                PUBLIC_PACKAGES.map((n) => `@flareapp/${n}@${newVersion}`).join(' '),
        );
        process.exit(0);
    }
}

function publishPackages() {
    console.log('\n--- Publishing ---\n');

    const published = [];
    const failed = [];

    for (const tier of PUBLISH_ORDER) {
        for (const name of tier) {
            info(`Publishing @flareapp/${name}...`);
            try {
                run(`npm publish --workspace=@flareapp/${name}`, { stdio: 'inherit' });
                published.push(name);
            } catch {
                failed.push(name);
                console.error('');
                console.error(`  PUBLISH FAILED for @flareapp/${name}`);
                console.error(`  Published so far: ${published.map((n) => `@flareapp/${n}`).join(', ') || 'none'}`);

                const remaining = [];
                let foundFailed = false;
                for (const t of PUBLISH_ORDER) {
                    for (const n of t) {
                        if (n === name) foundFailed = true;
                        if (foundFailed && n !== name) remaining.push(n);
                    }
                }
                if (remaining.length) {
                    console.error(`  Remaining: ${remaining.map((n) => `@flareapp/${n}`).join(', ')}`);
                }
                fail('Fix the issue and publish remaining packages manually.');
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
    const result = spawnSync(
        'gh',
        ['release', 'create', tag, '--title', tag, '--notes-file', notesPath, '--target', 'main'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.status !== 0) {
        throw new Error(result.stderr || `gh exited with status ${result.status}`);
    }
}

function createGitHubReleases(newVersion, ghAvailable) {
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
        for (const name of PUBLIC_PACKAGES) {
            const tag = `@flareapp/${name}@${newVersion}`;

            let prevTag;
            try {
                prevTag = run(`git describe --tags --match="@flareapp/${name}@*" --abbrev=0 ${tag}^`);
            } catch {
                prevTag = null;
            }

            let notes = `@flareapp/${name} v${newVersion}`;

            if (prevTag) {
                const logResult = spawnSync(
                    'git',
                    ['log', '--pretty=format:%s (%h)', `${prevTag}...${tag}`],
                    { encoding: 'utf-8' },
                );
                const commits = logResult.status === 0 ? logResult.stdout.trim() : '';

                if (claudeAvailable && commits) {
                    try {
                        notes = generateNotesWithClaude(name, newVersion, commits);
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
    } finally {
        rmSync(notesDir, { recursive: true, force: true });
    }
}

async function preflight() {
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

    info('Building packages...');
    for (const name of PUBLIC_PACKAGES) {
        run(`npm run build --workspace=@flareapp/${name}`, { stdio: 'inherit' });
    }
    run('npm run build --workspace=@flareapp/flare-api', { stdio: 'inherit' });
    info('Build passed');

    info('Running tests...');
    for (const name of PUBLIC_PACKAGES) {
        run(`npm run test --workspace=@flareapp/${name} --if-present`, { stdio: 'inherit' });
    }
    info('Tests passed');

    info('Running type-check...');
    for (const name of PUBLIC_PACKAGES) {
        run(`npm run typescript --workspace=@flareapp/${name} --if-present`, { stdio: 'inherit' });
    }
    info('Type-check passed');

    return { ghAvailable };
}

async function main() {
    const { ghAvailable } = await preflight();
    const { currentVersion, newVersion } = await promptVersion();
    bumpPackages(newVersion);
    updateCrossReferences(newVersion);
    commitAndTag(newVersion);
    await dryRunGate(currentVersion, newVersion);
    publishPackages();
    pushToOrigin();
    createGitHubReleases(newVersion, ghAvailable);

    console.log(`\n  Done! Released v${newVersion}\n`);
}

main();
