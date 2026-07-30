import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compile, preprocess, type Processed } from 'svelte/compiler';
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

// preprocess() types its map as `string | object`, so narrow it once instead of at every assertion.
type PreprocessedMap = { version: 3; names: string[]; sources: string[]; mappings: string };

function mapOf(processed: Processed): PreprocessedMap {
    return processed.map as unknown as PreprocessedMap;
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

// If the emitted map's source name doesn't match what Svelte looks up, Svelte skips the line offset
// it would otherwise apply, so every line below the prepended content reports the wrong original line.
describe('flarePreprocessor — sourcemap (B-svelte-3)', () => {
    // Markup ABOVE the <script> is what makes this able to fail. Svelte offsets a script hook's map by
    // get_location(tagOpen.length), which is zero lines when the script opens the file.
    const WITH_SCRIPT = ['<p>one</p>', '<p>two</p>', '<script>', 'let marker = 1;', '</script>'].join('\n');
    const SCRIPTLESS = ['<p>one</p>', '<p>two</p>', '<p>marker</p>'].join('\n');

    /** Which original line the preprocessed output claims `needle` came from. */
    function originalLineOf(processed: Processed, needle: string): number | null {
        const lines = processed.code.split('\n');
        const line = lines.findIndex((text) => text.includes(needle)) + 1;
        const tracer = new TraceMap(mapOf(processed));

        return originalPositionFor(tracer, { line, column: lines[line - 1]!.indexOf(needle) }).line;
    }

    test('names the source the way Svelte looks it up', async () => {
        const withScript = await preprocess(WITH_SCRIPT, flarePreprocessor(), { filename: FAKE_FILE });
        const scriptless = await preprocess(SCRIPTLESS, flarePreprocessor(), { filename: FAKE_FILE });

        // get_basename in compiler/utils/mapped_code.js. An absolute path never matches, and on a miss
        // Svelte silently skips the offset that makes the map correct.
        expect(mapOf(withScript).sources).toEqual(['Button.svelte']);
        expect(mapOf(scriptless).sources).toEqual(['Button.svelte']);
    });

    test('a script body line still points at its original line', async () => {
        const out = await preprocess(WITH_SCRIPT, flarePreprocessor(), { filename: FAKE_FILE });

        expect(originalLineOf(out, 'let marker = 1;')).toBe(4);
    });

    test('markup in a scriptless component still points at its original line', async () => {
        const out = await preprocess(SCRIPTLESS, flarePreprocessor(), { filename: FAKE_FILE });

        expect(originalLineOf(out, '<p>marker</p>')).toBe(3);
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

    // `exclude` kills everything, not just the component tree.
    test('exclude suppresses the profile call as well as the registration', () => {
        const pp = flarePreprocessor({ profileComponents: true, exclude: /routes/ });
        const out = (pp as any).script({ content: 'let x = 1;', filename: ROUTE_FILE, attributes: SCRIPT_ATTRS });

        expect(out).toBeUndefined();
    });

    // Whichever entry importSource names has to export the symbol, or the injected call is undefined
    // and throws at init.
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

    // Without the widened guard the script hook reprocesses the block markup just added, giving two
    // __flare_prof__ calls.
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

    // Installing and matching are separate decisions. Tracking off still installs if the allowlist
    // has entries.
    test('installs the preprocessor when only profiling is on (array disjunct)', () => {
        const input = {};
        const cfg = withFlareConfig(input, { componentTracking: false, profileComponents: ['Foo'] });

        // A new object, so we didn't take the early return.
        expect(cfg).not.toBe(input);
        expect(Array.isArray(cfg.preprocess) && cfg.preprocess).toHaveLength(1);
    });

    // Same as above, but via `profileComponents: true` instead of an array.
    test('installs the preprocessor when only profiling is on (profileComponents: true disjunct)', () => {
        const input = {};
        const cfg = withFlareConfig(input, { componentTracking: false, profileComponents: true });

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

// Both cases below used to break because we matched raw text instead of matching what Svelte matches.
describe('flarePreprocessor — script tags that only look like component code', () => {
    test('a <script> mentioned inside an HTML comment does not count as an instance script', async () => {
        // Svelte skips comments, so this component has no instance script at all.
        const source = `<!-- replaced the old <script>console.log(1)</script> block -->\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expect(out.code).toContain('__flare_reg__');
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    test('a commented-out script does not suppress profiling either', async () => {
        const source = `<!-- <script>old()</script> -->\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor({ componentTracking: false, profileComponents: true }), {
            filename: FAKE_FILE,
        });

        expect((out.code.match(/__flare_prof__\(/g) || []).length).toBe(1);
    });

    // Injecting an import here would ship broken JSON-LD to the browser.
    test('leaves a nested non-JavaScript script untouched', async () => {
        const source = [
            '<script lang="ts">',
            '  let x = 1;',
            '</script>',
            '',
            '<div>',
            '  <script type="application/ld+json">',
            '    {"@type": "Product"}',
            '  </script>',
            '</div>',
        ].join('\n');
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(out.code).toMatch(/<script type="application\/ld\+json">\s*\{"@type": "Product"\}/);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    test.each(['text/javascript', 'module'])('still injects into an instance script typed %s', (type) => {
        const pp = flarePreprocessor();
        const out = (pp as any).script({ content: 'let x = 1;', filename: FAKE_FILE, attributes: { type } });

        expect(out.code).toContain('__flare_reg__');
    });

    test.each(['application/ld+json', 'importmap', 'text/template'])('skips a %s script', (type) => {
        const pp = flarePreprocessor();
        const out = (pp as any).script({ content: '{"a":1}', filename: FAKE_FILE, attributes: { type } });

        expect(out).toBeUndefined();
    });
});
