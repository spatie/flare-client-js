import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import MagicString from 'magic-string';
import { compile, parse, preprocess, type PreprocessorGroup, type Processed } from 'svelte/compiler';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
    expect(instance).toBeTruthy();

    const body = instance!.content as unknown as ScriptBody;
    expect(hits[0]!.index).toBeGreaterThanOrEqual(body.start);
    expect(hits[0]!.index).toBeLessThan(body.end);
}

/**
 * Same check without parsing, for sources `parse` itself rejects (a scss block, say). Also pins the
 * top-level `<script` count against the input: a prepended fresh script block still lands inside the
 * offset bounds above, so only this count catches that regression.
 */
function expectInjectionInsideFirstScript(input: string, output: string): void {
    const hits = [...output.matchAll(/__flareRegisterComponent/g)];
    expect(hits).toHaveLength(1);

    expect(hits[0]!.index).toBeGreaterThan(output.indexOf('<script>'));
    expect(hits[0]!.index).toBeLessThan(output.indexOf('</script>'));

    const inputScripts = (input.match(/<script/g) || []).length;
    const outputScripts = (output.match(/<script/g) || []).length;
    // No instance script to begin with: the only way to inject is to prepend a brand new one.
    const expectedNewScripts = inputScripts > 0 ? 0 : 1;
    expect(outputScripts - inputScripts).toBe(expectedNewScripts);
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

// Injecting shifts every line below the injection point, so without a map those lines report the
// wrong original line. The merged map's `sources` come from ours too, so the basename matters.
describe('flarePreprocessor — sourcemap (B-svelte-3)', () => {
    // Markup ABOVE the <script> means there is markup whose line numbers the injection can shift.
    const MARKUP_THEN_SCRIPT = ['<p>one</p>', '<p>two</p>', '<script>', 'let marker = 1;', '</script>'].join('\n');
    const MARKUP_ONLY = ['<p>one</p>', '<p>two</p>', '<p>marker</p>'].join('\n');

    /** Which original line the preprocessed output claims `needle` came from. */
    function originalLineOf(processed: Processed, needle: string): number | null {
        const lines = processed.code.split('\n');
        const line = lines.findIndex((text) => text.includes(needle)) + 1;
        const tracer = new TraceMap(mapOf(processed));

        return originalPositionFor(tracer, { line, column: lines[line - 1]!.indexOf(needle) }).line;
    }

    test('names the emitted map source by basename so no absolute path leaks into it', async () => {
        const withScript = await preprocess(MARKUP_THEN_SCRIPT, flarePreprocessor(), { filename: FAKE_FILE });
        const scriptless = await preprocess(MARKUP_ONLY, flarePreprocessor(), { filename: FAKE_FILE });

        // The merged map inherits `sources` from the oldest map in the chain, which is ours, so
        // this name is what every shipped .svelte sourcemap ends up pointing at.
        expect(mapOf(withScript).sources).toEqual(['Button.svelte']);
        expect(mapOf(scriptless).sources).toEqual(['Button.svelte']);
    });

    // The only test that chains two preprocessor maps together, to confirm the basename survives
    // the merge and positions still resolve.
    test('positions survive a chain with another markup preprocessor', async () => {
        const banner: PreprocessorGroup = {
            name: 'banner',
            markup({ content }) {
                const s = new MagicString(content);
                s.prepend('<!-- banner -->\n');

                return { code: s.toString(), map: s.generateMap({ hires: true, source: 'Button.svelte' }) };
            },
        };

        const out = await preprocess(MARKUP_THEN_SCRIPT, [flarePreprocessor(), banner], { filename: FAKE_FILE });

        expect(mapOf(out).sources).toEqual(['Button.svelte']);
        expect(originalLineOf(out, 'let marker = 1;')).toBe(4);
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

    // One preprocessor instance runs over every file in the build, so a /g/ exclude that advances
    // lastIndex lets the next matching file through.
    test('exclude keeps matching across files when the regex is global', async () => {
        const pp = flarePreprocessor({ exclude: /node_modules/g });

        expect(await runMarkup(pp, SCRIPTLESS, '/app/node_modules/a/A.svelte')).toBeUndefined();
        expect(await runMarkup(pp, SCRIPTLESS, '/app/node_modules/b/B.svelte')).toBeUndefined();
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

    // This used to get its registration injected into the head script and never receive an
    // instance script at all, leaving the component silently unregistered.
    test('creates an instance script when the only script is a nested one', async () => {
        const source = `<svelte:head>\n  ${NESTED}\n</svelte:head>\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
        expect(out.code).toContain(NESTED);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });
});

// Svelte parses a <style> body as CSS, so any preprocessed style language throws there long before
// the parser reaches the instance script. Losing the whole registration over it is not acceptable.
describe('flarePreprocessor — style blocks in a language the CSS parser cannot read', () => {
    const CASES = {
        scss: '<style lang="scss">\n$brand: red;\np { color: $brand; }\n</style>',
        // Indented Sass has no braces at all, so it fails on the very first declaration.
        sass: '<style lang="sass">\np\n  color: red\n</style>',
        interpolation: '<style lang="scss">\np { color: #{$brand}; }\n</style>',
        stylus: '<style lang="stylus">\np\n  color red\n</style>',
    };

    test.each(Object.entries(CASES))('still injects with a %s style block', async (_name, style) => {
        const source = `<script>\nlet x = 1;\n</script>\n<p>{x}</p>\n${style}`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectInjectionInsideFirstScript(source, out.code);
        // Byte-identical: we parse a blanked copy, but what we emit is the untouched source.
        expect(out.code).toContain(style);
    });

    test('creates an instance script for a scriptless component with a scss block', async () => {
        const source = `<p>hello</p>\n${CASES.scss}`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectInjectionInsideFirstScript(source, out.code);
        expect(out.code).toContain(CASES.scss);
    });

    test('a plain CSS block still compiles end-to-end', async () => {
        const source = '<script>\nlet x = 1;\n</script>\n<p>{x}</p>\n<style>p { color: red; }</style>';
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectSingleInstanceInjection(out.code);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    // Blanking has to keep the character count, or every offset after the style block is wrong.
    test('picks the right offset when the style block sits above the script', async () => {
        const source = `${CASES.scss}\n<script>\nlet x = 1;\n</script>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });

        expectInjectionInsideFirstScript(source, out.code);
        expect(out.code).toContain(CASES.scss);
    });
});

// A preprocessor edits somebody else's source, so a file it cannot read has to come back untouched.
describe('flarePreprocessor — sources it refuses to touch', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
    });

    test('emits nothing when the source does not parse', async () => {
        const source = '<script>\nlet x = 1;\n</script>\n{#if x}\n<p>hi</p>';
        const out = await preprocess(source, flarePreprocessor(), { filename: '/app/src/Unparseable.svelte' });

        expect(out.code).toBe(source);
    });

    test('warns once per file, naming the file and the reason', async () => {
        const file = '/app/src/WarnsOnce.svelte';
        const source = '<script>\nlet x = 1;\n</script>\n{#if x}\n<p>hi</p>';

        await preprocess(source, flarePreprocessor(), { filename: file });
        await preprocess(source, flarePreprocessor(), { filename: file });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toContain(file);
        expect(warn.mock.calls[0]![0]).toContain('Block was left open');
    });
});

// parse() strips a leading BOM and reports offsets against the stripped source, so we have to do
// the same slicing before trusting any offset it hands back.
describe('flarePreprocessor — byte order mark', () => {
    test('injects into the instance script, keeps the BOM, and still compiles', async () => {
        const file = '/app/src/Bom.svelte';
        const source = `﻿<script>\nlet x = 1;\n</script>\n<p>{x}</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: file });

        expect(out.code.charCodeAt(0)).toBe(0xfeff);
        expectSingleInstanceInjection(out.code.slice(1), file);
        expect(() => compile(out.code, { filename: file })).not.toThrow();
    });

    // With no instance script, the prepend path used to insert the fresh <script> ahead of the
    // BOM instead of after it, so compile()'s BOM stripping never fired and the BOM leaked into
    // the template as a rendered character.
    test('a scriptless component keeps the BOM at byte 0, registers, and compiles', async () => {
        const file = '/app/src/BomScriptless.svelte';
        const source = `﻿<p>hello</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: file });

        expect(out.code.charCodeAt(0)).toBe(0xfeff);
        expect(out.code).toContain('__flare_reg__');
        expect(() => compile(out.code, { filename: file })).not.toThrow();
    });

    // A module script does not populate root.instance, so this hits the same null-start path as
    // the fully scriptless case above.
    test('a component whose only script is a module script keeps the BOM, registers, and compiles', async () => {
        const file = '/app/src/BomModuleOnly.svelte';
        const source = `﻿<script module>\nexport const shared = 1;\n</script>\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: file });

        expect(out.code.charCodeAt(0)).toBe(0xfeff);
        expect(out.code).toContain('__flare_reg__');
        expect(() => compile(out.code, { filename: file })).not.toThrow();
    });

    // The relocated BOM's actual user-visible effect: a zero-width no-break space text node
    // rendered into the DOM that the non-BOM twin never has.
    test('a scriptless component does not leak the BOM into the compiled client template', async () => {
        const file = '/app/src/BomClientOutput.svelte';
        const source = `﻿<p>hello</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: file });
        const compiled = compile(out.code, { filename: file });

        expect(compiled.js.code).not.toContain('﻿');
    });

    // parse()'s own remove_bom strips exactly one BOM, so stripping only one here (and adding only
    // one back onto the offset) leaves a second leading BOM unaccounted for and the offset one short.
    test('two leading BOMs: injection lands inside the instance script body, both BOMs survive, and it compiles', async () => {
        const file = '/app/src/Bom2.svelte';
        const source = `﻿﻿<script>\nlet x = 1;\n</script>\n<p>{x}</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: file });

        expect(out.code.charCodeAt(0)).toBe(0xfeff);
        expect(out.code.charCodeAt(1)).toBe(0xfeff);
        // An offset that is one short lands inside the opening `<script>` tag itself, which
        // expectSingleInstanceInjection catches: parsing that corrupted output either throws or
        // finds the injection outside the real instance script body's bounds.
        expectSingleInstanceInjection(out.code.slice(2), file);
        expect(() => compile(out.code, { filename: file })).not.toThrow();
    });

    // Scriptless path, doubled: appendRight(1, ...) only skipped past ONE BOM, so a second one used
    // to end up stranded mid-file instead of surviving at the front.
    test('two leading BOMs with no script: both survive at the front, registration is injected, and it compiles', async () => {
        const file = '/app/src/Bom2Scriptless.svelte';
        const source = `﻿﻿<p>hello</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: file });

        expect(out.code.charCodeAt(0)).toBe(0xfeff);
        expect(out.code.charCodeAt(1)).toBe(0xfeff);
        expect(out.code).toContain('__flare_reg__');

        const compiled = compile(out.code, { filename: file });

        // compiler/index.js's remove_bom strips exactly one leading BOM, never more, so a second
        // one is never ours to remove either: it survives into the template the same way it would
        // for this same source with no preprocessor involved at all. What we must not do is add a
        // SECOND leak on top of that pre-existing one.
        const bomsInTemplate = (compiled.js.code.match(/﻿/g) || []).length;
        expect(bomsInTemplate).toBe(1);
    });
});
