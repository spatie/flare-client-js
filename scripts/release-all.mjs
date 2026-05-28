// scripts/release-all.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
    return execSync(cmd, { encoding: 'utf-8', stdio: opts.stdio ?? 'pipe', cwd: opts.cwd ?? ROOT }).trim();
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

    info('Running build...');
    run('npm run build', { stdio: 'inherit' });
    info('Build passed');

    info('Running tests...');
    run('npm run test', { stdio: 'inherit' });
    info('Tests passed');

    info('Running type-check...');
    run('npm run typescript', { stdio: 'inherit' });
    info('Type-check passed');

    return { ghAvailable };
}

async function main() {
    const { ghAvailable } = await preflight();
    console.log('\nPre-flight passed. ghAvailable:', ghAvailable);
}

main();
