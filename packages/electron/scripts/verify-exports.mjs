import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function assertExt(p, ext, label) {
    assert.ok(p.endsWith(ext), `${label} resolved to ${p}, expected *${ext}`);
}

// Declaration files must exist for every entry (export maps point at them)
const electronDist = resolve(here, '../dist');
const jsDist = resolve(here, '../../js/dist');
for (const entry of ['main', 'preload', 'renderer']) {
    for (const ext of ['.d.cts', '.d.mts']) {
        const f = resolve(electronDist, `${entry}${ext}`);
        assert.ok(existsSync(f), `missing declaration ${entry}${ext}`);
    }
}
for (const ext of ['.d.cts', '.d.mts']) {
    const f = resolve(jsDist, `browser${ext}`);
    assert.ok(existsSync(f), `missing declaration @flareapp/js browser${ext}`);
}

// main + preload: map RESOLUTION ONLY in both conditions (executing imports electron, which throws in plain Node)
for (const sub of ['main', 'preload']) {
    const cjs = require.resolve(`@flareapp/electron/${sub}`);
    assertExt(cjs, '.cjs', `require.resolve @flareapp/electron/${sub}`);
    const esm = import.meta.resolve(`@flareapp/electron/${sub}`);
    assertExt(esm, '.mjs', `import.meta.resolve @flareapp/electron/${sub}`);
}

// renderer CJS: resolution only.
// NOTE: renderer.cjs contains a spurious `require('./main.cjs')` emitted by tsdown as a shared
// chunk reference, even though no exported symbol from main is consumed by renderer. That dead
// require pulls in the electron package, which throws in plain Node. The ESM output (renderer.mjs)
// does not have this issue; it imports only env and constants chunks. This is a known tsdown
// bundling artifact; the renderer source itself has zero electron imports.
assertExt(require.resolve('@flareapp/electron/renderer'), '.cjs', 'require.resolve renderer');
const rendererEsmUrl = import.meta.resolve('@flareapp/electron/renderer');
assertExt(rendererEsmUrl, '.mjs', 'import.meta.resolve renderer');

// renderer ESM: execute to confirm RendererFlare is exported (safe - renderer.mjs omits main.mjs)
const rendererEsm = await import('@flareapp/electron/renderer');
assert.equal(typeof rendererEsm.RendererFlare, 'function', 'ESM renderer RendererFlare');

// @flareapp/js/browser: resolve + EXECUTE in both module systems
assertExt(require.resolve('@flareapp/js/browser'), '.cjs', 'require.resolve js/browser');
const browserCjs = require('@flareapp/js/browser');
assert.equal(typeof browserCjs.Flare, 'function', 'CJS js/browser Flare');
const browserEsm = await import('@flareapp/js/browser');
assert.equal(typeof browserEsm.Flare, 'function', 'ESM js/browser Flare');
assert.equal(typeof browserEsm.catchWindowErrors, 'function', 'ESM js/browser catchWindowErrors');

console.log('export maps ok');
