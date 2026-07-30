import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compile, parse, preprocess, type Processed } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';

import { withFlareConfig } from '../src/config.js';
import { flarePreprocessor } from '../src/preprocessor.js';

const FAKE_FILE = '/app/src/Button.svelte';

// The two component shapes. Both go through the markup hook now, so tests drive one entry point.
const WITH_SCRIPT = '<script>\nlet x = 1;\n</script>\n<p>{x}</p>';
const SCRIPTLESS = '<p>hello</p>';

function runMarkup(pp: ReturnType<typeof flarePreprocessor>, content = SCRIPTLESS, filename = FAKE_FILE) {
    return (pp as any).markup({ content, filename });
}

/** The group withFlareConfig installs, which it always puts first. */
function flareGroupOf(cfg: ReturnType<typeof withFlareConfig>): ReturnType<typeof flarePreprocessor> {
    const preprocessors = Array.isArray(cfg.preprocess) ? cfg.preprocess : [cfg.preprocess!];

    return preprocessors[0]!;
}

// preprocess() types its map as `string | object`, so narrow it once instead of at every assertion.
type PreprocessedMap = { version: 3; names: string[]; sources: string[]; mappings: string };

function mapOf(processed: Processed): PreprocessedMap {
    return processed.map as unknown as PreprocessedMap;
}

// Svelte's AST carries these at runtime; its estree `Program` type does not declare them.
type ScriptBody = { start: number; end: number };

/** Asserts the registration was injected exactly once, into the component's own instance script. */
function expectSingleInstanceInjection(code: string, filename = FAKE_FILE): void {
    const hits = [...code.matchAll(/__flareRegisterComponent/g)];
    expect(hits).toHaveLength(1);

    const instance = parse(code, { modern: true, filename }).instance;
    expect(instance).not.toBeNull();

    const body = instance!.content as unknown as ScriptBody;
    expect(hits[0]!.index).toBeGreaterThanOrEqual(body.start);
    expect(hits[0]!.index).toBeLessThan(body.end);
}

describe('flarePreprocessor — importSource option', () => {
    describe('component with an instance script', () => {
        test('defaults to importing from @flareapp/svelte (web)', async () => {
            const pp = flarePreprocessor();
            const out = await runMarkup(pp, WITH_SCRIPT);
            expect(out.code).toContain("from '@flareapp/svelte'");
            expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
        });

        test('emits the inject specifier when importSource is @flareapp/svelte/inject', async () => {
            const pp = flarePreprocessor({ importSource: '@flareapp/svelte/inject' });
            const out = await runMarkup(pp, WITH_SCRIPT);
            expect(out.code).toContain("from '@flareapp/svelte/inject'");
            expect(out.code).not.toContain("from '@flareapp/svelte'");
        });
    });

    describe('scriptless component', () => {
        test('defaults to importing from @flareapp/svelte (web)', async () => {
            const pp = flarePreprocessor();
            const out = await runMarkup(pp, SCRIPTLESS);
            expect(out.code).toContain("from '@flareapp/svelte'");
            expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
        });

        test('emits the inject specifier when importSource is @flareapp/svelte/inject', async () => {
            const pp = flarePreprocessor({ importSource: '@flareapp/svelte/inject' });
            const out = await runMarkup(pp, SCRIPTLESS);
            expect(out.code).toContain("from '@flareapp/svelte/inject'");
            expect(out.code).not.toContain("from '@flareapp/svelte'");
        });
    });
});

describe('withFlareConfig — importSource option', () => {
    test('threads importSource through to the preprocessor (component with an instance script)', async () => {
        const cfg = withFlareConfig({}, { importSource: '@flareapp/svelte/inject' });
        const out = await runMarkup(flareGroupOf(cfg), WITH_SCRIPT);
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
    });

    test('threads importSource through to the preprocessor (scriptless component)', async () => {
        const cfg = withFlareConfig({}, { importSource: '@flareapp/svelte/inject' });
        const out = await runMarkup(flareGroupOf(cfg), SCRIPTLESS);
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
    });

    test('default (no importSource) still emits @flareapp/svelte', async () => {
        const cfg = withFlareConfig({});
        const out = await runMarkup(flareGroupOf(cfg), WITH_SCRIPT);
        expect(out.code).toContain("from '@flareapp/svelte'");
        expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
    });
});

// Run through Svelte's real pipeline instead of the hook in isolation, so the output has to survive
// preprocess() and compile() rather than merely look right.
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

    test('escapes a single quote in the component name (scriptless component)', async () => {
        const pp = flarePreprocessor();
        const out = await runMarkup(pp, SCRIPTLESS, APOSTROPHE_FILE);
        expect(out.code).toContain("__flare_reg__('Product\\'s'");
        // The unescaped form would close the string literal early and inject stray JS.
        expect(out.code).not.toContain("__flare_reg__('Product's'");
    });

    test('escapes a single quote in the component name (component with an instance script)', async () => {
        const pp = flarePreprocessor();
        const out = await runMarkup(pp, WITH_SCRIPT, APOSTROPHE_FILE);
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
    // Markup ABOVE the <script> is what makes this able to fail: a component whose script opens the
    // file has nothing to shift, so it stays correct even with a map Svelte cannot match up.
    const MARKUP_THEN_SCRIPT = ['<p>one</p>', '<p>two</p>', '<script>', 'let marker = 1;', '</script>'].join('\n');
    const MARKUP_ONLY = ['<p>one</p>', '<p>two</p>', '<p>marker</p>'].join('\n');

    /** Which original line the preprocessed output claims `needle` came from. */
    function originalLineOf(processed: Processed, needle: string): number | null {
        const lines = processed.code.split('\n');
        const line = lines.findIndex((text) => text.includes(needle)) + 1;
        const tracer = new TraceMap(mapOf(processed));

        return originalPositionFor(tracer, { line, column: lines[line - 1]!.indexOf(needle) }).line;
    }

    test('names the source the way Svelte looks it up', async () => {
        const withScript = await preprocess(MARKUP_THEN_SCRIPT, flarePreprocessor(), { filename: FAKE_FILE });
        const scriptless = await preprocess(MARKUP_ONLY, flarePreprocessor(), { filename: FAKE_FILE });

        // get_basename in compiler/utils/mapped_code.js. An absolute path never matches, and on a miss
        // Svelte silently skips the offset that makes the map correct.
        expect(mapOf(withScript).sources).toEqual(['Button.svelte']);
        expect(mapOf(scriptless).sources).toEqual(['Button.svelte']);
    });

    test('a script body line still points at its original line', async () => {
        const out = await preprocess(MARKUP_THEN_SCRIPT, flarePreprocessor(), { filename: FAKE_FILE });

        expect(originalLineOf(out, 'let marker = 1;')).toBe(4);
    });

    test('markup in a scriptless component still points at its original line', async () => {
        const out = await preprocess(MARKUP_ONLY, flarePreprocessor(), { filename: FAKE_FILE });

        expect(originalLineOf(out, '<p>marker</p>')).toBe(3);
    });
});

const ROUTE_FILE = '/app/src/routes/product/[id]/+page.svelte';

describe('flarePreprocessor — profile injection', () => {
    test('injects nothing extra when profileComponents is absent', async () => {
        const out = await runMarkup(flarePreprocessor(), WITH_SCRIPT);

        expect(out.code).toContain('__flare_reg__');
        expect(out.code).not.toContain('__flare_prof__');
    });

    test('injects both calls for a matched file when tracking is on', async () => {
        const pp = flarePreprocessor({ profileComponents: [/\+page$/] });
        const out = await runMarkup(pp, WITH_SCRIPT, ROUTE_FILE);

        expect(out.code).toContain('__flareRegisterComponent as __flare_reg__');
        expect(out.code).toContain('__flareProfileComponent as __flare_prof__');
        expect(out.code).toContain("__flare_prof__('product/[id]/+page');");
    });

    test('injects only the profile call when tracking is off', async () => {
        const pp = flarePreprocessor({ componentTracking: false, profileComponents: [/\+page$/] });
        const out = await runMarkup(pp, WITH_SCRIPT, ROUTE_FILE);

        expect(out.code).toContain('__flare_prof__');
        expect(out.code).not.toContain('__flare_reg__');
    });

    test('injects nothing for an unmatched file when tracking is off', async () => {
        const pp = flarePreprocessor({ componentTracking: false, profileComponents: ['SomethingElse'] });
        const out = await runMarkup(pp, WITH_SCRIPT, ROUTE_FILE);

        expect(out).toBeUndefined();
    });

    test('matches on the route-aware name, not the basename', async () => {
        const pp = flarePreprocessor({ profileComponents: ['product/[id]/+page'] });
        const out = await runMarkup(pp, WITH_SCRIPT, ROUTE_FILE);

        expect(out.code).toContain('__flare_prof__');
    });

    test('honors a custom routesDir', async () => {
        const pp = flarePreprocessor({ profileComponents: [/\+page$/], routesDir: 'source/pages' });
        const out = await runMarkup(pp, WITH_SCRIPT, '/app/source/pages/cart/+page.svelte');

        expect(out.code).toContain("__flare_prof__('cart/+page');");
    });

    // `exclude` kills everything, not just the component tree.
    test('exclude suppresses the profile call as well as the registration', async () => {
        const pp = flarePreprocessor({ profileComponents: true, exclude: /routes/ });
        const out = await runMarkup(pp, WITH_SCRIPT, ROUTE_FILE);

        expect(out).toBeUndefined();
    });

    // Whichever entry importSource names has to export the symbol, or the injected call is undefined
    // and throws at init.
    test('emits the profile import from the inject entry when importSource is the inject entry', async () => {
        const pp = flarePreprocessor({ importSource: '@flareapp/svelte/inject', profileComponents: true });
        const out = await runMarkup(pp, WITH_SCRIPT, ROUTE_FILE);

        expect(out.code).toContain('__flareProfileComponent as __flare_prof__');
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
    });

    test('escapes a single quote in the profile name', async () => {
        const pp = flarePreprocessor({ profileComponents: true });
        const out = await runMarkup(pp, WITH_SCRIPT, "/app/src/lib/Product's.svelte");

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
    function outputOf(cfg: ReturnType<typeof withFlareConfig>, filename: string) {
        return runMarkup(flareGroupOf(cfg), WITH_SCRIPT, filename);
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

    test('threads profileComponents through to the preprocessor', async () => {
        const cfg = withFlareConfig({}, { profileComponents: [/\+page$/] });
        const out = await outputOf(cfg, '/app/src/routes/cart/+page.svelte');

        expect(out.code).toContain("__flare_prof__('cart/+page');");
    });

    test('reads routesDir from kit.files.routes', async () => {
        const cfg = withFlareConfig({ kit: { files: { routes: 'source/pages' } } }, { profileComponents: true });
        const out = await outputOf(cfg, '/app/source/pages/cart/+page.svelte');

        expect(out.code).toContain("__flare_prof__('cart/+page');");
    });

    test('defaults to src/routes when kit.files.routes is absent', async () => {
        const cfg = withFlareConfig({}, { profileComponents: true });
        const out = await outputOf(cfg, '/app/src/routes/cart/+page.svelte');

        expect(out.code).toContain("__flare_prof__('cart/+page');");
    });

    test('does not profile anything by default', async () => {
        const cfg = withFlareConfig({});
        const out = await outputOf(cfg, '/app/src/routes/cart/+page.svelte');

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

    test.each(['text/javascript', 'module'])('still injects into an instance script typed %s', async (type) => {
        const source = `<script type="${type}">let x = 1;</script>\n<p>{x}</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
    });
});

// Svelte hands the script hook every <script> in the file, nested ones included, with no offset saying
// where it sat. Injecting into one ships an `import` inside a classic script.
describe('flarePreprocessor — nested <script> tags are not ours', () => {
    const NESTED = '<script>window.analytics = 1;</script>';

    test('leaves an untyped script inside <svelte:head> alone', async () => {
        const source = `<script>let x = 1;</script>\n<svelte:head>\n  ${NESTED}\n</svelte:head>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
        expect(out.code).toContain(NESTED);
    });

    test('leaves an untyped script inside a markup element alone', async () => {
        const source = `<script>let x = 1;</script>\n<div>\n  ${NESTED}\n</div>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
        expect(out.code).toContain(NESTED);
    });

    test('leaves a nested <script src> empty', async () => {
        const source = `<script>let x = 1;</script>\n<div><script src="/a.js"></script></div>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
        expect(out.code).toContain('<script src="/a.js"></script>');
    });

    // The nested script comes FIRST here. A text scan for the first non-module <script> picks that one,
    // so this ordering is what separates a real fix from a plausible-looking one.
    test('picks the instance script even when a nested one comes first', async () => {
        const source = `<svelte:head>${NESTED}</svelte:head>\n<script>let x = 1;</script>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
        expect(out.code).toContain(NESTED);
    });

    test('leaves a nested type="module" script alone', async () => {
        const nestedModule = `<script type="module">import('./x.js');</script>`;
        const source = `<script>let x = 1;</script>\n<div>${nestedModule}</div>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
        expect(out.code).toContain(nestedModule);
    });

    // Today this file gets its registration injected into the head script and never receives an
    // instance script at all, so the component is silently not registered.
    test('creates an instance script when the only script is a nested one', async () => {
        const source = `<svelte:head>\n  ${NESTED}\n</svelte:head>\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
        expect(out.code).toContain(NESTED);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });
});
