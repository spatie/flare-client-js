import { compile, preprocess } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';

import { withFlareConfig } from '../src/config.js';
import { flarePreprocessor } from '../src/preprocessor.js';

const FAKE_FILE = '/app/src/Button.svelte';
const SCRIPT_ATTRS = { lang: undefined };

// Run the script hook (component with <script>).
function runScriptHook(pp: ReturnType<typeof flarePreprocessor>, filename = FAKE_FILE) {
    const result = (pp as any).script({ content: 'console.log("hi");', filename, attributes: SCRIPT_ATTRS });
    return result;
}

// Run the markup hook (no <script> tag, scriptless component).
function runMarkupHook(pp: ReturnType<typeof flarePreprocessor>, filename = FAKE_FILE) {
    const result = (pp as any).markup({ content: '<p>hello</p>', filename });
    return result;
}

describe('flarePreprocessor — importSource option', () => {
    describe('script branch (component with <script>)', () => {
        test('defaults to importing from @flareapp/svelte (web)', () => {
            const pp = flarePreprocessor();
            const out = runScriptHook(pp);
            expect(out.code).toContain("from '@flareapp/svelte'");
            expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
        });

        test('emits the inject specifier when importSource is @flareapp/svelte/inject', () => {
            const pp = flarePreprocessor({ importSource: '@flareapp/svelte/inject' });
            const out = runScriptHook(pp);
            expect(out.code).toContain("from '@flareapp/svelte/inject'");
            expect(out.code).not.toContain("from '@flareapp/svelte'");
        });
    });

    describe('markup branch (scriptless component)', () => {
        test('defaults to importing from @flareapp/svelte (web)', () => {
            const pp = flarePreprocessor();
            const out = runMarkupHook(pp);
            expect(out.code).toContain("from '@flareapp/svelte'");
            expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
        });

        test('emits the inject specifier when importSource is @flareapp/svelte/inject', () => {
            const pp = flarePreprocessor({ importSource: '@flareapp/svelte/inject' });
            const out = runMarkupHook(pp);
            expect(out.code).toContain("from '@flareapp/svelte/inject'");
            expect(out.code).not.toContain("from '@flareapp/svelte'");
        });
    });
});

describe('withFlareConfig — importSource option', () => {
    test('threads importSource through to the preprocessor (script branch)', () => {
        const cfg = withFlareConfig({}, { importSource: '@flareapp/svelte/inject' });
        const preprocessors = Array.isArray(cfg.preprocess) ? cfg.preprocess : [cfg.preprocess!];
        const pp = preprocessors[0];
        const out = (pp as any).script({ content: 'let x = 1;', filename: FAKE_FILE, attributes: SCRIPT_ATTRS });
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
    });

    test('threads importSource through to the preprocessor (markup branch)', () => {
        const cfg = withFlareConfig({}, { importSource: '@flareapp/svelte/inject' });
        const preprocessors = Array.isArray(cfg.preprocess) ? cfg.preprocess : [cfg.preprocess!];
        const pp = preprocessors[0];
        const out = (pp as any).markup({ content: '<p>hello</p>', filename: FAKE_FILE });
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
    });

    test('default (no importSource) still emits @flareapp/svelte', () => {
        const cfg = withFlareConfig({});
        const preprocessors = Array.isArray(cfg.preprocess) ? cfg.preprocess : [cfg.preprocess!];
        const pp = preprocessors[0];
        const out = (pp as any).script({ content: 'let x = 1;', filename: FAKE_FILE, attributes: SCRIPT_ATTRS });
        expect(out.code).toContain("from '@flareapp/svelte'");
        expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
    });
});

// Run through Svelte's real pipeline (markup -> script in one pass), not the hooks in isolation.
// Only this catches the markup hook injecting a <script> that the script hook then re-processes
// (double injection -> duplicate `__flare_node__` -> compile error).
describe('flarePreprocessor — full preprocess() + compile() pipeline', () => {
    test('a scriptless component injects exactly once and compiles', async () => {
        const out = await preprocess('<p>hello</p>', flarePreprocessor(), { filename: FAKE_FILE });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        // Must compile: a duplicate `const __flare_node__` throws "already been declared".
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    test('a component WITH a <script> injects exactly once and compiles', async () => {
        const out = await preprocess('<script>let x = 1;</script>\n<p>{x}</p>', flarePreprocessor(), {
            filename: FAKE_FILE,
        });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    test('scriptless component honors importSource end-to-end', async () => {
        const out = await preprocess('<p>hello</p>', flarePreprocessor({ importSource: '@flareapp/svelte/inject' }), {
            filename: FAKE_FILE,
        });
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
    });

    test('a component with ONLY a module script gets exactly one instance registration (B-svelte-2)', async () => {
        const source = `<script module>\nexport const shared = 1;\n</script>\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    test('a component with ONLY a legacy context="module" script gets exactly one registration (B-svelte-2)', async () => {
        const source = `<script context="module">\nexport const shared = 1;\n</script>\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
    });

    test('a component with BOTH module and instance scripts registers exactly once (B-svelte-2)', async () => {
        const source = `<script module>\nexport const shared = 1;\n</script>\n<script>let y = 2;</script>\n<p>{y}</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });
});

// A component filename whose basename contains a single quote or backslash is legal on
// macOS/Linux and must not break the emitted JS by prematurely closing the string literal.
describe('flarePreprocessor — component name escaping (B-svelte-1)', () => {
    const APOSTROPHE_FILE = "/app/src/Product's.svelte";

    test('escapes a single quote in the component name (markup hook)', () => {
        const pp = flarePreprocessor();
        const out = (pp as any).markup({ content: '<p>hi</p>', filename: APOSTROPHE_FILE });
        expect(out.code).toContain("__flare_reg__('Product\\'s'");
        // The unescaped form would close the string literal early and inject stray JS.
        expect(out.code).not.toContain("__flare_reg__('Product's'");
    });

    test('escapes a single quote in the component name (script hook)', () => {
        const pp = flarePreprocessor();
        const out = (pp as any).script({
            content: 'let x = 1;',
            filename: APOSTROPHE_FILE,
            attributes: SCRIPT_ATTRS,
        });
        expect(out.code).toContain("__flare_reg__('Product\\'s'");
        expect(out.code).not.toContain("__flare_reg__('Product's'");
    });

    test('an apostrophe filename still compiles end-to-end', async () => {
        const out = await preprocess('<p>hi</p>', flarePreprocessor(), { filename: APOSTROPHE_FILE });
        expect(() => compile(out.code, { filename: APOSTROPHE_FILE })).not.toThrow();
    });
});

// Prepending lines without a map offsets every subsequent line in stack traces and the debugger.
describe('flarePreprocessor — sourcemap (B-svelte-3)', () => {
    test('the markup hook returns a sourcemap', () => {
        const pp = flarePreprocessor();
        const out = (pp as any).markup({ content: '<p>hi</p>', filename: FAKE_FILE });
        expect(out.map).toBeTruthy();
        expect(out.map.mappings).toBeTypeOf('string');
        expect(out.map.sources).toContain(FAKE_FILE);
    });

    test('the script hook returns a sourcemap', () => {
        const pp = flarePreprocessor();
        const out = (pp as any).script({ content: 'let x = 1;', filename: FAKE_FILE, attributes: SCRIPT_ATTRS });
        expect(out.map).toBeTruthy();
        expect(out.map.mappings).toBeTypeOf('string');
        expect(out.map.sources).toContain(FAKE_FILE);
    });
});

const ROUTE_FILE = '/app/src/routes/product/[id]/+page.svelte';

describe('flarePreprocessor — profile injection', () => {
    test('injects nothing extra when profileComponents is absent', () => {
        const out = runScriptHook(flarePreprocessor());

        expect(out.code).toContain('__flare_reg__');
        expect(out.code).not.toContain('__flare_prof__');
    });

    test('injects both calls for a matched file when tracking is on', () => {
        const pp = flarePreprocessor({ profileComponents: [/\+page$/] });
        const out = (pp as any).script({ content: 'let x = 1;', filename: ROUTE_FILE, attributes: SCRIPT_ATTRS });

        expect(out.code).toContain('__flareRegisterComponent as __flare_reg__');
        expect(out.code).toContain('__flareProfileComponent as __flare_prof__');
        expect(out.code).toContain("__flare_prof__('product/[id]/+page');");
    });

    test('injects only the profile call when tracking is off', () => {
        const pp = flarePreprocessor({ componentTracking: false, profileComponents: [/\+page$/] });
        const out = (pp as any).script({ content: 'let x = 1;', filename: ROUTE_FILE, attributes: SCRIPT_ATTRS });

        expect(out.code).toContain('__flare_prof__');
        expect(out.code).not.toContain('__flare_reg__');
    });

    test('injects nothing for an unmatched file when tracking is off', () => {
        const pp = flarePreprocessor({ componentTracking: false, profileComponents: ['SomethingElse'] });
        const out = (pp as any).script({ content: 'let x = 1;', filename: ROUTE_FILE, attributes: SCRIPT_ATTRS });

        expect(out).toBeUndefined();
    });

    test('matches on the route-aware name, not the basename', () => {
        const pp = flarePreprocessor({ profileComponents: ['product/[id]/+page'] });
        const out = (pp as any).script({ content: 'let x = 1;', filename: ROUTE_FILE, attributes: SCRIPT_ATTRS });

        expect(out.code).toContain('__flare_prof__');
    });

    test('honors a custom routesDir', () => {
        const pp = flarePreprocessor({ profileComponents: [/\+page$/], routesDir: 'source/pages' });
        const out = (pp as any).script({
            content: 'let x = 1;',
            filename: '/app/source/pages/cart/+page.svelte',
            attributes: SCRIPT_ATTRS,
        });

        expect(out.code).toContain("__flare_prof__('cart/+page');");
    });

    // `exclude` is a global kill switch, not a component-tree-only one. A file the user explicitly
    // excluded must not emit spans either.
    test('exclude suppresses the profile call as well as the registration', () => {
        const pp = flarePreprocessor({ profileComponents: true, exclude: /routes/ });
        const out = (pp as any).script({ content: 'let x = 1;', filename: ROUTE_FILE, attributes: SCRIPT_ATTRS });

        expect(out).toBeUndefined();
    });

    // The profile symbol must exist on whichever entry importSource names. src/inject.ts exports it for
    // exactly this case; without that export the injected call resolves to undefined and throws at init.
    test('emits the profile import from the inject entry when importSource is the inject entry', () => {
        const pp = flarePreprocessor({ importSource: '@flareapp/svelte/inject', profileComponents: true });
        const out = (pp as any).script({ content: 'let x = 1;', filename: ROUTE_FILE, attributes: SCRIPT_ATTRS });

        expect(out.code).toContain('__flareProfileComponent as __flare_prof__');
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
    });

    test('escapes a single quote in the profile name', () => {
        const pp = flarePreprocessor({ profileComponents: true });
        const out = (pp as any).script({
            content: 'let x = 1;',
            filename: "/app/src/lib/Product's.svelte",
            attributes: SCRIPT_ATTRS,
        });

        expect(out.code).toContain("__flare_prof__('Product\\'s');");
    });
});

describe('flarePreprocessor — profile injection through the full pipeline', () => {
    test('a scriptless matched component injects each call exactly once and compiles', async () => {
        const out = await preprocess('<p>hello</p>', flarePreprocessor({ profileComponents: true }), {
            filename: ROUTE_FILE,
        });

        expect((out.code.match(/__flare_prof__\(/g) || []).length).toBe(1);
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: ROUTE_FILE })).not.toThrow();
    });

    // Without widening the double-injection guard, the markup hook injects a <script> that the script
    // hook then re-processes, producing two __flare_prof__ calls.
    test('a scriptless profile-only component injects exactly once and compiles', async () => {
        const out = await preprocess(
            '<p>hello</p>',
            flarePreprocessor({ componentTracking: false, profileComponents: true }),
            { filename: ROUTE_FILE },
        );

        expect((out.code.match(/__flare_prof__\(/g) || []).length).toBe(1);
        expect(out.code).not.toContain('__flare_node__');
        expect(() => compile(out.code, { filename: ROUTE_FILE })).not.toThrow();
    });

    test('a module-only matched component still gets one profile call', async () => {
        const source = `<script module>\nexport const shared = 1;\n</script>\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor({ profileComponents: true }), { filename: ROUTE_FILE });

        expect((out.code.match(/__flare_prof__\(/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: ROUTE_FILE })).not.toThrow();
    });
});

describe('withFlareConfig — profileComponents', () => {
    function scriptOutOf(cfg: ReturnType<typeof withFlareConfig>, filename: string) {
        const preprocessors = Array.isArray(cfg.preprocess) ? cfg.preprocess : [cfg.preprocess!];
        return (preprocessors[0] as any).script({ content: 'let x = 1;', filename, attributes: SCRIPT_ATTRS });
    }

    test('returns the config untouched only when BOTH features are off', () => {
        const cfg = { kit: {} };

        expect(withFlareConfig(cfg, { componentTracking: false })).toBe(cfg);
        expect(withFlareConfig(cfg, { componentTracking: false, profileComponents: false })).toBe(cfg);
        expect(withFlareConfig(cfg, { componentTracking: false, profileComponents: [] })).toBe(cfg);
    });

    // The install decision and the per-file match decision are separate. Tracking off with a non-empty
    // allowlist still installs the preprocessor.
    test('installs the preprocessor when only profiling is on', () => {
        const input = {};
        const cfg = withFlareConfig(input, { componentTracking: false, profileComponents: ['Foo'] });

        // A new object, not the early-return path that hands the input straight back.
        expect(cfg).not.toBe(input);
        expect(Array.isArray(cfg.preprocess) && cfg.preprocess).toHaveLength(1);
    });

    test('threads profileComponents through to the preprocessor', () => {
        const cfg = withFlareConfig({}, { profileComponents: [/\+page$/] });
        const out = scriptOutOf(cfg, '/app/src/routes/cart/+page.svelte');

        expect(out.code).toContain("__flare_prof__('cart/+page');");
    });

    test('reads routesDir from kit.files.routes', () => {
        const cfg = withFlareConfig({ kit: { files: { routes: 'source/pages' } } }, { profileComponents: true });
        const out = scriptOutOf(cfg, '/app/source/pages/cart/+page.svelte');

        expect(out.code).toContain("__flare_prof__('cart/+page');");
    });

    test('defaults to src/routes when kit.files.routes is absent', () => {
        const cfg = withFlareConfig({}, { profileComponents: true });
        const out = scriptOutOf(cfg, '/app/src/routes/cart/+page.svelte');

        expect(out.code).toContain("__flare_prof__('cart/+page');");
    });

    test('does not profile anything by default', () => {
        const cfg = withFlareConfig({});
        const out = scriptOutOf(cfg, '/app/src/routes/cart/+page.svelte');

        expect(out.code).not.toContain('__flare_prof__');
    });
});
